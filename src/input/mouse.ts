import { watch, type Ref } from 'vue'
import type { InputController } from './controller'
import { t } from '../i18n'
import { createGestureTracker, gestureLabel, type GesturePoint } from './gestures'

/** Right-button drags only. Native click/selection, touch and pen paths remain untouched. */
export function installMouseGestures(controller: InputController, scope: Ref<string>) {
  let tracking: ReturnType<typeof createGestureTracker> | undefined
  let pointerId: number | undefined,
    scopeAtStart = '',
    suppressUntil = 0
  let overlay: HTMLDivElement | undefined,
    line: SVGPolylineElement | undefined,
    hint: HTMLDivElement | undefined
  let points: GesturePoint[] = []
  const clear = () => {
    tracking = undefined
    pointerId = undefined
    overlay?.remove()
    overlay = undefined
    line = undefined
    hint = undefined
    points = []
  }
  function down(event: PointerEvent) {
    if (
      event.pointerType !== 'mouse' ||
      event.button !== 2 ||
      event.buttons !== 2 ||
      !controller.state.value.gestures.enabled ||
      event.defaultPrevented
    )
      return
    if (
      document.querySelector('dialog[open], [data-app-modal-content]') ||
      event
        .composedPath()
        .some(
          (target) =>
            target instanceof HTMLElement &&
            (target.matches(
              'input,textarea,select,button,a,[contenteditable="true"],[role="menu"],[data-gesture-recorder]',
            ) ||
              target.isContentEditable),
        )
    )
      return
    clear()
    scopeAtStart = scope.value
    pointerId = event.pointerId
    points = [{ x: event.clientX, y: event.clientY }]
    tracking = createGestureTracker(points[0]!, controller.state.value.gestures.threshold)
  }
  function draw() {
    if (!tracking?.path) return
    const settings = controller.state.value.gestures
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.setAttribute('aria-hidden', 'true')
      overlay.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;'
      if (settings.trail) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;'
        line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
        line.setAttribute('fill', 'none')
        line.setAttribute('stroke', settings.color)
        line.setAttribute('stroke-width', String(settings.width))
        line.setAttribute('opacity', String(settings.opacity))
        line.setAttribute('stroke-linejoin', 'round')
        line.setAttribute('stroke-linecap', 'round')
        svg.append(line)
        overlay.append(svg)
      }
      if (settings.hint) {
        hint = document.createElement('div')
        hint.style.cssText =
          'position:absolute;bottom:24px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:8px;background:var(--ui-bg-elevated,Canvas);color:var(--ui-text,CanvasText);border:1px solid var(--ui-border,GrayText);max-width:80%;'
        overlay.append(hint)
      }
      document.body.append(overlay)
    }
    line?.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '))
    const id = settings.bindings[tracking.path]
    const command = controller.commands.value.find(
      (entry) => entry.id === id && entry.available?.() !== false,
    )
    if (hint)
      hint.textContent = `${gestureLabel(tracking.path)}${command ? ` · ${t(command.title)}` : ''}`
  }
  function move(event: PointerEvent) {
    if (pointerId !== event.pointerId || !tracking) return
    if (event.buttons !== 2 || scopeAtStart !== scope.value) {
      clear()
      return
    }
    const point = { x: event.clientX, y: event.clientY }
    tracking.move(point)
    const previous = points.at(-1)!
    if (
      Math.hypot(point.x - previous.x, point.y - previous.y) >=
      controller.state.value.gestures.pointThreshold
    ) {
      if (points.length < 512) points.push(point)
      else points[points.length - 1] = point
    }
    draw()
  }
  function up(event: PointerEvent) {
    if (pointerId !== event.pointerId || !tracking) return
    const path = tracking.path,
      expectedScope = scopeAtStart
    clear()
    if (!path) return
    suppressUntil = Date.now() + 700
    const id = controller.state.value.gestures.bindings[path]
    if (id && scope.value === expectedScope && controller.state.value.gestures.enabled)
      void controller.run(id)
  }
  const menu = (event: MouseEvent) => {
    if (tracking?.path || Date.now() < suppressUntil) event.preventDefault()
  }
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && tracking) {
      suppressUntil = Date.now() + 700
      clear()
      event.preventDefault()
    }
  }
  const stop = watch([scope, () => controller.state.value.gestures], clear, { flush: 'sync' })
  window.addEventListener('pointerdown', down)
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', clear)
  window.addEventListener('blur', clear)
  window.addEventListener('contextmenu', menu, true)
  window.addEventListener('keydown', escape, true)
  return () => {
    stop()
    clear()
    window.removeEventListener('pointerdown', down)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', clear)
    window.removeEventListener('blur', clear)
    window.removeEventListener('contextmenu', menu, true)
    window.removeEventListener('keydown', escape, true)
  }
}
