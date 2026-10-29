<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { MaterialSearchHit } from '@repeaty/plugin-api'
import { usePluginManager } from '../plugins/manager'
import { t } from '../i18n'
import { UiButton, UiInput, UiSelect, UiCollapsible } from './ui'

const props = defineProps<{ scope: string; busy?: boolean }>()
const emit = defineEmits<{ open: [hit: MaterialSearchHit] }>()
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
const choice = ref(''),
  query = ref(''),
  loading = ref(false),
  error = ref(''),
  searched = ref(false)
const hits = shallowRef<readonly MaterialSearchHit[]>([])
const cursor = ref<string>()
let controller: AbortController | undefined,
  sequence = 0
function clear() {
  sequence++
  controller?.abort()
  hits.value = []
  cursor.value = undefined
  error.value = ''
  loading.value = false
  searched.value = false
}
watch([choice, query, () => props.scope], clear)
watch(
  providers,
  (entries) => {
    clear()
    if (!entries.some((entry) => entry.key === choice.value)) choice.value = entries[0]?.key ?? ''
  },
  { immediate: true },
)
onUnmounted(clear)
async function search(more = false) {
  const entry = providers.value.find((item) => item.key === choice.value)
  if (!entry || !query.value.trim() || loading.value) return
  if (!more) clear()
  const current = ++sequence
  controller = new AbortController()
  loading.value = true
  error.value = ''
  try {
    const result = await plugins.searchMaterialProvider(
      entry.pluginId,
      entry.provider.id,
      { text: query.value.trim(), limit: 20, cursor: more ? cursor.value : undefined },
      { signal: controller.signal },
    )
    if (sequence !== current) return
    hits.value = more ? [...hits.value, ...result.hits] : result.hits
    cursor.value = result.nextCursor
    searched.value = true
  } catch (issue) {
    if (sequence === current && !(issue instanceof DOMException && issue.name === 'AbortError'))
      error.value = t(issue as Error)
  } finally {
    if (sequence === current) loading.value = false
  }
}
</script>

<template>
  <UiCollapsible v-if="providers.length" class="material-search">
    <template #default="{ open }"
      ><UiButton variant="ghost" :aria-expanded="open">{{ t('插件材料搜索') }}</UiButton></template
    >
    <template #content>
      <form class="material-search-form" @submit.prevent="search()">
        <UiSelect v-model="choice" :aria-label="t('材料搜索提供方')">
          <option v-for="entry in providers" :key="entry.key" :value="entry.key">
            {{ entry.provider.title }}
          </option>
        </UiSelect>
        <UiInput
          v-model="query"
          :placeholder="t('搜索材料内容…')"
          :aria-label="t('插件材料搜索词')"
        />
        <UiButton type="submit" :disabled="loading || !query.trim()">{{ t('搜索') }}</UiButton>
        <UiButton v-if="loading" variant="ghost" @click="clear">{{ t('取消') }}</UiButton>
      </form>
      <p v-if="error" role="alert" class="form-note">{{ error }}</p>
      <p v-if="searched && !hits.length" role="status" class="form-note">
        {{ t('没有找到材料。') }}
      </p>
      <ul v-if="hits.length" class="material-search-results" :aria-label="t('材料搜索结果')">
        <li v-for="(hit, index) in hits" :key="`${hit.sourceId}:${index}`">
          <UiButton variant="ghost" :disabled="busy" @click="emit('open', hit)">{{
            hit.title
          }}</UiButton>
          <p class="form-note">{{ hit.snippet }}</p>
        </li>
      </ul>
      <UiButton v-if="cursor" variant="ghost" :disabled="loading" @click="search(true)">{{
        t('加载更多')
      }}</UiButton>
    </template>
  </UiCollapsible>
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
.material-search-results {
  padding: 0;
  list-style: none;
}
.material-search-results li {
  padding-block: 0.5rem;
}
</style>
