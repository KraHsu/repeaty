<!-- Repeaty's accessible settings tree; SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import type { SettingsCategoryNode } from '../../settings/types'
import BranchedMenuNode from './BranchedMenuNode.vue'
import {
  branchedMenuKey,
  flattenBranchedMenu,
  menuAncestors,
  visibleMenuRows,
} from './branched-menu'
const props = defineProps<{
  items: readonly SettingsCategoryNode[]
  modelValue: string
  label: string
  idPrefix: string
  controls: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const nav = ref<HTMLElement>(),
  selection = ref<HTMLElement>()
const rows = computed(() => flattenBranchedMenu(props.items))
const roots = computed(() => rows.value.filter((row) => !row.parent))
const expanded = ref(new Set(['general', ...menuAncestors(rows.value, props.modelValue)]))
const focused = ref(
  rows.value.find((row) => row.node.key === props.modelValue)?.node.key ??
    rows.value[0]?.node.key ??
    '',
)
const visible = computed(() => visibleMenuRows(rows.value, expanded.value))
const selectedPath = computed<ReadonlySet<string>>(
  () => new Set([props.modelValue, ...menuAncestors(rows.value, props.modelValue)]),
)
const buttons = new Map<string, HTMLElement>(),
  groups = new Map<string, HTMLElement>()
let observer: ResizeObserver | undefined,
  disposed = false
function dom(value: unknown): HTMLElement | undefined {
  const raw = value && typeof value === 'object' && '$el' in value ? value.$el : value
  return raw instanceof HTMLElement ? raw : undefined
}
function registerRow(key: string, value: unknown) {
  const element = dom(value)
  if (element) buttons.set(key, element)
  else buttons.delete(key)
}
function registerGroup(key: string, value: unknown) {
  const element = dom(value),
    previous = groups.get(key)
  if (previous === element) return
  if (previous) observer?.unobserve(previous)
  groups.delete(key)
  if (element) {
    groups.set(key, element)
    observer?.observe(element)
  }
}
function align() {
  const container = nav.value,
    highlight = selection.value
  if (disposed || !container || !highlight) return
  const row = buttons.get(props.modelValue)?.parentElement
  const rect = row?.getBoundingClientRect()
  if (
    !rect?.height ||
    !rect.width ||
    !visible.value.some((item) => item.node.key === props.modelValue)
  ) {
    highlight.removeAttribute('data-on')
    return
  }
  const origin = container.getBoundingClientRect(),
    initial = !highlight.hasAttribute('data-on')
  if (initial) highlight.style.transition = 'none'
  Object.assign(highlight.style, {
    transform: `translate(${rect.left - origin.left + container.scrollLeft}px, ${rect.top - origin.top + container.scrollTop}px)`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  })
  highlight.setAttribute('data-on', '')
  if (initial) {
    void highlight.offsetWidth
    highlight.style.transition = ''
  }
}
async function focus(key: string) {
  if (!visible.value.some((row) => row.node.key === key)) return
  focused.value = key
  await nextTick()
  if (disposed) return
  buttons.get(key)?.focus({ preventScroll: true })
  buttons.get(key)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}
function toggle(key: string, focusRow = true) {
  if (!rows.value.some((row) => row.parent === key)) return
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
  if (focusRow) void focus(key)
}
function select(key: string) {
  if (!rows.value.some((row) => row.node.key === key)) return
  expanded.value = new Set([...expanded.value, ...menuAncestors(rows.value, key), key])
  focused.value = key
  emit('update:modelValue', key)
}
function keydown(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLElement))
    return
  const button = event.target.closest<HTMLElement>('[data-category-key]')
  if (!button || !nav.value?.contains(button)) return
  const index = visible.value.findIndex((row) => row.node.key === button.dataset.categoryKey)
  const row = visible.value[index]
  if (!row) return
  const key = row.node.key,
    child = rows.value.find((item) => item.parent === key)
  let destination: string | undefined
  switch (event.key) {
    case 'ArrowUp':
      destination = visible.value[Math.max(0, index - 1)]?.node.key
      break
    case 'ArrowDown':
      destination = visible.value[Math.min(index + 1, visible.value.length - 1)]?.node.key
      break
    case 'Home':
      destination = visible.value[0]?.node.key
      break
    case 'End':
      destination = visible.value.at(-1)?.node.key
      break
    case 'ArrowRight':
      if (child && !expanded.value.has(key)) toggle(key)
      else destination = child?.node.key
      break
    case 'ArrowLeft':
      if (child && expanded.value.has(key)) toggle(key)
      else destination = row.parent
      break
    case 'Enter':
    case ' ':
      select(key)
      break
    default:
      return
  }
  event.preventDefault()
  event.stopPropagation()
  if (destination) void focus(destination)
}
watch([rows, () => props.modelValue], ([items, value], previous) => {
  const ownsFocus = nav.value?.contains(document.activeElement)
  const previousFocus = focused.value
  const next = new Set([...expanded.value].filter((key) => items.some((row) => row.parent === key)))
  if (!previous || value !== previous[1]) {
    menuAncestors(items, value).forEach((key) => next.add(key))
    if (items.some((row) => row.node.key === value)) focused.value = value
  }
  expanded.value = next
  const available = visibleMenuRows(items, next)
  if (!available.some((row) => row.node.key === focused.value)) {
    const oldPath = menuAncestors(previous?.[0] ?? [], focused.value).reverse()
    focused.value =
      oldPath.find((key) => available.some((row) => row.node.key === key)) ??
      available[0]?.node.key ??
      ''
  }
  if (ownsFocus && previousFocus !== focused.value) void focus(focused.value)
})
watch(
  [rows, expanded, () => props.modelValue],
  async () => {
    await nextTick()
    align()
  },
  { flush: 'post' },
)
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(align)
    if (nav.value) observer.observe(nav.value)
    groups.forEach((group) => observer!.observe(group))
  }
  align()
})
onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  buttons.clear()
  groups.clear()
})
provide(branchedMenuKey, {
  rows,
  active: computed(() => props.modelValue),
  expanded,
  focused,
  selectedPath,
  idPrefix: props.idPrefix,
  controls: props.controls,
  registerRow,
  registerGroup,
  toggle,
  select,
})
</script>
<template>
  <nav ref="nav" class="branched-menu" :aria-label="label">
    <span ref="selection" class="branched-menu__selection" aria-hidden="true" />
    <div role="tree" :aria-label="label" @keydown="keydown">
      <BranchedMenuNode v-for="item in roots" :key="item.node.key" :node="item.node" />
    </div>
  </nav>
</template>
<style>
.branched-menu {
  position: relative;
  min-width: 0;
  max-width: 100%;
  padding-inline-start: 0.875rem;
  font-family: var(--font-ui);
  font-size: var(--font-size-control);
  line-height: var(--line-height-ui);
}
.branched-menu::before {
  content: '';
  position: absolute;
  inset-block: 0.5rem 0;
  inset-inline-start: 0;
  width: 2px;
  background: linear-gradient(var(--line), transparent);
}
.branched-menu__selection {
  position: absolute;
  inset: 0 auto auto 0;
  pointer-events: none;
  background: var(--app-selected);
  border-radius: 0.5rem;
  opacity: 0;
  transition:
    transform 220ms ease,
    width 220ms ease,
    height 220ms ease,
    opacity 150ms ease;
}
.branched-menu__selection[data-on] {
  opacity: 1;
}
.branched-menu > [role='tree'] {
  position: relative;
}
.branched-menu__section,
.branched-menu__folder {
  min-width: 0;
  position: relative;
}
.branched-menu__row {
  display: flex;
  align-items: center;
  min-width: 0;
  position: relative;
}
.branched-menu > [role='tree'] > .branched-menu__section > .branched-menu__row {
  margin-inline-start: -0.5rem;
}
.branched-menu
  > [role='tree']
  > .branched-menu__section
  > .branched-menu__row
  > .branched-menu__select {
  padding-inline-start: 0.5rem;
}
.branched-menu button.branched-menu__select {
  flex: 1;
  min-width: 0;
  min-height: 2.75rem;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0.25rem;
  box-shadow: none;
  justify-content: start;
  text-align: start;
  background: transparent;
  color: var(--muted);
  font: inherit;
}
.branched-menu button.branched-menu__select:hover,
.branched-menu__section[data-open] > .branched-menu__row > button {
  color: var(--ui-text);
}
.branched-menu button[data-active] {
  color: var(--ui-primary);
  font-weight: var(--font-weight-semibold);
}
.branched-menu__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.branched-menu button.branched-menu__toggle {
  width: 2rem;
  height: 2.75rem;
  flex: 0 0 2rem;
  padding: 0;
  border: 0;
  box-shadow: none;
  background: transparent;
  justify-content: center;
  color: var(--muted);
}
.branched-menu button:focus-visible {
  outline: 2px solid var(--ui-control-focus);
  outline-offset: 2px;
}
.branched-menu__body {
  overflow: hidden;
}
.branched-menu__body[data-state='open'] {
  animation: repeaty-tree-open 240ms ease;
}
.branched-menu__body[data-state='closed'] {
  animation: repeaty-tree-close 240ms ease;
}
@keyframes repeaty-tree-open {
  from {
    height: 0;
  }
  to {
    height: var(--reka-collapsible-content-height);
  }
}
@keyframes repeaty-tree-close {
  from {
    height: var(--reka-collapsible-content-height);
  }
  to {
    height: 0;
  }
}
.branched-menu__tree {
  position: relative;
  padding-block: 0.375rem;
}
.branched-menu__tree > .branched-menu__section::before {
  content: '';
  position: absolute;
  inset-inline-start: 0.875rem;
  top: 0;
  bottom: 0;
  border-inline-start: 1px solid var(--line);
}
.branched-menu__tree > .branched-menu__section:last-child::before {
  bottom: auto;
  height: 1.375rem;
}
.branched-menu__tree > .branched-menu__section > .branched-menu__row {
  padding-inline-start: 2.5rem;
}
.branched-menu__tree > .branched-menu__section > .branched-menu__folder {
  margin-inline-start: 2.5rem;
}
.branched-menu__branch {
  position: absolute;
  inset-inline-start: 0.875rem;
  bottom: 50%;
  width: 1.125rem;
  height: 0.75rem;
  border-inline-start: 1px solid var(--line);
  border-block-end: 1px solid var(--line);
  border-end-start-radius: 0.75rem;
  pointer-events: none;
  transition: border-color 180ms ease;
}
.branched-menu__section[data-path] > .branched-menu__row > .branched-menu__branch {
  border-color: var(--ui-primary);
}
@media (prefers-reduced-motion: reduce) {
  .branched-menu * {
    transition: none !important;
    animation: none !important;
  }
}
@media (forced-colors: active) {
  .branched-menu__selection {
    background: Highlight;
    opacity: 0.2;
  }
  .branched-menu__branch {
    border-color: GrayText;
  }
}
</style>
