import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { readSetting, writeSetting, type SettingsStore } from '../settings-store'

export const SIDEBAR_WIDTH_KEY = 'repeaty.sidebar.width.v1'
export const SIDEBAR_EXPANDED_WIDTH_KEY = 'repeaty.sidebar.expanded-width.v1'
export const SIDEBAR_DEFAULT_WIDTH = 80
const DEFAULT_EXPANDED_WIDTH = 208
export const SIDEBAR_MIN_WIDTH = 72
export const SIDEBAR_MAX_WIDTH = 360
const COLLAPSED_WIDTH = 160
const MIN_CONTENT_WIDTH = 400

interface SidebarLayoutOptions {
  desktop: boolean
  scope: Readonly<Ref<unknown>>
  ready: Readonly<Ref<boolean>>
  settings?: SettingsStore
}

/** Each application owns its width and active gesture; only the selected library stores preferences. */
export function useSidebarLayout({
  desktop,
  scope,
  ready,
  settings = { getItem: readSetting, setItem: writeSetting },
}: SidebarLayoutOptions) {
  const { width: viewportWidth } = useWindowSize()
  const preferredWidth = ref(SIDEBAR_DEFAULT_WIDTH)
  const expandedWidth = ref(DEFAULT_EXPANDED_WIDTH)
  const resizing = ref(false)
  const vertical = computed(() => desktop || viewportWidth.value > 720)
  const maxWidth = computed(() =>
    Math.max(
      SIDEBAR_MIN_WIDTH,
      Math.min(SIDEBAR_MAX_WIDTH, viewportWidth.value - MIN_CONTENT_WIDTH),
    ),
  )
  const width = computed(() => Math.min(preferredWidth.value, maxWidth.value))
  const collapsed = computed(() => vertical.value && width.value < COLLAPSED_WIDTH)
  const canToggle = computed(() => vertical.value && maxWidth.value >= COLLAPSED_WIDTH)
  let gesture:
    | { pointerId: number; element: HTMLElement; x: number; width: number; preferredWidth: number }
    | undefined

  function save() {
    if (!ready.value) return
    try {
      const pending = settings.setItem(SIDEBAR_WIDTH_KEY, String(preferredWidth.value))
      if (pending instanceof Promise) void pending.catch(() => {})
    } catch {
      // A storage failure must not interrupt this session's layout or pointer cleanup.
    }
  }

  function finish(commit: boolean) {
    const previous = gesture
    if (!previous) return
    gesture = undefined
    resizing.value = false
    if (!commit) preferredWidth.value = previous.preferredWidth
    try {
      previous.element.releasePointerCapture(previous.pointerId)
    } catch {
      // Capture may already have been released by cancellation or element removal.
    }
    if (commit && preferredWidth.value !== previous.preferredWidth) save()
  }

  function restore() {
    finish(false)
    preferredWidth.value = SIDEBAR_DEFAULT_WIDTH
    expandedWidth.value = DEFAULT_EXPANDED_WIDTH
    if (!ready.value) return
    try {
      const saved = settings.getItem(SIDEBAR_WIDTH_KEY)
      const expanded = Number(settings.getItem(SIDEBAR_EXPANDED_WIDTH_KEY))
      if (Number.isFinite(expanded) && expanded >= COLLAPSED_WIDTH) {
        expandedWidth.value = Math.min(SIDEBAR_MAX_WIDTH, Math.round(expanded))
      }
      const value = saved === null || saved.trim() === '' ? NaN : Number(saved)
      if (Number.isFinite(value)) {
        preferredWidth.value = Math.min(
          SIDEBAR_MAX_WIDTH,
          Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)),
        )
        if (preferredWidth.value >= COLLAPSED_WIDTH) expandedWidth.value = preferredWidth.value
      }
    } catch {
      // Browser storage can be unavailable; the default still provides a usable layout.
    }
  }

  function startResize(event: PointerEvent) {
    if (!vertical.value || gesture || event.button !== 0 || !event.isPrimary) return
    const element = event.currentTarget as HTMLElement
    try {
      element.setPointerCapture(event.pointerId)
    } catch {
      return
    }
    event.preventDefault()
    element.focus({ preventScroll: true })
    gesture = {
      pointerId: event.pointerId,
      element,
      x: event.clientX,
      width: width.value,
      preferredWidth: preferredWidth.value,
    }
    resizing.value = true
  }

  function moveResize(event: PointerEvent) {
    if (gesture?.pointerId !== event.pointerId) return
    preferredWidth.value = Math.min(
      maxWidth.value,
      Math.max(SIDEBAR_MIN_WIDTH, Math.round(gesture.width + event.clientX - gesture.x)),
    )
  }

  function endResize(event: PointerEvent) {
    if (gesture?.pointerId === event.pointerId) finish(true)
  }

  function cancelResize(event: PointerEvent) {
    if (gesture?.pointerId === event.pointerId) finish(false)
  }

  function resizeWithKeyboard(event: KeyboardEvent) {
    if (!vertical.value || gesture) return
    const widths: Partial<Record<string, number>> = {
      ArrowLeft: width.value - 8,
      ArrowRight: width.value + 8,
      Home: SIDEBAR_MIN_WIDTH,
      End: maxWidth.value,
    }
    const next = widths[event.key]
    if (next === undefined) return
    event.preventDefault()
    preferredWidth.value = Math.min(maxWidth.value, Math.max(SIDEBAR_MIN_WIDTH, next))
    save()
  }

  function resetWidth() {
    if (!vertical.value) return
    finish(false)
    preferredWidth.value = SIDEBAR_DEFAULT_WIDTH
    save()
  }

  function toggle() {
    if (!canToggle.value) return
    finish(false)
    if (collapsed.value) {
      preferredWidth.value = Math.min(maxWidth.value, expandedWidth.value)
    } else {
      expandedWidth.value = preferredWidth.value
      if (ready.value) {
        try {
          const pending = settings.setItem(SIDEBAR_EXPANDED_WIDTH_KEY, String(expandedWidth.value))
          if (pending instanceof Promise) void pending.catch(() => {})
        } catch {
          // Collapsing remains usable when preferences cannot be saved.
        }
      }
      preferredWidth.value = SIDEBAR_DEFAULT_WIDTH
    }
    save()
  }

  watch([scope, ready], restore, { immediate: true, flush: 'sync' })
  watch(vertical, (enabled) => {
    if (!enabled) finish(false)
  })
  onScopeDispose(() => finish(false))

  return {
    width,
    maxWidth,
    collapsed,
    canToggle,
    toggle,
    resizing,
    vertical,
    startResize,
    moveResize,
    endResize,
    cancelResize,
    resizeWithKeyboard,
    resetWidth,
  }
}
