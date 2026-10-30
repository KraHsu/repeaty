// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useSettingsStore } from '../settings-store'
import {
  createInputController,
  INPUT_SETTINGS_KEY,
  normalizeInputPreferences,
  type InputController,
} from './controller'
import { chordFromEvent, chordsOverlap, matchesChord, normalizeChord } from './shortcuts'

let values: Map<string, string>
const controllers: InputController[] = []
beforeEach(() => {
  values = new Map()
  useSettingsStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  })
})
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})
function setup() {
  const scope = ref('library-a'),
    controller = createInputController(scope)
  controllers.push(controller)
  return { scope, controller }
}
function key(value: string, options: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { key: value, cancelable: true, bubbles: true, ...options })
}
it('normalizes portable chords, matches the right OS, and detects cross-platform collisions', () => {
  expect(normalizeChord('ctrl+shift+k')).toBe('Control+Shift+K')
  expect(normalizeChord('Mod+Ctrl+K')).toBeUndefined()
  expect(normalizeChord('Tab')).toBeUndefined()
  expect(matchesChord(key('k', { ctrlKey: true }), 'Mod+K', false)).toBe(true)
  expect(matchesChord(key('k', { ctrlKey: true }), 'Mod+K', true)).toBe(false)
  expect(matchesChord(key('k', { metaKey: true }), 'Mod+K', true)).toBe(true)
  expect(matchesChord(key('K', { ctrlKey: true, shiftKey: true }), 'Mod+K', false)).toBe(false)
  expect(chordsOverlap('Mod+K', 'Control+K')).toBe(true)
  expect(chordsOverlap('Control+K', 'Meta+K')).toBe(false)
  expect(chordFromEvent(key('a', { isComposing: true }))).toBeUndefined()
  expect(chordFromEvent(key('+', { shiftKey: true }))).toBe('Shift+Plus')
  const altGraph = key('e', { ctrlKey: true, altKey: true })
  vi.spyOn(altGraph, 'getModifierState').mockImplementation((name) => name === 'AltGraph')
  expect(chordFromEvent(altGraph)).toBeUndefined()
  expect(matchesChord(altGraph, 'Control+Alt+E', false)).toBe(false)
})
it('persists remapped and disabled chords, restores and resets without changing unrelated preferences', async () => {
  const { controller } = setup(),
    run = vi.fn()
  controller.register({
    id: 'app.add',
    title: '添加',
    context: 'global',
    defaultShortcuts: ['A'],
    execute: run,
  })
  await controller.saveShortcuts('app.add', ['Mod+Shift+K'])
  expect(controller.dispatch(key('a'))).toBe(false)
  expect(controller.dispatch(key('K', { ctrlKey: true, shiftKey: true }))).toBe(true)
  expect(run).toHaveBeenCalledTimes(1)
  const reloaded = setup().controller
  expect(reloaded.bindings('app.add')).toEqual(['Mod+Shift+K'])
  await controller.saveShortcuts('app.add', [])
  expect(controller.bindings('app.add')).toEqual([])
  await controller.resetShortcuts('app.add')
  expect(controller.bindings('app.add')).toEqual(['A'])
  expect(values.has(INPUT_SETTINGS_KEY)).toBe(true)
})
it('rejects collisions and reserved editor typing or native clipboard/undo keys', async () => {
  const { controller } = setup()
  await expect(controller.saveShortcuts('app.add', ['R'])).rejects.toThrow('冲突')
  expect(controller.conflicts('app.add', ['Mod+Z']).map((entry) => entry.id)).toContain('app.undo')
  expect(controller.conflicts('app.cards', ['B'])).toEqual([])
  for (const value of [
    'A',
    'Mod+Z',
    'Mod+Shift+Z',
    'Control+Shift+V',
    'Control+C',
    'Meta+A',
    'Control+ArrowLeft',
    'Meta+Shift+Home',
    'Alt+Backspace',
  ])
    await expect(controller.saveShortcuts('editor.save', [value])).rejects.toThrow('原生')
  await controller.saveShortcuts('editor.save', ['Mod+Shift+S'])
  expect(controller.matches('editor.save', key('S', { ctrlKey: true, shiftKey: true }))).toBe(true)
})
it('never dispatches ambiguous persisted bindings or unavailable commands', () => {
  values.set(
    INPUT_SETTINGS_KEY,
    JSON.stringify({ shortcuts: { 'custom.one': ['K'], 'custom.two': ['K'] } }),
  )
  const { controller } = setup(),
    first = vi.fn(),
    second = vi.fn()
  controller.register({ id: 'custom.one', title: 'One', context: 'global', execute: first })
  let available = true
  controller.register({
    id: 'custom.two',
    title: 'Two',
    context: 'global',
    available: () => available,
    execute: second,
  })
  expect(controller.dispatch(key('k'))).toBe(false)
  expect(first).not.toHaveBeenCalled()
  available = false
  expect(controller.dispatch(key('k'))).toBe(true)
  expect(first).toHaveBeenCalledTimes(1)
})
it('keeps plugin catalogue while its view closes and removes executable callbacks on disable', async () => {
  const { controller } = setup(),
    execute = vi.fn()
  const definition = controller.registerDefinition({
    id: 'plugin:tools:trim',
    title: 'Trim',
    context: 'material',
    defaultShortcuts: ['Mod+Shift+T'],
  })
  await controller.saveShortcuts('plugin:tools:trim', ['Mod+Shift+L'])
  expect(await controller.run('plugin:tools:trim')).toBe(false)
  const remove = controller.register({
    id: 'plugin:tools:trim',
    title: 'Trim',
    context: 'material',
    execute,
  })
  expect(
    controller.commands.value.find((entry) => entry.id === 'plugin:tools:trim')?.defaultShortcuts,
  ).toEqual(['Mod+Shift+T'])
  expect(await controller.run('plugin:tools:trim')).toBe(true)
  remove()
  expect(controller.commands.value.some((entry) => entry.id === 'plugin:tools:trim')).toBe(true)
  expect(await controller.run('plugin:tools:trim')).toBe(false)
  definition()
  expect(controller.commands.value.some((entry) => entry.id === 'plugin:tools:trim')).toBe(false)
  expect(controller.bindings('plugin:tools:trim')).toEqual(['Mod+Shift+L'])
})
it('preserves native text edits, shadow editors, IME, dialog and control navigation', () => {
  const { controller } = setup(),
    execute = vi.fn()
  controller.register({
    id: 'app.add',
    title: 'Add',
    context: 'global',
    defaultShortcuts: ['A'],
    execute,
  })
  for (const options of [{ isComposing: true }, { repeat: true }, { keyCode: 229 }])
    expect(controller.dispatch(key('a', options))).toBe(false)
  const host = document.createElement('div'),
    input = document.createElement('textarea')
  document.body.append(host)
  host.attachShadow({ mode: 'open' }).append(input)
  let handled = false
  const listener = (event: KeyboardEvent) => {
    handled = controller.dispatch(event)
  }
  window.addEventListener('keydown', listener)
  input.dispatchEvent(key('a', { composed: true }))
  window.removeEventListener('keydown', listener)
  expect(handled).toBe(false)
  document.body.append(Object.assign(document.createElement('dialog'), { open: true }))
  expect(controller.dispatch(key('a'))).toBe(false)
  expect(execute).not.toHaveBeenCalled()
})
it('does not report failed persistence as saved and ignores old-scope completion', async () => {
  const { controller, scope } = setup()
  useSettingsStore({
    getItem: () => null,
    setItem: async () => {
      throw new Error('disk full')
    },
  })
  await expect(controller.saveShortcuts('app.add', ['K'])).rejects.toThrow('disk full')
  expect(controller.bindings('app.add')).toEqual(['A'])
  expect(controller.error.value).toContain('未能保存')
  let resolve!: () => void
  useSettingsStore({
    getItem: () => null,
    setItem: () =>
      new Promise<void>((done) => {
        resolve = done
      }),
  })
  const saving = controller.saveShortcuts('app.add', ['K'])
  await Promise.resolve()
  await Promise.resolve()
  scope.value = 'library-b'
  resolve()
  await saving
  expect(controller.bindings('app.add')).toEqual(['A'])
})
it('normalizes malformed imported settings and applies independent instance state', async () => {
  expect(
    normalizeInputPreferences({
      gestures: {
        enabled: 'true',
        threshold: NaN,
        width: 500,
        color: 'url(x)',
        bindings: { LL: 'x', LR: 'plugin:ok:run' },
      },
    }),
  ).toMatchObject({
    gestures: {
      enabled: false,
      threshold: 18,
      width: 12,
      color: '#6fa880',
      bindings: { LR: 'plugin:ok:run' },
    },
  })
  const a = setup().controller,
    b = setup().controller
  await a.saveShortcuts('app.add', ['K'])
  expect(a.bindings('app.add')).toEqual(['K'])
  expect(b.bindings('app.add')).toEqual(['A'])
  a.dispose()
  expect(await a.run('app.add')).toBe(false)
})
