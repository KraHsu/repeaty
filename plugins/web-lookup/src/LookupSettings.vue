<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { SettingField, UiButton, UiNotice } from '@repeaty/plugin-api'
import { defaults, normalizeTargets, type LookupTarget } from './lookup'
import { text } from './text'
const props = defineProps<{
  targets: LookupTarget[]
  error: string
  save: (value: LookupTarget[]) => Promise<void>
}>()
const draft = ref(props.targets.map((item) => ({ ...item }))),
  issue = ref('')
const busy = ref(false)
const saved = ref(false)
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(props.targets))
watch(
  draft,
  () => {
    saved.value = false
  },
  { deep: true },
)
watch(
  () => props.targets,
  (next) => {
    draft.value = next.map((item) => ({ ...item }))
  },
)
async function save() {
  if (busy.value) return
  let value: LookupTarget[]
  try {
    value = normalizeTargets(draft.value)
  } catch (error) {
    issue.value = text(error instanceof Error ? error.message : '请填写有效且不重复的查询目标。')
    return
  }
  busy.value = true
  try {
    await props.save(value)
    issue.value = ''
    saved.value = true
  } catch {
    issue.value = text('查询目标未保存，请重试。')
  } finally {
    busy.value = false
  }
}
function move(index: number, by: number) {
  const value = draft.value.splice(index, 1)[0]
  if (value) draft.value.splice(index + by, 0, value)
}
function add() {
  draft.value.push({
    id: crypto.randomUUID(),
    label: text('新查询目标'),
    template: 'https://example.com/search?q={text}',
    enabled: false,
  })
}
</script>
<template>
  <div class="lookup-settings">
    <p>{{ text('在网址中用 {text} 表示选中文字。文字会编码后填入链接，在浏览器中打开。') }}</p>
    <div class="lookup-actions">
      <UiButton variant="ghost" :disabled="busy" @click="draft = defaults()">{{
        text('恢复默认')
      }}</UiButton>
    </div>
    <UiNotice v-if="issue || error" tone="error">{{ issue || error }}</UiNotice>
    <fieldset :disabled="busy">
      <ol class="lookup-targets">
        <li
          v-for="(entry, index) in draft"
          :key="entry.id"
          :class="{ 'app-section-divider': index > 0 }"
        >
          <SettingField type="switch" :label="entry.label" v-model="entry.enabled" />
          <SettingField :label="text('名称')" v-model="entry.label" :maxlength="80" />
          <SettingField
            :label="text('查询网址')"
            v-model="entry.template"
            :maxlength="2048"
            :spellcheck="false"
            monospace
          />
          <div class="lookup-actions">
            <UiButton variant="ghost" :disabled="index === 0" @click="move(index, -1)">{{
              text('上移')
            }}</UiButton>
            <UiButton
              variant="ghost"
              :disabled="index === draft.length - 1"
              @click="move(index, 1)"
              >{{ text('下移') }}</UiButton
            >
            <UiButton variant="ghost" @click="draft.splice(index, 1)">{{ text('删除') }}</UiButton>
          </div>
        </li>
      </ol>
      <div class="lookup-actions">
        <UiButton variant="secondary" :disabled="draft.length >= 32" @click="add">{{
          text('添加目标')
        }}</UiButton>
        <UiButton :disabled="busy || !dirty" @click="save">{{ text('保存') }}</UiButton>
      </div>
    </fieldset>
    <UiNotice v-if="saved" tone="success">{{ text('查询目标已保存。') }}</UiNotice>
  </div>
</template>
<style scoped>
.lookup-targets {
  margin: 0;
  padding: 0;
  list-style: none;
}
fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.lookup-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}
</style>
