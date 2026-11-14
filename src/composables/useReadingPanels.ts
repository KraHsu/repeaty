import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { readSetting, writeSetting } from '../settings-store'

const key = 'repeaty.reading-panels.v1'
export function useReadingPanels(scope: Readonly<Ref<string>>) {
  const left = ref(224),
    right = ref(260)
  const contextVisible = ref(true)
  const organization = ref<'list' | 'tree'>('list')
  let drag:
    | { element: HTMLElement; id: number; side: 'left' | 'right'; x: number; value: number }
    | undefined
  const bound = (value: number, side: 'left' | 'right') =>
    Math.round(Math.max(180, Math.min(side === 'left' ? 320 : 380, value)))
  function save() {
    try {
      writeSetting(
        key,
        JSON.stringify({
          left: left.value,
          right: right.value,
          contextOpen: contextVisible.value,
          organizationView: organization.value,
        }),
      )
    } catch {
      /* Layout remains usable without preference storage. */
    }
  }
  function finish(commit: boolean) {
    const previous = drag
    if (!previous) return
    drag = undefined
    if (!commit) (previous.side === 'left' ? left : right).value = previous.value
    try {
      previous.element.releasePointerCapture(previous.id)
    } catch {
      /* Already released. */
    }
    if (commit) save()
  }
  function start(event: PointerEvent, side: 'left' | 'right') {
    if (event.button !== 0 || !event.isPrimary || drag) return
    const element = event.currentTarget as HTMLElement
    try {
      element.setPointerCapture(event.pointerId)
    } catch {
      return
    }
    event.preventDefault()
    element.focus({ preventScroll: true })
    drag = {
      element,
      id: event.pointerId,
      side,
      x: event.clientX,
      value: (side === 'left' ? left : right).value,
    }
  }
  function move(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return
    const delta = (event.clientX - drag.x) * (drag.side === 'left' ? 1 : -1)
    ;(drag.side === 'left' ? left : right).value = bound(drag.value + delta, drag.side)
  }
  function end(event: PointerEvent) {
    if (drag?.id === event.pointerId) finish(true)
  }
  function cancel(event: PointerEvent) {
    if (drag?.id === event.pointerId) finish(false)
  }
  function keyboard(event: KeyboardEvent, side: 'left' | 'right') {
    const value = side === 'left' ? left : right
    const sign = side === 'left' ? 1 : -1
    const next =
      event.key === 'Home'
        ? 180
        : event.key === 'End'
          ? side === 'left'
            ? 320
            : 380
          : event.key === 'ArrowLeft'
            ? value.value - 8 * sign
            : event.key === 'ArrowRight'
              ? value.value + 8 * sign
              : undefined
    if (next === undefined) return
    event.preventDefault()
    value.value = bound(next, side)
    save()
  }
  watch(
    scope,
    () => {
      finish(false)
      left.value = 224
      right.value = 260
      contextVisible.value = true
      organization.value = 'list'
      try {
        const stored = JSON.parse(readSetting(key) ?? '{}')
        if (Number.isFinite(stored.left)) left.value = bound(stored.left, 'left')
        if (Number.isFinite(stored.right)) right.value = bound(stored.right, 'right')
        if (typeof stored.contextOpen === 'boolean') contextVisible.value = stored.contextOpen
        if (stored.organizationView === 'tree') organization.value = 'tree'
      } catch {
        /* Invalid saved geometry uses the default. */
      }
    },
    { immediate: true, flush: 'sync' },
  )
  onScopeDispose(() => finish(false))
  return {
    left,
    right,
    contextOpen: computed({
      get: () => contextVisible.value,
      set: (value: boolean) => {
        contextVisible.value = value
        save()
      },
    }),
    organizationView: computed({
      get: () => organization.value,
      set: (value: 'list' | 'tree') => {
        organization.value = value
        save()
      },
    }),
    style: computed(() => ({
      '--reading-list-width': `${left.value}px`,
      '--reading-context-width': `${right.value}px`,
    })),
    start,
    move,
    end,
    cancel,
    keyboard,
  }
}
