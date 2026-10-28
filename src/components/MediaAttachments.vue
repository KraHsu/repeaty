<script setup lang="ts">
import { vUiButton } from './ui'
import { ref } from 'vue'
import { Paperclip, X } from '@lucide/vue'
import { t } from '../i18n'
import type { Media } from '../core/model'
import MediaList from './MediaList.vue'

defineProps<{
  label: string
  ids: string[]
  media: readonly Media[]
  getMedia: (id: string) => Promise<Blob | undefined>
}>()
const emit = defineEmits<{ attach: [files: File[]]; remove: [id: string] }>()
const input = ref<HTMLInputElement>()
function attach(event: Event) {
  const element = event.target as HTMLInputElement
  emit('attach', [...(element.files ?? [])])
  element.value = ''
}
</script>

<template>
  <div class="media-attachments">
    <input
      ref="input"
      class="sr-only"
      type="file"
      tabindex="-1"
      multiple
      :aria-label="label"
      accept="image/png,image/jpeg,image/webp,image/gif,audio/*"
      @change="attach"
    />
    <button
      v-ui-button="'secondary'"
      type="button"
      class="button attachment-button"
      :title="label"
      @click="input?.click()"
    >
      <Paperclip :size="17" aria-hidden="true" />{{ t('添加图片 / 音频') }}
    </button>
    <MediaList :ids="ids" :media="media" :get-media="getMedia" />
    <div v-if="ids.length" class="attachment-actions">
      <button
        v-ui-button="'danger'"
        v-for="id in ids"
        :key="id"
        type="button"
        class="attachment-remove"
        @click="emit('remove', id)"
      >
        <X :size="15" aria-hidden="true" />
        {{ t('移除 {p0}', { p0: media.find((item) => item.id === id)?.name ?? id }) }}
      </button>
    </div>
  </div>
</template>
