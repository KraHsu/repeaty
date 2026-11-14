import { computed, ref, shallowRef } from 'vue'
import type { StudyHostApi, StudyTrainingSnapshot, StudyTrainingState } from '@repeaty/plugin-api'
import type { RunTraining, TrainingProgress } from './runner'

interface Preferences {
  read(key: string): string | null
  write(key: string, value: string, failed?: () => void): void
}
type ScopeOption = { automatic: boolean; apply: boolean }
type Phase = 'idle' | 'preparing' | 'training' | 'validating' | 'activating' | 'rollback'
const STEP = 1024
const IDLE_MS = 30_000
const targetKey = (deckId?: string) => (deckId ? `deck:${deckId}` : 'library')
const deckFromKey = (key: string) => (key === 'library' ? undefined : key.slice(5))

function readObject<T>(settings: Preferences, key: string, fallback: T): T {
  try {
    const value = JSON.parse(settings.read(key) ?? '')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
  } catch {
    return fallback
  }
}

/** One controller per plugin activation; neither workers nor snapshots survive disposal. */
export function createOptimizer(api: StudyHostApi, run: RunTraining, preferences: Preferences) {
  const state = shallowRef<StudyTrainingState>(),
    selectedDeck = ref(''),
    phase = ref<Phase>('idle'),
    progress = shallowRef<TrainingProgress>(),
    error = ref<unknown>(),
    message = ref<'candidate' | 'activated' | 'rolled-back' | 'cancelled'>(),
    loading = ref(false),
    automaticOptions = ref<Record<string, ScopeOption>>(
      Object.fromEntries(
        Object.entries(readObject<Record<string, ScopeOption>>(preferences, 'automatic', {}))
          .filter(
            ([key, value]) =>
              (key === 'library' || key.startsWith('deck:')) && value && typeof value === 'object',
          )
          .map(([key, value]) => [
            key,
            {
              automatic: value.automatic === true,
              apply: value.automatic === true && value.apply === true,
            },
          ]),
      ),
    )
  let active = false,
    scope: string | undefined,
    refreshGeneration = 0,
    refreshController: AbortController | undefined,
    operation: AbortController | undefined,
    timer: ReturnType<typeof setInterval> | undefined,
    stop: (() => void) | undefined,
    checking = false,
    jobAutomatic = false,
    jobDeck: string | undefined
  const attempted = readObject<Record<string, number>>(preferences, 'attempted', {})
  const busy = computed(() => phase.value !== 'idle')
  const option = computed(
    () =>
      automaticOptions.value[targetKey(selectedDeck.value || undefined)] ?? {
        automatic: false,
        apply: false,
      },
  )
  const current = () => active && (!scope || state.value?.workspaceScope === scope)

  async function refresh() {
    if (!active) return
    const generation = ++refreshGeneration
    refreshController?.abort()
    const controller = new AbortController()
    refreshController = controller
    loading.value = true
    try {
      // Library notifications include every grade. Defer history traversal while
      // studying; leaving the session or reopening this page refreshes it once.
      if (api.activity().studying) return
      const next = await api.trainingState(
        { deckId: selectedDeck.value || undefined },
        controller.signal,
      )
      if (!active || controller.signal.aborted || generation !== refreshGeneration) return
      if (scope && scope !== next.workspaceScope) return dispose()
      scope = next.workspaceScope
      state.value = next
    } catch (reason) {
      if (active && !controller.signal.aborted && generation === refreshGeneration)
        error.value = reason
    } finally {
      if (active && generation === refreshGeneration) loading.value = false
    }
  }

  function cancel() {
    if (
      !operation ||
      operation.signal.aborted ||
      phase.value === 'activating' ||
      phase.value === 'rollback'
    )
      return
    operation.abort()
    message.value = 'cancelled'
  }

  async function train(
    deckId = selectedDeck.value || undefined,
    automatic = false,
    reviewCount = 0,
  ) {
    if (!current() || busy.value) return
    const controller = new AbortController()
    operation = controller
    jobAutomatic = automatic
    jobDeck = deckId
    phase.value = 'preparing'
    error.value = undefined
    message.value = undefined
    progress.value = undefined
    let snapshot: StudyTrainingSnapshot | undefined
    try {
      snapshot = await api.trainingSnapshot({ deckId }, controller.signal)
      controller.signal.throwIfAborted()
      if (!active || snapshot.workspaceScope !== scope)
        throw new DOMException('Stale library', 'AbortError')
      phase.value = 'training'
      const result = await run(snapshot, {
        signal: controller.signal,
        progress(value) {
          if (active && operation === controller && !controller.signal.aborted)
            progress.value = value
        },
      })
      controller.signal.throwIfAborted()
      phase.value = 'validating'
      const candidate = await api.submitCandidate(
        { token: snapshot.token, ...result },
        controller.signal,
      )
      controller.signal.throwIfAborted()
      if (automatic && automaticOptions.value[targetKey(deckId)]?.apply) {
        phase.value = 'activating'
        await api.activateModel(
          { modelId: candidate.id, workspaceScope: snapshot.workspaceScope },
          controller.signal,
        )
        if (!controller.signal.aborted) message.value = 'activated'
      } else message.value = 'candidate'
    } catch (reason) {
      if (active && !controller.signal.aborted) error.value = reason
    } finally {
      if (snapshot) {
        try {
          api.discardTraining(snapshot.token)
        } catch {
          /* A disposed host already invalidated its tokens. */
        }
      }
      if (active && operation === controller) {
        if (automatic && !controller.signal.aborted) {
          attempted[targetKey(deckId)] = Math.max(snapshot?.counts.reviews ?? 0, reviewCount)
          preferences.write('attempted', JSON.stringify(attempted))
        }
        operation = undefined
        phase.value = 'idle'
        jobAutomatic = false
        await refresh()
      }
    }
  }

  async function changeModel(action: 'activate' | 'rollback', modelId: string) {
    if (!current() || busy.value || !state.value) return
    const controller = new AbortController()
    operation = controller
    phase.value = action === 'activate' ? 'activating' : 'rollback'
    error.value = undefined
    message.value = undefined
    try {
      if (action === 'activate')
        await api.activateModel(
          { modelId, workspaceScope: state.value.workspaceScope },
          controller.signal,
        )
      else
        await api.rollbackModel(
          {
            deckId: selectedDeck.value || undefined,
            expectedActiveModelId: modelId,
            workspaceScope: state.value.workspaceScope,
          },
          controller.signal,
        )
      if (active && !controller.signal.aborted)
        message.value = action === 'activate' ? 'activated' : 'rolled-back'
    } catch (reason) {
      if (active && !controller.signal.aborted) error.value = reason
    } finally {
      if (active && operation === controller) {
        operation = undefined
        phase.value = 'idle'
        await refresh()
      }
    }
  }

  function configure(automatic: boolean, apply: boolean) {
    const key = targetKey(selectedDeck.value || undefined)
    const previous = automaticOptions.value
    automaticOptions.value = { ...previous, [key]: { automatic, apply: automatic && apply } }
    preferences.write('automatic', JSON.stringify(automaticOptions.value), () => {
      automaticOptions.value = previous
      error.value = new Error('optimizer-settings-failed')
    })
    if (jobAutomatic && targetKey(jobDeck) === key && !automatic) cancel()
  }

  async function select(deckId: string) {
    cancel()
    selectedDeck.value = deckId
    state.value = undefined
    error.value = undefined
    message.value = undefined
    await refresh()
  }

  async function tick() {
    if (!active) return
    let activity: ReturnType<StudyHostApi['activity']>
    try {
      activity = api.activity()
    } catch (reason) {
      // A scope switch invalidates SDK access before queued plugin disposal.
      if (active) error.value = reason
      return
    }
    if (jobAutomatic && (!activity.foreground || activity.studying || activity.idleMs < IDLE_MS))
      cancel()
    if (busy.value || checking) return
    if (!activity.foreground || activity.studying || activity.idleMs < IDLE_MS) return
    checking = true
    try {
      for (const [key, options] of Object.entries(automaticOptions.value)) {
        if (!options?.automatic || (key !== 'library' && !key.startsWith('deck:'))) continue
        const deckId = deckFromKey(key)
        const target = await api.trainingState({ deckId })
        if (!active || target.workspaceScope !== scope || busy.value) return
        const activity = api.activity()
        if (!activity.foreground || activity.studying || activity.idleMs < IDLE_MS) return
        const previous = Math.max(
          Number.isFinite(attempted[key]) ? attempted[key]! : 0,
          ...target.models
            .filter((model) => model.deckId === deckId)
            .map((model) => model.counts.reviews),
        )
        if (
          target.reviewCount < STEP ||
          Math.floor(target.reviewCount / STEP) <= Math.floor(previous / STEP)
        )
          continue
        await train(deckId, true, target.reviewCount)
        break
      }
    } catch (reason) {
      if (active) error.value = reason
    } finally {
      checking = false
    }
  }

  function activityChanged() {
    if (!active) return
    const activity = api.activity()
    if (
      operation &&
      (!activity.foreground || activity.studying || (jobAutomatic && activity.idleMs < IDLE_MS))
    )
      cancel()
    if (!busy.value) void refresh()
  }

  async function start() {
    if (active) {
      if (!state.value) {
        error.value = undefined
        await refresh()
      }
      return
    }
    active = true
    error.value = undefined
    try {
      stop = api.subscribe(activityChanged)
      timer = setInterval(() => {
        void tick()
      }, 5000)
      await refresh()
    } catch (reason) {
      if (active) {
        active = false
        clearInterval(timer)
        stop?.()
        stop = undefined
        error.value = reason
      }
    }
  }

  function dispose() {
    if (!active) return
    active = false
    refreshGeneration++
    refreshController?.abort()
    operation?.abort()
    operation = undefined
    clearInterval(timer)
    stop?.()
    phase.value = 'idle'
    loading.value = false
  }

  return {
    state,
    selectedDeck,
    phase,
    progress,
    error,
    message,
    loading,
    busy,
    option,
    start,
    dispose,
    refresh,
    cancel,
    train,
    select,
    configure,
    tick,
    activate: (id: string) => changeModel('activate', id),
    rollback: (id: string) => changeModel('rollback', id),
  }
}
