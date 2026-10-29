<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import type { Source } from '../core/source-data'
import { parseSourceProperties } from '../core/source-properties'
import { sourceMetadataFields, SOURCE_FIELDS_EVENT } from '../source-metadata-settings'
const props = defineProps<{
  source: Source
  scope: string
  readProperties?: (id: string, scope: string) => Promise<string>
}>()
const keys = ref<string[]>([])
const text = ref('')
let sequence = 0
watch(
  () => [props.source.id, props.source.mediaId, props.source.properties, props.scope],
  async () => {
    const current = ++sequence
    text.value = props.source.properties ?? ''
    if (props.source.properties === undefined && props.readProperties) {
      try {
        const value = await props.readProperties(props.source.id, props.scope)
        if (current === sequence) text.value = value
      } catch {
        /* A missing header never prevents reading the material. */
      }
    }
  },
  { immediate: true },
)
function refresh() {
  try {
    keys.value = sourceMetadataFields()
  } catch {
    keys.value = []
  }
}
watch(() => props.scope, refresh, { immediate: true })
window.addEventListener(SOURCE_FIELDS_EVENT, refresh)
onScopeDispose(() => {
  sequence++
  window.removeEventListener(SOURCE_FIELDS_EVENT, refresh)
})
const fields = computed(() => {
  let values: Record<string, unknown>
  try {
    values = parseSourceProperties(text.value)
  } catch {
    return []
  }
  return (keys.value.length ? keys.value : Object.keys(values))
    .filter((key) => Object.hasOwn(values, key))
    .map((key) => {
      const value = values[key]
      const text =
        value === null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)
      return { key, text }
    })
})
</script>
<template>
  <dl v-if="fields.length" class="source-metadata">
    <template v-for="field in fields" :key="field.key"
      ><dt>{{ field.key }}</dt>
      <dd :title="field.text">{{ field.text }}</dd></template
    >
  </dl>
</template>
<style scoped>
.source-metadata {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 0.4rem 0.75rem;
  margin: 0;
  font-size: var(--text-sm);
}
.source-metadata dt {
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.source-metadata dd {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
