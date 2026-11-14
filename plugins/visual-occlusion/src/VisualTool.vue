<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  materials,
  SettingField,
  UiButton,
  UiNotice,
  type MaterialCommandContext,
  type MaterialRecord,
} from '@repeaty/plugin-api'
import RegionEditor from './RegionEditor.vue'
import { formulas, RENDERER, type Formula } from './formula'
import { inspectImage } from './image'
import { parseData, type VisualData } from './model'
import { current, frozenMaterial, prepareNote, saveVisual } from './workflow'
const props = defineProps<{
  context: MaterialCommandContext
  onClose: () => void
  kind: 'image' | 'formula'
}>()
const data = ref<VisualData>(),
  blob = ref<Blob>(),
  material = ref<MaterialRecord>(),
  text = ref(''),
  found = ref<Formula[]>([]),
  formulaIndex = ref('0'),
  deck = ref(''),
  prompt = ref(''),
  error = ref(''),
  busy = ref(false),
  loading = ref(true)
const decks = ref<{ value: string; label: string }[]>([])
const selectedFormula = computed(() => found.value[Number(formulaIndex.value)])
const choices = computed(() =>
  found.value.map((formula, index) => ({
    value: String(index),
    label: `${index + 1}. ${formula.latex.slice(0, 70)}`,
  })),
)
const valid = computed(
  () => data.value && parseData(data.value) && deck.value && prompt.value.trim(),
)
let alive = true,
  operationId = crypto.randomUUID(),
  submitted = ''
function selectFormula(value: string) {
  formulaIndex.value = value
  const formula = selectedFormula.value
  if (formula)
    data.value = {
      kind: 'formula',
      latex: formula.latex,
      renderer: RENDERER,
      tokens: [],
      mode: 'one',
      regions: [],
    }
}
onMounted(async () => {
  try {
    decks.value = current(props.context).decks.map((deck) => ({ value: deck.id, label: deck.name }))
    deck.value = decks.value[0]?.value ?? ''
    const result = await frozenMaterial(props.context)
    if (!alive) return
    material.value = result.material
    text.value = result.text
    if (props.kind === 'image') {
      const original = await materials.original(result.material.id, result.material.versionId)
      current(props.context)
      if (!original || !result.material.document) throw new Error('图片原件不可用。')
      const info = await inspectImage(original, props.context.signal)
      if (!alive) return
      blob.value = original
      const locator = props.context.selection?.locator
      data.value = {
        kind: 'image',
        mediaId: result.material.document.originalMediaId,
        width: info.width,
        height: info.height,
        rotation: 0,
        mode: 'one',
        regions:
          locator?.kind === 'image'
            ? [
                {
                  id: crypto.randomUUID(),
                  label: '区域 1',
                  x: locator.x,
                  y: locator.y,
                  width: locator.width,
                  height: locator.height,
                },
              ]
            : [],
      }
      prompt.value = `指出图片中被遮挡的内容：${result.material.title}`
    } else {
      found.value = formulas(result.text)
      if (!found.value.length)
        throw new Error(
          '这份材料没有可选择的公式。支持 $…$、$$…$$、\\(…\\)、\\[…\\]，代码块中的内容不参与。',
        )
      const locator = props.context.selection?.locator
      selectFormula(
        String(
          Math.max(
            0,
            found.value.findIndex((formula) =>
              locator?.kind === 'formula'
                ? formula.start === locator.start
                : props.context.selection?.projection
                  ? formula.start <= props.context.selection.projection.start &&
                    formula.end >= props.context.selection.projection.end
                  : false,
            ),
          ),
        ),
      )
      prompt.value = '补全公式中被遮挡的部分'
    }
  } catch (cause) {
    if (alive && !props.context.signal.aborted)
      error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (alive) loading.value = false
  }
})
async function save() {
  if (!data.value || !material.value || !valid.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const prepared = prepareNote(
      {
        deckId: deck.value,
        front: prompt.value.trim(),
        back:
          data.value.kind === 'formula'
            ? `$$\n${data.value.latex}\n$$`
            : `原始图片：${material.value.title}`,
        tags: [],
      },
      data.value,
      { sourceId: material.value.id, versionId: material.value.versionId },
      text.value,
      props.kind === 'formula' ? selectedFormula.value : undefined,
    )
    const fingerprint = JSON.stringify(prepared)
    if (submitted !== fingerprint) {
      operationId = crypto.randomUUID()
      submitted = fingerprint
    }
    await saveVisual(props.context, prepared, operationId)
    if (alive) props.onClose()
  } catch (cause) {
    if (alive && !props.context.signal.aborted)
      error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (alive) busy.value = false
  }
}
onBeforeUnmount(() => {
  alive = false
})
</script>
<template>
  <div class="vo-tool app-section-stack">
    <p class="vo-tool-intro">
      {{
        kind === 'image'
          ? '在图片上标出需要记忆的区域，每个区域生成一张卡片。'
          : '直接选择渲染后公式中的元素，按区域独立复习。'
      }}
    </p>
    <UiNotice v-if="error" tone="error">{{ error }}</UiNotice>
    <p v-if="loading">正在读取材料…</p>
    <template v-if="data">
      <SettingField
        v-if="kind === 'formula'"
        type="select"
        label="材料中的公式"
        :model-value="formulaIndex"
        :options="choices"
        layout="stack"
        :disabled="busy"
        @update:model-value="selectFormula(String($event))"
      />
      <RegionEditor v-model="data" :blob="blob" />
      <div class="vo-destination app-section-divider">
        <SettingField
          type="select"
          label="保存到卡组"
          :model-value="deck"
          :options="decks"
          layout="stack"
          :disabled="busy"
          @update:model-value="deck = String($event)"
        />
        <SettingField
          label="题目提示"
          :model-value="prompt"
          :maxlength="500"
          layout="stack"
          :disabled="busy"
          @update:model-value="prompt = String($event)"
        />
      </div>
      <UiNotice v-if="!decks.length" tone="warning">请先创建卡组，再打开此工具。</UiNotice>
      <footer class="vo-tool-footer">
        <UiButton variant="secondary" :disabled="busy" @click="onClose">取消</UiButton>
        <UiButton variant="primary" :disabled="!valid || busy" :busy="busy" @click="save"
          >创建 {{ data.regions.length }} 张卡片</UiButton
        >
      </footer>
    </template>
  </div>
</template>
<style scoped>
.vo-tool {
  --app-content-gap: 1.25rem;
}
.vo-tool-intro {
  color: var(--ui-text-muted, #6d7d70);
  font-size: 0.875rem;
  margin: 0;
}
.vo-destination {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 1rem;
}
.vo-tool-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
@media (max-width: 560px) {
  .vo-destination {
    grid-template-columns: 1fr;
  }
}
</style>
