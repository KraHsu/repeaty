<script setup lang="ts">
import { UiInput, UiButton } from '../../components/ui'
import { t } from '../../i18n'
import AppModal from '../../components/AppModal.vue'
import { useApplication } from '../context'
const { busy, modal, mixedRatio, startMixed, shortcuts } = useApplication()
</script>
<template>
  <AppModal v-if="modal === 'mixed'" :title="t('开始混合学习')" :busy="busy" @close="modal = null">
    <form class="editor-form" @submit.prevent="startMixed">
      <p>{{ t('按现有复习额度安排卡片，在其中穿插今天待阅读的材料。') }}</p>
      <label for="mixed-ratio">{{ t('每轮先复习几张卡片？') }}</label>
      <UiInput
        id="mixed-ratio"
        v-model.number="mixedRatio"
        type="number"
        min="1"
        max="10"
        step="1"
        required
      />
      <p class="form-note">
        {{ t('其中一类处理完后继续另一类。结束或刷新页面后，下次重新开始一轮。') }}
      </p>
      <div class="form-actions">
        <UiButton variant="secondary" type="button" @click="modal = null"> {{ t('取消') }}</UiButton
        ><UiButton variant="primary" type="submit" :disabled="busy">
          {{ t('开始学习') }}
        </UiButton>
      </div>
    </form>
  </AppModal>
  <AppModal v-if="modal === 'shortcuts'" :title="t('快捷键')" @close="modal = null">
    <table class="shortcut-table">
      <tbody>
        <tr v-for="[keys, label] in shortcuts" :key="keys">
          <td>
            <kbd>{{ keys }}</kbd>
          </td>
          <td>{{ t(label) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="form-note">
      {{ t('输入框保留文字撤销；学习库支持撤销当前会话最近 20 次修改。评分在重启后仍可撤销。') }}
    </p>
  </AppModal>
</template>
