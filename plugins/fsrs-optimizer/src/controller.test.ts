import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StudyHostApi } from '@repeaty/plugin-api'
import { createOptimizer } from './controller'
import { snapshot, state, candidate } from '../test/fixture'
import { TRAINING_ENGINE } from './training'

const dispose: (() => void)[] = []
afterEach(() => {
  dispose.splice(0).forEach((fn) => fn())
  vi.useRealTimers()
})
function setup() {
  const value = state(),
    listeners = new Set<() => void>(),
    settings = new Map<string, string>()
  const api = {
    trainingState: vi.fn(async () => ({ ...value })),
    trainingSnapshot: vi.fn(async () => snapshot()),
    submitCandidate: vi.fn(async () => candidate()),
    activateModel: vi.fn(async () => {}),
    rollbackModel: vi.fn(async () => {}),
    discardTraining: vi.fn(),
    activity: () => value.activity,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  const run = vi.fn(async () => ({ weights: candidate().weights, engine: TRAINING_ENGINE }))
  const controller = createOptimizer(api as unknown as StudyHostApi, run, {
    read: (key) => settings.get(key) ?? null,
    write: (key, data) => {
      settings.set(key, data)
    },
  })
  dispose.push(controller.dispose)
  return { controller, api, run, value, settings, changed: () => listeners.forEach((fn) => fn()) }
}
describe('training controller', () => {
  it('can start after the host publishes a previously unavailable activation', async () => {
    vi.useFakeTimers()
    const { controller, api } = setup()
    const subscribe = api.subscribe
    api.subscribe = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('study-service-unavailable')
      })
      .mockImplementation(subscribe)
    await controller.start()
    expect((controller.error.value as Error).message).toBe('study-service-unavailable')
    expect(vi.getTimerCount()).toBe(0)
    await controller.start()
    expect(controller.error.value).toBeUndefined()
    expect(controller.state.value?.workspaceScope).toBe('library-1')
    expect(vi.getTimerCount()).toBe(1)
    controller.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('manual training only submits a candidate and always releases snapshot', async () => {
    const { controller, api } = setup()
    await controller.start()
    await controller.train()
    expect(api.submitCandidate).toHaveBeenCalledWith(
      { token: 'snapshot-1', weights: candidate().weights, engine: TRAINING_ENGINE },
      expect.any(AbortSignal),
    )
    expect(api.activateModel).not.toHaveBeenCalled()
    expect(api.discardTraining).toHaveBeenCalledWith('snapshot-1')
    expect(controller.message.value).toBe('candidate')
  })
  it('retries hydration without creating a second activity subscription or timer', async () => {
    vi.useFakeTimers()
    const { controller, api } = setup()
    const subscribe = vi.spyOn(api, 'subscribe')
    api.trainingState.mockRejectedValueOnce(new Error('stale-workspace-session'))
    await controller.start()
    expect(controller.state.value).toBeUndefined()
    expect(vi.getTimerCount()).toBe(1)
    await controller.start()
    expect(controller.state.value?.workspaceScope).toBe('library-1')
    expect(controller.error.value).toBeUndefined()
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
  })
  it('does not leak a rejected timer task while scope teardown invalidates the SDK', async () => {
    const { controller, api } = setup()
    await controller.start()
    api.activity = () => {
      throw new Error('stale-workspace-session')
    }
    await expect(controller.tick()).resolves.toBeUndefined()
    expect((controller.error.value as Error).message).toBe('stale-workspace-session')
    expect(api.trainingSnapshot).not.toHaveBeenCalled()
  })
  it('host rejection cannot become a success or activate parameters', async () => {
    const { controller, api } = setup()
    api.submitCandidate.mockRejectedValue(new Error('candidate-not-improved'))
    await controller.start()
    await controller.train()
    expect((controller.error.value as Error).message).toBe('candidate-not-improved')
    expect(controller.message.value).toBeUndefined()
    expect(api.activateModel).not.toHaveBeenCalled()
    expect(api.discardTraining).toHaveBeenCalledOnce()
  })
  it('disposal prevents a late worker result from being submitted', async () => {
    const { controller, api, run } = setup()
    let resolve!: (value: Awaited<ReturnType<typeof run>>) => void
    run.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    await controller.start()
    const pending = controller.train()
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
    controller.dispose()
    resolve({ weights: candidate().weights, engine: TRAINING_ENGINE })
    await pending
    expect(api.submitCandidate).not.toHaveBeenCalled()
    expect(api.discardTraining).toHaveBeenCalledOnce()
    expect(controller.state.value?.workspaceScope).toBe('library-1')
  })
  it('defaults automatic training off and requires foreground idle, not studying', async () => {
    const { controller, api, value } = setup()
    await controller.start()
    await controller.tick()
    expect(api.trainingSnapshot).not.toHaveBeenCalled()
    controller.configure(true, false)
    for (const activity of [
      { foreground: false, studying: false, idleMs: 40_000 },
      { foreground: true, studying: true, idleMs: 40_000 },
      { foreground: true, studying: false, idleMs: 20_000 },
    ]) {
      value.activity = activity
      await controller.tick()
    }
    expect(api.trainingSnapshot).not.toHaveBeenCalled()
    value.activity = { foreground: true, studying: false, idleMs: 30_000 }
    await controller.tick()
    await controller.tick()
    expect(api.trainingSnapshot).toHaveBeenCalledOnce()
    expect(api.activateModel).not.toHaveBeenCalled()
  })
  it.each([false, true])(
    'does not scan history on grades while studying (automatic=%s)',
    async (automatic) => {
      const { controller, api, value, changed } = setup()
      await controller.start()
      controller.configure(automatic, false)
      api.trainingState.mockClear()
      value.activity = { foreground: true, studying: true, idleMs: 40_000 }
      for (let grade = 0; grade < 5; grade++) {
        changed()
        await controller.tick()
      }
      await controller.refresh()
      expect(api.trainingState).not.toHaveBeenCalled()
      expect(api.trainingSnapshot).not.toHaveBeenCalled()
      value.activity.studying = false
      changed()
      await vi.waitFor(() => expect(api.trainingState).toHaveBeenCalledTimes(1))
    },
  )
  it('auto-adopts only with separate explicit opt-in and records unsuccessful attempts per scope', async () => {
    const { controller, api, value } = setup()
    await controller.start()
    controller.configure(true, true)
    await controller.tick()
    expect(api.activateModel).toHaveBeenCalledWith(
      { modelId: 'model-1', workspaceScope: 'library-1' },
      expect.any(AbortSignal),
    )
    value.reviewCount = 2050
    api.trainingSnapshot.mockRejectedValue(new Error('insufficient-training-history'))
    await controller.tick()
    await controller.tick()
    expect(api.trainingSnapshot).toHaveBeenCalledTimes(2)
    expect(api.activateModel).toHaveBeenCalledOnce()
  })
  it('resuming interaction cancels automatic training without consuming the retry threshold', async () => {
    const { controller, api, run, value, changed, settings } = setup()
    let resolve!: (value: Awaited<ReturnType<typeof run>>) => void
    run.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    await controller.start()
    controller.configure(true, false)
    const pending = controller.tick()
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
    value.activity.idleMs = 0
    changed()
    resolve({ weights: candidate().weights, engine: TRAINING_ENGINE })
    await pending
    expect(api.submitCandidate).not.toHaveBeenCalled()
    expect(settings.has('attempted')).toBe(false)
  })
  it('stale workspace responses dispose the old controller', async () => {
    const { controller, api, value } = setup()
    await controller.start()
    value.workspaceScope = 'library-2'
    await controller.refresh()
    await controller.train()
    expect(api.trainingSnapshot).not.toHaveBeenCalled()
  })
  it('activation and rollback carry the expected library and active model', async () => {
    const { controller, api } = setup()
    await controller.start()
    await controller.activate('chosen')
    await controller.rollback('chosen')
    expect(api.activateModel).toHaveBeenCalledWith(
      { modelId: 'chosen', workspaceScope: 'library-1' },
      expect.any(AbortSignal),
    )
    expect(api.rollbackModel).toHaveBeenCalledWith(
      { deckId: undefined, expectedActiveModelId: 'chosen', workspaceScope: 'library-1' },
      expect.any(AbortSignal),
    )
  })
})
