import { effectScope, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useReadingPanels } from './useReadingPanels'
import { useSettingsStore } from '../settings-store'

afterEach(() => vi.restoreAllMocks())
it('supports keyboard widths, scoped preferences and cancelling an in-progress pointer resize', async () => {
  const data = new Map<string, string>()
  const settings = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value)
    }),
  }
  useSettingsStore(settings)
  const scope = effectScope(),
    library = ref('library-one')
  const panels = scope.run(() => useReadingPanels(library))!
  const keyboard = (key: string) => ({ key, preventDefault: vi.fn() }) as unknown as KeyboardEvent
  panels.keyboard(keyboard('ArrowRight'), 'left')
  expect(panels.left.value).toBe(232)
  panels.keyboard(keyboard('ArrowLeft'), 'right')
  expect(panels.right.value).toBe(268)
  panels.keyboard(keyboard('End'), 'right')
  expect(panels.right.value).toBe(380)
  const target = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), focus: vi.fn() }
  const event = (x: number) =>
    ({
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: x,
      currentTarget: target,
      preventDefault: vi.fn(),
    }) as unknown as PointerEvent
  panels.start(event(500), 'left')
  panels.move(event(700))
  expect(panels.left.value).toBe(320)
  panels.cancel(event(700))
  expect(panels.left.value).toBe(232)
  expect(target.releasePointerCapture).toHaveBeenCalledWith(1)
  const saved = settings.setItem.mock.calls.length
  panels.start(event(500), 'left')
  panels.move(event(550))
  data.clear()
  library.value = 'library-two'
  await Promise.resolve()
  expect(panels.left.value).toBe(224)
  expect(settings.setItem).toHaveBeenCalledTimes(saved)
  scope.stop()
})

it('bounds corrupted saved widths and never persists an unfinished gesture on disposal', () => {
  const settings = { getItem: () => '{"left":999999,"right":-5}', setItem: vi.fn() }
  useSettingsStore(settings)
  const scope = effectScope(),
    panels = scope.run(() => useReadingPanels(ref('library')))!
  expect(panels.left.value).toBe(320)
  expect(panels.right.value).toBe(180)
  scope.stop()
  expect(settings.setItem).not.toHaveBeenCalled()
})
