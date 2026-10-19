// @vitest-environment happy-dom
import { createApp, reactive, nextTick, h } from 'vue'
import { expect, it, vi } from 'vitest'
import AttemptBody from './AttemptBody.vue'
import PracticeHistory from './PracticeHistory.vue'
import { summarizeAttempt, type Attempt } from '../core/practice-data'
import { practiceHistoryFixture } from '../../tests/fixtures/practice-history'

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('loads no closed code, retries a failed expansion, and releases the body on collapse', async () => {
  const library = practiceHistoryFixture(1)
  const full = library.attempts[0]!
  const getAttempt = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(full)
  const onReveal = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(PracticeHistory, {
    practices: library.practices,
    attempts: [summarizeAttempt(full)],
    getAttempt,
    onReveal,
    standalone: true,
  })
  try {
    app.mount(host)
    expect(getAttempt).not.toHaveBeenCalled()
    expect(host.querySelector('code')).toBeNull()
    const details = host.querySelector<HTMLDetailsElement>('.attempt-history')!
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    await settle()
    expect(getAttempt).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    expect(onReveal).not.toHaveBeenCalled()
    host.querySelector<HTMLButtonElement>('.attempt-body button')!.click()
    await settle()
    expect(getAttempt).toHaveBeenCalledTimes(2)
    expect(onReveal).toHaveBeenCalledWith(library.practices[0]!.id)
    expect(host.querySelector('code')!.textContent).toBe(full.code)
    expect(host.querySelector('.attempt-body script')).toBeNull()
    details.open = false
    details.dispatchEvent(new Event('toggle'))
    await settle()
    expect(host.querySelector('code')).toBeNull()
    expect(host.querySelector('.attempt-body')).toBeNull()
  } finally {
    app.unmount()
    host.remove()
  }
})

it('ignores a previous record response and cancels the active request on unmount', async () => {
  const library = practiceHistoryFixture(2)
  const first = deferred<Attempt>(),
    second = deferred<Attempt>()
  const signals: AbortSignal[] = []
  const getAttempt = vi.fn((id: string, signal?: AbortSignal) => {
    signals.push(signal!)
    return id === library.attempts[0]!.id ? first.promise : second.promise
  })
  const props = reactive({ attempt: summarizeAttempt(library.attempts[0]!), getAttempt })
  const host = document.createElement('div')
  const mounted = createApp({ render: () => h(AttemptBody, props) })
  mounted.mount(host)
  props.attempt = summarizeAttempt(library.attempts[1]!)
  await nextTick()
  expect(signals[0]!.aborted).toBe(true)
  first.resolve(library.attempts[0]!)
  await settle()
  expect(host.querySelector('code')).toBeNull()
  mounted.unmount()
  expect(signals[1]!.aborted).toBe(true)
  second.resolve(library.attempts[1]!)
  await settle()
  expect(host.textContent).toBe('')
})
