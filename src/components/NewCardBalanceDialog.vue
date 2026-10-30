<script setup lang="ts">
import { computed, ref, shallowRef, watch, onBeforeUnmount } from 'vue'
import type { NewCardBalanceOptions, NewCardBalancePlan } from '../core/new-card-balance'
import { t } from '../i18n'
import AppModal from './AppModal.vue'
import { SettingField, UiButton, UiNotice } from './ui'
const props = defineProps<{
  ids: string[]
  scope: string
  windowDays: number
  preview: (options: NewCardBalanceOptions) => NewCardBalancePlan | Promise<NewCardBalancePlan>
  apply: (plan: NewCardBalancePlan, expectedScope: string) => Promise<unknown>
}>()
const emit = defineEmits<{ close: []; applied: [] }>()
let alive = true
onBeforeUnmount(() => {
  alive = false
})
watch(
  () => props.scope,
  () => {
    plan.value = undefined
    emit('close')
  },
)
const windowDays = ref(props.windowDays),
  start = ref('1')
const plan = shallowRef<NewCardBalancePlan>(),
  error = ref(''),
  busy = ref(false)
const valid = computed(
  () => Number.isInteger(windowDays.value) && windowDays.value >= 1 && windowDays.value <= 99,
)
watch([windowDays, start], () => {
  plan.value = undefined
  error.value = ''
})
async function preview() {
  if (busy.value || !valid.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await props.preview({
      ids: props.ids,
      windowDays: windowDays.value,
      startOffsetDays: Number(start.value),
    })
    if (alive) plan.value = result
  } catch (reason) {
    error.value = t(reason as Error)
    plan.value = undefined
  } finally {
    busy.value = false
  }
}
async function apply() {
  if (busy.value || !plan.value || plan.value.unallocated.length) return
  busy.value = true
  error.value = ''
  try {
    await props.apply(plan.value, props.scope)
    if (alive) emit('applied')
  } catch (reason) {
    error.value = t(reason as Error)
    plan.value = undefined
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <AppModal :title="t('均衡安排新卡')" :busy="busy" :error="error" @close="emit('close')">
    <p class="form-note">
      {{
        t(
          '仅调整所选未学习新卡的首次学习日期，保留其他调度与历史。先查看安排，再确认应用；完成后可撤销。',
        )
      }}
    </p>
    <form class="balance-form" @submit.prevent="preview">
      <SettingField
        type="number"
        v-model="windowDays"
        :label="t('安排窗口')"
        :min="1"
        :max="99"
        :step="1"
        :unit="t('天')"
        :disabled="busy"
      />
      <SettingField
        type="select"
        v-model="start"
        :label="t('开始日期')"
        :disabled="busy"
        :options="[
          { value: '1', label: t('明天') },
          { value: '0', label: t('今天') },
        ]"
      />
      <UiButton type="submit" variant="secondary" :busy="busy" :disabled="!valid">{{
        t('预览安排')
      }}</UiButton>
    </form>
    <template v-if="plan">
      <UiNotice v-if="plan.unallocated.length" tone="warning">{{
        t('窗口内的新卡额度不足。请扩大窗口、提高卡组新卡上限或减少选择后重新预览。')
      }}</UiNotice>
      <p class="form-note">{{ t('按现有计划负载分配，并遵守各卡组的每日新卡上限。') }}</p>
      <div class="balance-table-wrap">
        <table class="balance-table">
          <thead>
            <tr>
              <th>{{ t('学习日') }}</th>
              <th>{{ t('已有计划') }}</th>
              <th>{{ t('新增') }}</th>
              <th>{{ t('合计') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="day in plan.days" :key="day.day">
              <th scope="row">{{ day.day }}</th>
              <td>{{ day.existing }}</td>
              <td>{{ day.added }}</td>
              <td>{{ day.existing + day.added }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="form-note">{{ t('将安排 {p0} 张新卡。', { p0: plan.assignments.length }) }}</p>
      <div class="form-actions">
        <UiButton
          variant="primary"
          :busy="busy"
          :disabled="!!plan.unallocated.length || !plan.assignments.length"
          @click="apply"
          >{{ t('确认应用安排') }}</UiButton
        >
      </div>
    </template>
  </AppModal>
</template>
<style scoped>
.balance-form {
  display: grid;
  gap: 1rem;
  margin: 1rem 0;
}
.balance-form > button {
  justify-self: start;
}
.balance-table-wrap {
  max-height: 20rem;
  overflow: auto;
}
.balance-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-meta);
  font-variant-numeric: tabular-nums;
}
.balance-table th,
.balance-table td {
  text-align: right;
  padding: 0.65rem;
  border-bottom: 1px solid var(--line);
}
.balance-table th:first-child {
  text-align: left;
  font-weight: var(--font-weight-regular);
}
.balance-table thead {
  background: var(--app-table-heading);
}
</style>
