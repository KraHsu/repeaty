<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { MaterialSearchHit } from '@repeaty/plugin-api'
import { usePluginManager } from '../plugins/manager'
import { t } from '../i18n'
import { UiButton, UiInput, UiSelect, UiCheckbox } from './ui'
import type { MaterialKnowledge } from '../composables/material-knowledge'
import { readSynonyms } from '../material-search-settings'

const props = defineProps<{ scope: string; busy?: boolean; knowledge?: MaterialKnowledge }>()
const emit = defineEmits<{ open: [hit: MaterialSearchHit]; settings: [] }>()
const plugins = usePluginManager()
const providers = computed(() =>
  plugins.pluginRuntime.installations.flatMap((installation) =>
    (installation.searchProviders ?? []).map((provider) => ({
      key: `${installation.plugin.id}:${provider.id}`,
      pluginId: installation.plugin.id,
      provider,
    })),
  ),
)
const choice = ref('library'),
  query = ref(''),
  loading = ref(false),
  error = ref(''),
  searched = ref(false)
const hits = shallowRef<readonly MaterialSearchHit[]>([])
const cursor = ref<string>()
const expand = ref(true),
  progress = ref('')
let controller: AbortController | undefined,
  sequence = 0
let resultSignature: string | undefined
function clear() {
  sequence++
  controller?.abort()
  hits.value = []
  cursor.value = undefined
  error.value = ''
  loading.value = false
  searched.value = false
  progress.value = ''
  resultSignature = undefined
}
watch([choice, query, expand, () => props.scope, () => props.knowledge], clear)
watch(
  providers,
  (entries) => {
    clear()
    if (
      (choice.value === 'library' && !props.knowledge) ||
      (choice.value !== 'library' && !entries.some((entry) => entry.key === choice.value))
    )
      choice.value = props.knowledge ? 'library' : (entries[0]?.key ?? '')
  },
  { immediate: true },
)
onUnmounted(clear)
async function search(more = false) {
  const entry = providers.value.find((item) => item.key === choice.value)
  if (
    (!entry && !(choice.value === 'library' && props.knowledge)) ||
    !query.value.trim() ||
    loading.value
  )
    return
  if (more && choice.value === 'library' && resultSignature !== props.knowledge?.signature?.()) {
    clear()
    error.value = t('材料已变化，请重新搜索。')
    return
  }
  if (!more) clear()
  const signature = props.knowledge?.signature?.()
  const current = ++sequence
  controller = new AbortController()
  loading.value = true
  error.value = ''
  try {
    const result =
      choice.value === 'library' && props.knowledge
        ? await props.knowledge.search(
            query.value.trim(),
            expand.value ? readSynonyms().groups : [],
            expand.value,
            more ? Number(cursor.value) || 0 : 0,
            {
              signal: controller.signal,
              progress: (done, total) => {
                if (sequence === current && total)
                  progress.value = t('正在准备检索：{done} / {total}', { done, total })
              },
            },
          )
        : await plugins.searchMaterialProvider(
            entry!.pluginId,
            entry!.provider.id,
            { text: query.value.trim(), limit: 20, cursor: more ? cursor.value : undefined },
            { signal: controller.signal },
          )
    if (sequence !== current) return
    hits.value = more ? [...hits.value, ...result.hits] : result.hits
    cursor.value = result.nextCursor
    resultSignature = signature
    searched.value = true
  } catch (issue) {
    if (sequence === current && !(issue instanceof DOMException && issue.name === 'AbortError'))
      error.value = t(issue as Error)
  } finally {
    if (sequence === current) {
      loading.value = false
      progress.value = ''
    }
  }
}
function rebuild() {
  clear()
  props.knowledge?.rebuild()
  if (query.value.trim()) void search()
}
</script>

<template>
  <section
    v-if="knowledge || providers.length"
    class="material-search"
    :aria-label="t('材料全文搜索')"
  >
    <form class="material-search-form" @submit.prevent="search()">
      <UiSelect
        v-if="providers.length"
        v-model="choice"
        :aria-label="t('材料搜索提供方')"
        :items="[
          ...(knowledge ? [{ value: 'library', label: t('当前学习库') }] : []),
          ...providers.map((entry) => ({ value: entry.key, label: entry.provider.title })),
        ]"
      />
      <UiInput
        v-model="query"
        icon="i-lucide-search"
        :placeholder="t('搜索材料内容…')"
        :aria-label="t('材料全文搜索')"
      />
      <UiButton type="submit" :disabled="loading || !query.trim()">{{ t('搜索') }}</UiButton>
      <UiButton v-if="loading" variant="ghost" @click="clear">{{ t('取消') }}</UiButton>
    </form>
    <div v-if="knowledge && choice === 'library'" class="material-search-options">
      <UiCheckbox v-model="expand" :label="t('扩展同义词')" />
      <UiButton variant="ghost" @click="emit('settings')">{{ t('同义词设置') }}</UiButton>
      <UiButton variant="ghost" :disabled="loading" @click="rebuild">{{
        t('重建检索索引')
      }}</UiButton>
    </div>
    <p v-if="progress" role="status" class="form-note">{{ progress }}</p>
    <p v-if="error" role="alert" class="form-note">{{ error }}</p>
    <p v-if="searched && !hits.length" role="status" class="form-note">
      {{ t('没有找到材料。') }}
    </p>
    <ul v-if="hits.length" class="material-search-results" :aria-label="t('材料搜索结果')">
      <li v-for="(hit, index) in hits" :key="`${hit.sourceId}:${index}`">
        <UiButton
          class="material-search-result"
          variant="ghost"
          :disabled="busy"
          @click="emit('open', hit)"
        >
          <span>{{ hit.title }}</span
          ><span class="form-note">{{ hit.snippet }}</span>
        </UiButton>
      </li>
    </ul>
    <UiButton v-if="cursor" variant="ghost" :disabled="loading" @click="search(true)">{{
      t('加载更多')
    }}</UiButton>
  </section>
</template>

<style scoped>
.material-search {
  margin-block: 1rem;
}
.material-search-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.material-search-form :deep(.ui-input),
.material-search-form > :first-child {
  min-width: 0;
}
.material-search-form :deep([data-slot='root']:has(input)) {
  flex: 1;
  min-width: min(18rem, 100%);
}
.material-search-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.material-search-results {
  padding: 0;
  list-style: none;
}
.material-search-results li {
  border-bottom: 1px solid var(--ui-border);
}
.material-search-result {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  width: 100%;
  padding-block: 0.75rem;
  white-space: normal;
}
.material-search-result .form-note {
  margin: 0;
  font-weight: 400;
  overflow-wrap: anywhere;
}
</style>
