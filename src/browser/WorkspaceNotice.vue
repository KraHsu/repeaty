<script setup lang="ts">
import { UiButton } from '../components/ui'
import { useEventListener } from '@vueuse/core'
import { FolderOpen } from '@lucide/vue'
import { t } from '../i18n'
import { storeToRefs } from 'pinia'
import { useBrowserWorkspaceStore } from '../stores/browser-workspace'
const browserState = useBrowserWorkspaceStore()
const { active: browserWorkspace } = storeToRefs(browserState)

const props = defineProps<{ scope: string }>()
defineEmits<{ open: [] }>()
function beforeUnload(event: BeforeUnloadEvent) {
  if (browserWorkspace.value?.scope === props.scope && browserWorkspace.value.changed) {
    event.preventDefault()
    event.returnValue = ''
  }
}
useEventListener(window, 'beforeunload', beforeUnload)
</script>

<template>
  <aside
    v-if="browserWorkspace && browserWorkspace.scope === scope"
    class="workspace-trial-notice"
    :aria-label="t('工作目录试用')"
  >
    <FolderOpen :size="20" aria-hidden="true" />
    <p>
      <strong>{{ t('正在试用「{name}」', { name: browserWorkspace.name }) }}</strong>
      {{ t('修改和评分只保留在本页，原目录不变。') }}
    </p>
    <UiButton variant="ghost" type="submit" @click="$emit('open')">{{ t('工作目录') }}</UiButton>
  </aside>
</template>

<style scoped>
.workspace-trial-notice {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1.25rem;
  margin: 1rem 2.5rem 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #f3f6ef;
  font-size: var(--font-size-meta);
}
.workspace-trial-notice > svg {
  flex-shrink: 0;
}
.workspace-trial-notice p {
  flex: 1;
  margin: 0;
  line-height: var(--line-height-ui);
}
.workspace-trial-notice strong {
  display: block;
  overflow-wrap: anywhere;
}
@media (max-width: 760px) {
  .workspace-trial-notice {
    margin: 1rem 1rem 0;
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: start;
  }
  .workspace-trial-notice p {
    min-width: 0;
  }
  .workspace-trial-notice button {
    grid-column: 2;
    justify-self: start;
    padding: 0;
  }
}
</style>
