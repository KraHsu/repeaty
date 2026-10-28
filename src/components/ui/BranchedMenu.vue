<!-- Adapted from official Vue Bits BranchedMenu.vue and React Bits BranchedMenu.css.
     Copyright (c) 2025–2026 David Haz. See public/licenses/branched-menu.txt and
     docs/third-party/react-bits-branched-menu.LICENSE.md for pinned upstream sources. -->
<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef,
  watch,
} from 'vue'
import type { SettingsCategoryNode } from '../../settings/types'
import BranchedMenuNode from './BranchedMenuNode.vue'
import {
  branchedMenuKey,
  fallbackBranchGeometry,
  flattenBranchedMenu,
  menuAncestors,
  visibleMenuRows,
  type BranchGeometry,
} from './branched-menu'

const props = defineProps<{
  items: readonly SettingsCategoryNode[]
  modelValue: string
  label: string
  idPrefix: string
  controls: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const nav = ref<HTMLElement>()
const marker = ref<HTMLElement>()
const rows = computed(() => flattenBranchedMenu(props.items))
const roots = computed(() => rows.value.filter((row) => row.depth === 1).map((row) => row.node))
const expanded = ref(
  new Set([
    ...rows.value
      .filter((row) => row.node.key === 'general' && row.node.children.length)
      .map((row) => row.node.key),
    ...menuAncestors(rows.value, props.modelValue),
  ]),
)
const focused = ref(
  rows.value.some((row) => row.node.key === props.modelValue)
    ? props.modelValue
    : (rows.value[0]?.node.key ?? ''),
)
const visible = computed(() => visibleMenuRows(rows.value, expanded.value))
const selectedPath = computed<ReadonlySet<string>>(
  () => new Set([...menuAncestors(rows.value, props.modelValue), props.modelValue]),
)
const geometry = shallowRef(new Map<string, BranchGeometry>())
const rowElements = new Map<string, HTMLElement>()
const groupElements = new Map<string, HTMLElement>()
let observer: ResizeObserver | undefined
let alive = true
let mounted = false

function htmlElement(value: unknown) {
  const element = value && typeof value === 'object' && '$el' in value ? value.$el : value
  return element instanceof HTMLElement ? element : undefined
}
function registerRow(key: string, value: unknown) {
  const element = htmlElement(value)
  if (element) rowElements.set(key, element)
  else rowElements.delete(key)
}
function registerGroup(key: string, value: unknown) {
  const old = groupElements.get(key)
  const element = htmlElement(value)
  if (old === element) return
  if (old) observer?.unobserve(old)
  if (element) {
    groupElements.set(key, element)
    observer?.observe(element)
  } else groupElements.delete(key)
}
function measure(glide = false) {
  if (!alive || !nav.value) return
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const next = new Map<string, BranchGeometry>()
  for (const row of rows.value) {
    const children = rows.value.filter((child) => child.parent === row.node.key)
    if (!children.length) continue
    const fallback = fallbackBranchGeometry(children.length, rem)
    const group = groupElements.get(row.node.key)
    const box = group?.getBoundingClientRect()
    const measured = children.map((child) =>
      rowElements.get(child.node.key)?.getBoundingClientRect(),
    )
    next.set(
      row.node.key,
      box?.height && measured.every((child) => child?.height)
        ? {
            ...fallback,
            height: box.height,
            centers: measured.map((child) => child!.top - box.top + child!.height / 2),
          }
        : (geometry.value.get(row.node.key) ?? fallback),
    )
  }
  geometry.value = next
  const active = rows.value.find((row) => row.node.key === props.modelValue)
  const head = active && rowElements.get(active.root)
  const shown = !!head && visible.value.some((row) => row.node.key === props.modelValue)
  if (!marker.value) return
  if (!glide) marker.value.style.transition = 'none'
  if (head && shown) {
    const top =
      head.getBoundingClientRect().top - nav.value.getBoundingClientRect().top + nav.value.scrollTop
    marker.value.style.top = `${top + (head.offsetHeight - rem) / 2}px`
  }
  marker.value.toggleAttribute('data-on', shown)
  if (!glide) {
    void marker.value.offsetHeight
    marker.value.style.transition = ''
  }
}
async function focus(key: string) {
  if (!visible.value.some((row) => row.node.key === key)) return
  focused.value = key
  await nextTick()
  if (alive) {
    const element = rowElements.get(key)
    element?.focus({ preventScroll: true })
    element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }
}
function select(key: string) {
  const row = rows.value.find((entry) => entry.node.key === key)
  if (!row) return
  const next = new Set(expanded.value)
  for (const ancestor of menuAncestors(rows.value, key)) next.add(ancestor)
  if (rows.value.some((entry) => entry.parent === key)) next.add(key)
  expanded.value = next
  focused.value = key
  emit('update:modelValue', key)
}
function toggle(key: string, focusRow = true) {
  if (!rows.value.some((row) => row.parent === key)) return
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
  if (focusRow) void focus(key)
}
function keydown(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-category-key]')
  if (!target || !nav.value?.contains(target)) return
  const key = target.dataset.categoryKey!
  const index = visible.value.findIndex((row) => row.node.key === key)
  const row = visible.value[index]
  if (
    !row ||
    !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(
      event.key,
    )
  )
    return
  event.preventDefault()
  event.stopPropagation()
  let next: string | undefined
  if (event.key === 'ArrowUp') next = visible.value[Math.max(0, index - 1)]?.node.key
  else if (event.key === 'ArrowDown')
    next = visible.value[Math.min(visible.value.length - 1, index + 1)]?.node.key
  else if (event.key === 'Home') next = visible.value[0]?.node.key
  else if (event.key === 'End') next = visible.value.at(-1)?.node.key
  else if (event.key === 'ArrowRight') {
    const child = rows.value.find((entry) => entry.parent === key)
    if (child && !expanded.value.has(key)) toggle(key)
    else next = child?.node.key
  } else if (event.key === 'ArrowLeft') {
    if (expanded.value.has(key) && rows.value.some((entry) => entry.parent === key)) toggle(key)
    else next = row.parent
  } else select(key)
  if (next) void focus(next)
}

watch([rows, () => props.modelValue], ([current, selected], previous) => {
  const restoreFocus = nav.value?.contains(document.activeElement)
  const previousFocus = focused.value
  const next = new Set(
    [...expanded.value].filter((key) => current.some((row) => row.parent === key)),
  )
  if (!previous || selected !== previous[1]) {
    for (const key of menuAncestors(current, selected)) next.add(key)
    if (current.some((row) => row.node.key === selected)) focused.value = selected
  }
  expanded.value = next
  const available = visibleMenuRows(current, next)
  if (!available.some((row) => row.node.key === focused.value)) {
    const oldRows = previous?.[0] ?? []
    focused.value =
      [...menuAncestors(oldRows, focused.value)]
        .reverse()
        .find((key) => available.some((row) => row.node.key === key)) ??
      available[0]?.node.key ??
      ''
  }
  if (restoreFocus && focused.value !== previousFocus) void focus(focused.value)
})
watch(
  [rows, expanded, () => props.modelValue],
  async () => {
    await nextTick()
    if (mounted && alive) measure(true)
  },
  { flush: 'post' },
)
onMounted(() => {
  mounted = true
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => measure(false))
    if (nav.value) observer.observe(nav.value)
    for (const group of groupElements.values()) observer.observe(group)
  }
  measure(false)
})
onBeforeUnmount(() => {
  alive = false
  observer?.disconnect()
  rowElements.clear()
  groupElements.clear()
})
provide(branchedMenuKey, {
  active: computed(() => props.modelValue),
  selectedPath,
  focused,
  expanded,
  rows,
  geometry,
  idPrefix: props.idPrefix,
  controls: props.controls,
  registerRow,
  registerGroup,
  select,
  toggle,
})
</script>

<template>
  <nav ref="nav" class="branched-menu" :aria-label="label">
    <span ref="marker" class="branched-menu__marker" aria-hidden="true" />
    <div role="tree" :aria-label="label" @keydown="keydown">
      <BranchedMenuNode v-for="node in roots" :key="node.key" :node="node" />
    </div>
  </nav>
</template>

<style>
/* Original Branched Menu geometry and motion, themed with application tokens.
   Conventional buttons and collapsing content remain Nuxt UI components. */
.branched-menu {
  --bm-row: 2.75rem;
  --bm-indent: 2.5rem;
  --bm-line-w: 1.5;
  --bm-draw: 400ms;
  --bm-fold: 300ms;
  --bm-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  position: relative;
  min-width: 0;
  max-width: 100%;
  padding-left: 0.875rem;
  color: var(--text);
  font-family: var(--font-ui);
  font-size: var(--font-size-control);
  line-height: var(--line-height-ui);
}
.branched-menu::before {
  content: '';
  position: absolute;
  top: 0.5rem;
  bottom: 0;
  left: 0;
  width: 2px;
  border-radius: 1px;
  background: linear-gradient(to bottom, var(--line) 0%, var(--line) 55%, transparent 100%);
}
.branched-menu__marker {
  position: absolute;
  top: -1px;
  left: 0;
  z-index: 1;
  width: 2px;
  height: 1rem;
  border-radius: 1px;
  background: var(--ui-control-focus);
  opacity: 0;
  transition:
    top 220ms var(--bm-ease-out),
    opacity 150ms ease;
}
.branched-menu__marker[data-on] {
  opacity: 1;
}
.branched-menu__section,
.branched-menu__folder {
  min-width: 0;
}
.branched-menu__row {
  display: flex;
  align-items: center;
  min-width: 0;
}
.branched-menu button.branched-menu__select {
  display: flex;
  flex: 1;
  justify-content: flex-start;
  min-width: 0;
  height: var(--bm-row);
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--muted);
  font: inherit;
  text-align: left;
  box-shadow: none;
  transition: color 200ms ease;
}
.branched-menu__section[data-open] > .branched-menu__row > .branched-menu__select,
.branched-menu button.branched-menu__select:hover {
  color: var(--text);
}
.branched-menu button.branched-menu__select[data-active] {
  color: var(--ui-control-focus);
  font-weight: var(--font-weight-semibold);
}
.branched-menu__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.branched-menu button.branched-menu__toggle {
  flex: 0 0 2rem;
  justify-content: center;
  width: 2rem;
  height: var(--bm-row);
  padding: 0;
  color: var(--muted);
  background: transparent;
  border: 0;
  box-shadow: none;
}
.branched-menu__toggle > span {
  transition: transform var(--bm-fold) var(--bm-ease-out);
}
.branched-menu__section[data-open] > .branched-menu__row > .branched-menu__toggle > span {
  transform: rotate(90deg);
}
.branched-menu button:focus-visible {
  outline: 2px solid var(--ui-control-focus);
  outline-offset: 2px;
}
.branched-menu__body {
  overflow: hidden;
}
.branched-menu__body[data-state='open'] {
  animation: branched-menu-unfold var(--bm-fold) var(--bm-ease-out);
}
.branched-menu__body[data-state='closed'] {
  animation: branched-menu-fold var(--bm-fold) var(--bm-ease-out);
}
@keyframes branched-menu-unfold {
  from {
    height: 0;
  }
  to {
    height: var(--reka-collapsible-content-height);
  }
}
@keyframes branched-menu-fold {
  from {
    height: var(--reka-collapsible-content-height);
  }
  to {
    height: 0;
  }
}
.branched-menu__tree {
  position: relative;
  min-width: 0;
  padding: 0.375rem 0;
}
.branched-menu__tree > .branched-menu__section > .branched-menu__row {
  padding-left: var(--bm-indent);
}
.branched-menu__tree > .branched-menu__section > .branched-menu__folder {
  margin-left: var(--bm-indent);
}
.branched-menu__lines {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--bm-indent);
  overflow: visible;
  pointer-events: none;
  opacity: 0;
  transition: opacity 200ms ease;
}
.branched-menu__folder[data-state='open']
  > .branched-menu__body
  > .branched-menu__tree
  > .branched-menu__lines {
  opacity: 1;
  transition: opacity 250ms ease 100ms;
}
.branched-menu__base,
.branched-menu__reach {
  fill: none;
  stroke-width: var(--bm-line-w);
  stroke-linecap: round;
  stroke-linejoin: round;
}
.branched-menu__base {
  stroke: var(--line);
}
.branched-menu__reach {
  stroke: var(--ui-control-focus);
  transition: stroke-dashoffset var(--bm-draw) var(--bm-ease-out);
}
@media (prefers-reduced-motion: reduce) {
  .branched-menu *,
  .branched-menu *::before,
  .branched-menu *::after {
    transition: none !important;
    animation: none !important;
  }
}
@media (forced-colors: active) {
  .branched-menu__base {
    stroke: GrayText;
  }
  .branched-menu__reach {
    stroke: Highlight;
  }
  .branched-menu__marker {
    background: Highlight;
  }
}
</style>
