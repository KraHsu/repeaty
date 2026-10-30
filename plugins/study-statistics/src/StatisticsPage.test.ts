// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import type { StudyStatisticsDetails, StudyStatisticsSnapshot } from '@repeaty/plugin-api'
import StatisticsPage from './StatisticsPage.vue'
import { locale, study } from '../test/plugin-api'
import { statisticsWindow } from './calendar'

const disposers: (() => void)[] = []
const makeSnapshot = (
  workspaceScope = 'library',
  today = '2026-10-30',
): StudyStatisticsSnapshot => ({
  workspaceScope,
  revision: 1,
  today,
  dayStartHour: 4,
  coverage: { readingsFrom: today, practicesFrom: today, foregroundFrom: today },
  ...statisticsWindow(today),
  days: [
    {
      day: today,
      reviews: 2,
      readings: 1,
      practices: 3,
      foregroundMs: 600_000,
      readingMs: 180_000,
      reviewMs: 240_000,
      practiceMs: 120_000,
      scheduledCards: 4,
      scheduledReadings: 2,
    },
    {
      day: '2026-11-01',
      reviews: 0,
      readings: null,
      practices: null,
      foregroundMs: null,
      readingMs: null,
      reviewMs: null,
      practiceMs: null,
      scheduledCards: 4,
      scheduledReadings: 2,
    },
  ],
})
const makeDetails = (day = '2026-10-30', title = 'A saved card'): StudyStatisticsDetails => ({
  workspaceScope: 'library',
  revision: 1,
  day,
  kind: 'reviews',
  total: 1,
  offset: 0,
  items: [{ id: title, title, occurredAt: '2026-10-30T10:00:00Z' }],
})
async function settle() {
  for (let index = 0; index < 12; index++) await nextTick()
}
async function mount() {
  const scope = ref('library'),
    root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ setup: () => () => h(StatisticsPage, { workspaceScope: scope.value }) })
  app.mount(root)
  const dispose = () => {
    app.unmount()
    root.remove()
  }
  disposers.push(dispose)
  await settle()
  const button = (name: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (entry) => entry.getAttribute('aria-label') === name || entry.textContent === name,
    )!
  return { root, scope, button, dispose }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 30, 12))
  study.statistics.mockResolvedValue(makeSnapshot())
  study.statisticsDetails.mockImplementation(async (query) => ({
    ...makeDetails(query.day),
    kind: query.kind,
  }))
  study.subscribe.mockImplementation(() => () => {})
})
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  vi.resetAllMocks()
  vi.useRealTimers()
  locale.value = 'zh-CN'
})
it('shows saved activity separately, switches to future plans, and keeps calendar keyboard focus', async () => {
  const { root, button } = await mount()
  expect(root.querySelector('.statistics-summary')?.textContent).toContain('10 分钟')
  expect(root.querySelector('.statistics-detail')?.textContent).toContain('A saved card')
  root
    .querySelector<HTMLButtonElement>('[data-day="2026-10-30"]')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await settle()
  expect(document.activeElement).toBe(root.querySelector('[data-day="2026-10-31"]'))
  button('下个月').click()
  await settle()
  expect(root.querySelector('.statistics-plan-summary')?.textContent).toContain('计划卡片4')
  expect(root.querySelector('.statistics-summary')?.textContent).not.toContain('前台使用')
  expect(study.statisticsDetails).toHaveBeenLastCalledWith(
    expect.objectContaining({ day: '2026-11-01', kind: 'scheduledCards' }),
    expect.any(AbortSignal),
  )
  button('今天').click()
  await settle()
  expect(root.querySelector('[aria-pressed="true"]')?.getAttribute('data-day')).toBe('2026-10-30')
})
it('retains prior results on refresh failure and never replaces new-day details with a late response', async () => {
  const { root, button } = await mount()
  let finish!: (value: StudyStatisticsDetails) => void
  study.statisticsDetails.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  root.querySelector<HTMLButtonElement>('[data-day="2026-10-29"]')!.click()
  await settle()
  const pendingSignal = study.statisticsDetails.mock.calls.at(-1)![1]!
  root.querySelector<HTMLButtonElement>('[data-day="2026-10-28"]')!.click()
  await settle()
  finish(makeDetails('2026-10-29', 'stale card'))
  await settle()
  expect(pendingSignal.aborted).toBe(true)
  expect(root.textContent).not.toContain('stale card')
  study.statistics.mockRejectedValueOnce(new Error('Storage temporarily unavailable'))
  button('刷新统计').click()
  await settle()
  expect(root.textContent).toContain('上次结果仍保留')
  expect(root.querySelector('.statistics-calendar')).not.toBeNull()
})
it('cancels requests, subscriptions and boundary timers on unmount; late old-library responses stay isolated', async () => {
  const unsubscribe = vi.fn()
  study.subscribe.mockReturnValue(unsubscribe)
  let finish!: (value: StudyStatisticsSnapshot) => void
  study.statistics.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const { root, scope, dispose } = await mount()
  const oldSignal = study.statistics.mock.calls[0]![1]!
  study.statistics.mockResolvedValue(makeSnapshot('new-library'))
  study.statisticsDetails.mockResolvedValue({ ...makeDetails(), workspaceScope: 'new-library' })
  scope.value = 'new-library'
  await settle()
  finish({ ...makeSnapshot(), days: [{ ...makeSnapshot().days[0]!, reviews: 999 }] })
  await settle()
  expect(oldSignal.aborted).toBe(true)
  expect(root.textContent).not.toContain('999')
  dispose()
  disposers.pop()
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  expect(study.statisticsDetails.mock.calls.at(-1)![1]!.aborted).toBe(true)
})
it('reloads host changes and rejects pagination from a different revision', async () => {
  study.statisticsDetails.mockResolvedValue({ ...makeDetails(), total: 21, nextOffset: 20 })
  const { root, button } = await mount()
  study.statisticsDetails.mockResolvedValue({
    ...makeDetails('2026-10-30', 'new revision'),
    revision: 2,
    offset: 20,
  })
  button('加载更多').click()
  await settle()
  expect(root.textContent).toContain('记录已变化')
  expect(root.textContent).not.toContain('new revision')
  study.subscribe.mock.calls[0]![0]()
  await vi.advanceTimersByTimeAsync(160)
  await settle()
  expect(study.statistics).toHaveBeenCalledTimes(2)
  expect(root.textContent).toContain('new revision')
})
it('aligns a month-boundary initial query to the host study day and refreshes at the next boundary', async () => {
  vi.setSystemTime(new Date(2026, 10, 1, 2))
  study.statistics.mockResolvedValue(makeSnapshot('library', '2026-10-31'))
  await mount()
  expect(study.statistics.mock.calls.map(([query]) => query.from)).toEqual([
    '2026-06-01',
    '2026-05-01',
  ])
  await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 20)
  await settle()
  expect(study.statistics).toHaveBeenCalledTimes(3)
})
