<script setup lang="ts">
import { t } from '../i18n'

import { onMounted, ref } from 'vue'
import { X } from '@lucide/vue'

defineProps<{ title: string; busy?: boolean; error?: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog
    ref="dialog"
    class="modal"
    :class="{ 'modal-wide': wide }"
    aria-labelledby="modal-title"
    @cancel.prevent="!busy && emit('close')"
    @click="$event.target === dialog && !busy && emit('close')"
  >
    <div class="modal-content">
      <header class="modal-header">
        <h2 id="modal-title">{{ title }}</h2>
        <button
          class="icon-button"
          :aria-label="t('关闭弹窗')"
          :disabled="busy"
          @click="emit('close')"
        >
          <X :size="20" />
        </button>
      </header>
      <p v-if="error" class="import-warning" role="alert">{{ error }}</p>
      <slot />
    </div>
  </dialog>
</template>
