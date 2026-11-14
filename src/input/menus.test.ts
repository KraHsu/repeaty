// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { arrangeMenu, createMenuPreferences, defaultMenus, normalizeMenus } from './menus'
const adapter = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }))
vi.mock('../settings-store', () => ({ readSetting: adapter.read, persistSetting: adapter.save }))
afterEach(() => vi.resetAllMocks())
it('orders available actions only, preserves essential operations, and retains missing plugin preferences', () => {
  const config = { order: ['plugin:missing:run', 'b', 'a'], hidden: ['a', 'copy'] }
  expect(
    arrangeMenu(
      [{ id: 'a' }, { id: 'copy', essential: true }, { id: 'b' }, { id: 'new' }],
      config,
    ).map((entry) => entry.id),
  ).toEqual(['b', 'copy', 'new'])
  expect(config.order).toContain('plugin:missing:run')
})
it('bounds invalid preferences and preserves empty action lists', () => {
  expect(normalizeMenus({ version: 50 })).toEqual(defaultMenus())
  const raw = defaultMenus()
  raw.selectionOpacity = 0
  raw.surfaces['reading-context'] = { order: ['a', 'a', '__proto__', '<script>'], hidden: [] }
  const next = normalizeMenus(raw)
  expect(next.selectionOpacity).toBe(30)
  expect(next.surfaces['reading-context'].order).toEqual(['a', '__proto__'])
})
it('keeps the saved value on failure and isolates a late save from the next library', async () => {
  let resolve!: () => void
  adapter.read.mockReturnValue(null)
  adapter.save.mockRejectedValueOnce(new Error('disk full'))
  const owner = effectScope(),
    scope = ref('a')
  const controller = owner.run(() => createMenuPreferences(scope))!
  expect(await controller.save({ ...defaultMenus(), selectionEnabled: false })).toBe(false)
  expect(controller.value.value.selectionEnabled).toBe(true)
  expect(controller.error.value).toBeTruthy()
  adapter.save.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done
      }),
  )
  const saving = controller.save({ ...defaultMenus(), selectionEnabled: false })
  scope.value = 'b'
  await nextTick()
  resolve()
  expect(await saving).toBe(false)
  expect(controller.value.value.selectionEnabled).toBe(true)
  expect(controller.error.value).toBe('')
  owner.stop()
})
