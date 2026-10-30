// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createInputController } from './controller'
import { createGestureTracker, defaultGestures, gestureLabel, validGesture } from './gestures'
import { installMouseGestures } from './mouse'
import { useSettingsStore } from '../settings-store'
const dispose: (() => void)[] = []
beforeEach(() => useSettingsStore({ getItem: () => null, setItem: () => {} }))
afterEach(() => {
  dispose.splice(0).forEach((fn) => fn())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})
function pointer(type: string, x: number, y: number, options: PointerEventInit = {}) {
  return new PointerEvent(type, {
    pointerId: 1,
    pointerType: 'mouse',
    button: 2,
    buttons: type === 'pointerup' ? 0 : 2,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    ...options,
  })
}
async function setup() {
  const scope = ref('a'),
    input = createInputController(scope),
    execute = vi.fn()
  input.register({ id: 'test.run', title: 'Action', context: 'global', execute })
  await input.saveGestures({ ...defaultGestures, enabled: true, bindings: { RD: 'test.run' } })
  dispose.push(input.dispose, installMouseGestures(input, scope))
  return { scope, input, execute }
}
it('recognizes stable directions beyond a threshold and bounds custom shapes', () => {
  const track = createGestureTracker({ x: 0, y: 0 }, 18)
  expect(track.move({ x: 10, y: 0 })).toBe('')
  expect(track.move({ x: 30, y: 0 })).toBe('R')
  expect(track.move({ x: 60, y: 0 })).toBe('R')
  expect(track.move({ x: 60, y: 30 })).toBe('RD')
  expect(validGesture('RDLU')).toBe(true)
  expect(validGesture('RR')).toBe(false)
  expect(validGesture('RDLURDLUR')).toBe(false)
  expect(gestureLabel('RD')).toBe('→ ↓')
})
it('runs one mapped right-button gesture and suppresses only its resulting context menu', async () => {
  const { execute } = await setup()
  window.dispatchEvent(pointer('pointerdown', 0, 0))
  window.dispatchEvent(pointer('pointermove', 40, 0))
  window.dispatchEvent(pointer('pointermove', 40, 40))
  expect(document.querySelector('polyline')).not.toBeNull()
  window.dispatchEvent(pointer('pointerup', 40, 40))
  expect(execute).toHaveBeenCalledTimes(1)
  const menu = new MouseEvent('contextmenu', { cancelable: true })
  window.dispatchEvent(menu)
  expect(menu.defaultPrevented).toBe(true)
  expect(document.querySelector('polyline')).toBeNull()
})
it('keeps right click and left, touch, pen, editor and selection controls intact', async () => {
  const { execute } = await setup()
  window.dispatchEvent(pointer('pointerdown', 0, 0))
  window.dispatchEvent(pointer('pointerup', 0, 0))
  const menu = new MouseEvent('contextmenu', { cancelable: true })
  window.dispatchEvent(menu)
  expect(menu.defaultPrevented).toBe(false)
  for (const options of [
    { pointerType: 'touch' },
    { pointerType: 'pen' },
    { button: 0, buttons: 1 },
  ]) {
    window.dispatchEvent(pointer('pointerdown', 0, 0, options))
    window.dispatchEvent(pointer('pointermove', 40, 0, options))
    window.dispatchEvent(pointer('pointermove', 40, 40, options))
    window.dispatchEvent(pointer('pointerup', 40, 40, options))
  }
  const editor = document.createElement('textarea')
  document.body.append(editor)
  editor.dispatchEvent(pointer('pointerdown', 0, 0))
  window.dispatchEvent(pointer('pointermove', 40, 0))
  window.dispatchEvent(pointer('pointermove', 40, 40))
  window.dispatchEvent(pointer('pointerup', 40, 40))
  expect(execute).not.toHaveBeenCalled()
})
it('cancels on scope change, disable, blur, pointercancel, escape and unmount', async () => {
  const { input, scope, execute } = await setup()
  const begin = () => {
    window.dispatchEvent(pointer('pointerdown', 0, 0))
    window.dispatchEvent(pointer('pointermove', 40, 0))
    window.dispatchEvent(pointer('pointermove', 40, 40))
  }
  const end = () => window.dispatchEvent(pointer('pointerup', 40, 40))
  for (const type of ['blur', 'pointercancel']) {
    begin()
    window.dispatchEvent(new Event(type))
    end()
  }
  begin()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  end()
  begin()
  scope.value = 'b'
  end()
  await input.saveGestures({ ...defaultGestures, enabled: true, bindings: { RD: 'test.run' } })
  begin()
  await input.saveGestures({ ...defaultGestures, enabled: false, bindings: { RD: 'test.run' } })
  end()
  expect(execute).not.toHaveBeenCalled()
})
