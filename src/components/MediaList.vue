<script setup lang="ts">
import { t } from '../i18n'
import { onUnmounted, ref, watch } from 'vue'
import type { Media } from '../core/model'
const props = defineProps<{
  ids: string[]
  media: readonly Media[]
  getMedia: (id: string) => Promise<Blob | undefined>
}>()
const files = ref<{ id: string; name: string; type: string; url: string }[]>([])
const error = ref('')
let generation = 0
function clear() {
  files.value.forEach((file) => URL.revokeObjectURL(file.url))
  files.value = []
}
watch(
  () => props.ids,
  async (ids) => {
    const current = ++generation
    clear()
    error.value = ''
    for (const id of ids) {
      try {
        const meta = props.media.find((item) => item.id === id)
        const blob = await props.getMedia(id)
        if (current !== generation) return
        if (!meta || !blob) throw new Error('missing')
        files.value.push({ id, name: meta.name, type: meta.type, url: URL.createObjectURL(blob) })
      } catch {
        if (current === generation) error.value = '部分媒体无法读取，请从完整备份恢复。'
      }
    }
  },
  { immediate: true },
)
onUnmounted(() => {
  generation++
  clear()
})
</script>
<template>
  <div v-if="ids.length" class="media-list">
    <figure v-for="file in files" :key="file.id">
      <img v-if="file.type.startsWith('image/')" :src="file.url" :alt="file.name" loading="lazy" />
      <audio v-else :src="file.url" controls preload="metadata" :aria-label="file.name" />
      <figcaption>{{ file.name }}</figcaption>
    </figure>
    <p v-if="error" role="alert">{{ t(error) }}</p>
  </div>
</template>
