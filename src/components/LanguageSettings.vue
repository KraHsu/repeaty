<script setup lang="ts">
import { ref } from 'vue'
import { t, locale, currentLanguagePack } from '../i18n'
import {
  languagePacks,
  parseLanguagePack,
  saveLanguagePack,
  removeLanguagePack,
  type LanguagePack,
} from '../i18n/language-packs'
import { SettingGroup, UiButton, UiNotice } from './ui'
const props = defineProps<{ isCurrent: () => boolean }>()
const file = ref<HTMLInputElement>(),
  pending = ref<LanguagePack>(),
  issue = ref(''),
  busy = ref(false)
async function select(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0]
  pending.value = undefined
  issue.value = ''
  if (!selected) return
  try {
    if (selected.size > 2_000_000) throw new Error('语言包过大。')
    const pack = parseLanguagePack(await selected.text())
    if (props.isCurrent()) pending.value = pack
  } catch (error) {
    if (props.isCurrent()) issue.value = t(error as Error)
  }
  ;(event.target as HTMLInputElement).value = ''
}
async function apply(remove = false) {
  if (!props.isCurrent() || busy.value) return
  busy.value = true
  try {
    if (remove) await removeLanguagePack(locale.value)
    else if (pending.value) await saveLanguagePack(pending.value)
    if (props.isCurrent()) {
      pending.value = undefined
      issue.value = ''
    }
  } catch {
    if (props.isCurrent()) issue.value = t('语言包未保存，请重试。')
  } finally {
    busy.value = false
  }
}
function exportPack() {
  const value = currentLanguagePack()
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `repeaty-language-${locale.value}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>
<template>
  <SettingGroup
    :title="t('语言与翻译')"
    :description="
      t('未翻译的条目使用英文。可导出语言包补充译文，再导入到当前学习库；不会翻译或修改学习内容。')
    "
  >
    <UiNotice v-if="issue" tone="error">{{ issue }}</UiNotice>
    <input ref="file" type="file" accept="application/json,.json" hidden @change="select" />
    <div class="language-actions">
      <UiButton variant="secondary" :disabled="busy || !isCurrent()" @click="file?.click()">{{
        t('导入语言包')
      }}</UiButton>
      <UiButton variant="secondary" :disabled="busy" @click="exportPack">{{
        t('导出语言包')
      }}</UiButton>
      <UiButton variant="ghost" :disabled="busy || !languagePacks[locale]" @click="apply(true)">{{
        t('移除自定义翻译')
      }}</UiButton>
    </div>
    <div v-if="pending" class="language-preview app-section-divider">
      <p>
        {{
          t('即将导入 {language} 的 {count} 条译文。', {
            language: pending.locale,
            count: Object.keys(pending.messages).length,
          })
        }}
      </p>
      <dl>
        <template v-for="[key, value] in Object.entries(pending.messages).slice(0, 5)" :key="key"
          ><dt>{{ key }}</dt>
          <dd>{{ value }}</dd></template
        >
      </dl>
      <UiButton :disabled="busy || !isCurrent()" @click="apply()">{{ t('应用译文') }}</UiButton>
    </div>
  </SettingGroup>
</template>
<style scoped>
.language-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
dt {
  color: var(--ui-text-muted);
}
dd {
  margin: 0.25rem 0 1rem;
  overflow-wrap: anywhere;
}
</style>
