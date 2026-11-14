<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { UiNotice } from '@repeaty/plugin-api'
import { formulaLeaves, leavesInRange, RENDERER, renderFormula, sameTokens } from './formula'
import type { FormulaData } from './model'
import './katex.css'
const props = defineProps<{
  latex: string
  data?: FormulaData
  active?: string
  revealed?: boolean
  editable?: boolean
  selected?: number[]
  highlight?: number[]
}>()
const emit = defineEmits<{ ready: [tokens: string[]]; select: [leaves: number[]] }>()
const root = ref<HTMLElement>(),
  html = ref(''),
  error = ref('')
let nodes: HTMLElement[] = [],
  tokens: string[] = [],
  generation = 0,
  anchor: number | undefined
function decorate() {
  nodes.forEach((node, index) => {
    const active = props.data?.regions.find((region) => region.id === props.active)
    const hidden =
      !props.editable &&
      props.data?.regions.some(
        (region) =>
          region.leaves.includes(index) &&
          (region.id === active?.id ? !props.revealed : props.data?.mode === 'all'),
      )
    node.classList.toggle('vo-leaf-masked', !!hidden)
    node.classList.toggle(
      'vo-leaf-active',
      !hidden && (!!active?.leaves.includes(index) || !!props.highlight?.includes(index)),
    )
    node.classList.toggle(
      'vo-leaf-selected',
      props.editable === true && !!props.selected?.includes(index),
    )
    node.classList.toggle('vo-leaf-editable', props.editable === true)
    if (props.editable) {
      node.tabIndex = 0
      node.setAttribute('role', 'button')
      node.setAttribute('aria-pressed', String(props.selected?.includes(index) ?? false))
    } else {
      node.removeAttribute('tabindex')
      node.removeAttribute('role')
      node.removeAttribute('aria-pressed')
    }
    if (hidden) {
      node.setAttribute('aria-label', '遮挡内容')
      node.setAttribute('role', 'img')
    } else node.removeAttribute('aria-label')
  })
}
watch(
  () => props.latex,
  async (latex) => {
    const current = ++generation
    error.value = ''
    nodes = []
    tokens = []
    try {
      html.value = renderFormula(latex)
      await nextTick()
      if (current !== generation || !root.value) return
      const leaves = formulaLeaves(root.value)
      nodes = leaves.nodes
      tokens = leaves.tokens
      if (!nodes.length) throw new Error('此公式没有可选择的文字元素。')
      if (
        props.data &&
        (props.data.renderer !== RENDERER || !sameTokens(props.data.tokens, tokens))
      )
        throw new Error(
          '公式渲染版本或结构已变化，请编辑并重新选择遮挡区域。原始公式和历史仍然保留。',
        )
      emit('ready', tokens)
      decorate()
    } catch (cause) {
      html.value = ''
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  },
  { immediate: true, flush: 'post' },
)
watch(
  () => [props.active, props.revealed, props.editable, props.selected, props.highlight, props.data],
  decorate,
  { deep: true },
)
function select(event: MouseEvent | KeyboardEvent) {
  if (!props.editable || !root.value) return
  const selection = root.value.ownerDocument.getSelection()
  if (
    selection &&
    !selection.isCollapsed &&
    selection.rangeCount &&
    root.value.contains(selection.anchorNode) &&
    root.value.contains(selection.focusNode)
  ) {
    emit('select', leavesInRange(nodes, selection.getRangeAt(0)))
    return
  }
  const element = (event.target as Element).closest<HTMLElement>('[data-formula-leaf]')
  if (!element || !root.value.contains(element)) return
  const index = Number(element.dataset.formulaLeaf)
  if (event.shiftKey && anchor !== undefined)
    emit(
      'select',
      nodes.flatMap((_, i) =>
        i >= Math.min(index, anchor!) && i <= Math.max(index, anchor!) ? [i] : [],
      ),
    )
  else {
    anchor = index
    emit(
      'select',
      event.ctrlKey || event.metaKey
        ? props.selected?.includes(index)
          ? props.selected.filter((value) => value !== index)
          : [...(props.selected ?? []), index].sort((a, b) => a - b)
        : [index],
    )
  }
}
function activate(event: KeyboardEvent) {
  if (props.editable && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault()
    select(event)
  }
}
function keyboard() {
  const selection = root.value?.ownerDocument.getSelection()
  if (
    props.editable &&
    selection?.rangeCount &&
    !selection.isCollapsed &&
    root.value?.contains(selection.anchorNode) &&
    root.value.contains(selection.focusNode)
  )
    emit('select', leavesInRange(nodes, selection.getRangeAt(0)))
}
onBeforeUnmount(() => {
  generation++
  nodes = []
})
</script>
<template>
  <UiNotice v-if="error" tone="error">{{ error }}</UiNotice>
  <div
    v-else
    ref="root"
    class="vo-formula"
    :class="{ 'vo-formula-editable': editable }"
    :tabindex="editable ? 0 : undefined"
    :aria-label="editable ? '公式选区：拖选字符，或点击、按住 Shift 连选、Ctrl 多选' : '公式遮挡题'"
    @mouseup="select"
    @keydown="activate"
    @keyup="keyboard"
    v-html="html"
  />
</template>
<style>
.vo-formula {
  overflow-x: auto;
  padding: 2rem 1rem;
  min-height: 8rem;
  color: var(--ui-text, #233d31);
  background: var(--ui-bg, #fff);
  border: 1px solid var(--ui-border, #d7e2d2);
  border-radius: 12px;
  font-size: 1.35rem;
}
.vo-formula .katex-display {
  margin: 0;
}
.vo-formula-editable {
  user-select: text;
}
.vo-formula .vo-leaf-editable {
  cursor: crosshair;
}
.vo-formula-editable .katex-html * {
  pointer-events: none;
}
.vo-formula-editable [data-formula-leaf] {
  pointer-events: auto;
  position: relative;
  z-index: 1;
}
.vo-formula-editable [data-formula-leaf]:focus-visible {
  outline: 2px solid var(--ui-primary, #356b52);
  outline-offset: 2px;
}
.vo-formula .vo-leaf-selected,
.vo-formula .vo-leaf-active {
  background: color-mix(in srgb, var(--ui-primary, #356b52) 22%, transparent);
  outline: 1px solid var(--ui-primary, #356b52);
  border-radius: 2px;
}
.vo-formula .vo-leaf-masked {
  color: transparent !important;
  background: var(--ui-primary, #356b52);
  border-radius: 3px;
  user-select: none;
}
</style>
