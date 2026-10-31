<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useApplication } from '../app/context'
import { studySettings, studySettingsSchema, type StudySettings } from '../core/study-settings'
import { t } from '../i18n'
import { SettingField, SettingGroup, UiButton, UiNotice } from './ui'

const props = defineProps<{ section: 'review' | 'queue' | 'reading'; isCurrent: () => boolean }>()
const { workspace, library } = useApplication()
const scope = workspace.scope.value
const form = reactive({ ...studySettings(library.value) })
const saving = ref(false),
  error = ref(''),
  saved = ref(false)
const keys = computed(() =>
  props.section === 'review'
    ? (['dayStartHour', 'maxIntervalDays', 'enableShortTerm', 'newCardWindowDays'] as const)
    : props.section === 'queue'
      ? ([
          'cardsPerReading',
          'readingsPerCycle',
          'priorityMode',
          'defaultPriority',
          'priorityRatio',
        ] as const)
      : ([
          'readingMode',
          'readingInitialDays',
          'readingGrowthMin',
          'readingGrowthMax',
          'readingMaxDays',
        ] as const),
)
const baseline = ref(JSON.stringify(studySettings(library.value)))
const dirty = computed(() =>
  keys.value.some((key) => form[key] !== (JSON.parse(baseline.value) as StudySettings)[key]),
)
const stale = computed(
  () => dirty.value && baseline.value !== JSON.stringify(studySettings(library.value)),
)
watch(
  () => library.value.studySettings,
  () => {
    if (saving.value || dirty.value) return
    Object.assign(form, studySettings(library.value))
    baseline.value = JSON.stringify(studySettings(library.value))
  },
)
watch(
  form,
  () => {
    saved.value = false
  },
  { flush: 'sync' },
)
const title = computed(() =>
  t(
    props.section === 'review'
      ? '复习与学习日'
      : props.section === 'queue'
        ? '混合队列与优先级'
        : '阅读间隔',
  ),
)
const numericFields = computed(() =>
  props.section === 'review'
    ? [
        {
          key: 'dayStartHour',
          label: '学习日开始时间',
          description: '按本机时区设置。每日额度和今天暂缓会在此时重置；既有历史日期不重写。',
          min: 0,
          max: 23,
          step: 1,
          unit: '时',
        },
        {
          key: 'maxIntervalDays',
          label: '最大复习间隔',
          description: '限制后续评分生成的间隔，已有卡片日期保持不变。',
          min: 1,
          max: 36500,
          step: 1,
          unit: '天',
        },
        {
          key: 'newCardWindowDays',
          label: '新卡安排默认窗口',
          description:
            '在卡片列表选择未学习的新卡后，可预览并确认均衡安排。保存此项不会直接改动卡片。',
          min: 1,
          max: 99,
          step: 1,
          unit: '天',
        },
      ]
    : props.section === 'queue'
      ? [
          {
            key: 'cardsPerReading',
            label: '每轮卡片数',
            description: '混合学习一轮中的卡片目标数量。',
            min: 1,
            max: 10,
            step: 1,
            unit: '张',
          },
          {
            key: 'readingsPerCycle',
            label: '每轮阅读数',
            description: '混合学习一轮中的材料目标数量；某类用尽后继续另一类。',
            min: 1,
            max: 10,
            step: 1,
            unit: '份',
          },
          {
            key: 'defaultPriority',
            label: '默认学习优先级',
            description: '未显式设置且没有继承来源时使用。1 最高，9 最低。',
            min: 1,
            max: 9,
            step: 1,
          },
          {
            key: 'priorityRatio',
            label: '高低优先级权重比',
            description: '加权模式中，优先级 1 相对 9 的抽取权重。绝对优先 0 始终先安排。',
            min: 1,
            max: 100,
            step: 0.1,
          },
        ]
      : [
          {
            key: 'readingInitialDays',
            label: '初始阅读间隔',
            description: '配置间隔模式中的起始值。',
            min: 1,
            max: 36500,
            step: 1,
            unit: '天',
          },
          {
            key: 'readingGrowthMin',
            label: '最小增长倍数',
            description: '不能大于最大增长倍数。',
            min: 1,
            max: 10,
            step: 0.1,
          },
          {
            key: 'readingGrowthMax',
            label: '最大增长倍数',
            description: '按反馈选择增长倍数，乘以上次阅读间隔；“再读一遍”可缩短间隔。',
            min: 1,
            max: 10,
            step: 0.1,
          },
          {
            key: 'readingMaxDays',
            label: '最大阅读间隔',
            description: '不能小于初始阅读间隔。结果四舍五入为整数天，并以此值为上限。',
            min: 1,
            max: 36500,
            step: 1,
            unit: '天',
          },
        ],
)
function numeric(key: string) {
  return form[key as keyof StudySettings] as number
}
function updateNumber(key: string, value: unknown) {
  Object.assign(form, { [key]: Number(value) })
}
function reset() {
  Object.assign(form, studySettings(library.value))
  baseline.value = JSON.stringify(studySettings(library.value))
  error.value = ''
}
async function save() {
  if (saving.value || !dirty.value || !props.isCurrent() || scope !== workspace.scope.value) return
  saving.value = true
  error.value = ''
  try {
    const current = studySettings(library.value)
    const changes = Object.fromEntries(keys.value.map((key) => [key, form[key]]))
    const parsed = studySettingsSchema.safeParse({ ...current, ...changes })
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? t('请检查设置值。'))
    await workspace.saveStudySettings(parsed.data, scope)
    if (!props.isCurrent() || scope !== workspace.scope.value) return
    baseline.value = JSON.stringify(studySettings(library.value))
    Object.assign(form, studySettings(library.value))
    saved.value = true
  } catch (reason) {
    if (props.isCurrent() && scope === workspace.scope.value) error.value = t(reason as Error)
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <SettingGroup
    :title="title"
    :description="t('设置保存在当前学习库中，修改可撤销。新设置用于后续安排。')"
  >
    <form class="study-settings-form app-section-stack" @submit.prevent="save">
      <SettingField
        v-if="section === 'queue'"
        v-model="form.priorityMode"
        type="select"
        :label="t('优先级安排方式')"
        :description="
          t(
            '顺序模式按已设置的优先级安排，未设置时保留原有排序。加权模式让不同优先级轮选。0 始终优先。',
          )
        "
        :options="[
          { value: 'legacy', label: t('按优先级顺序') },
          { value: 'weighted', label: t('按优先级加权') },
        ]"
        :disabled="saving"
      />
      <SettingField
        v-if="section === 'reading'"
        v-model="form.readingMode"
        type="select"
        :label="t('阅读间隔模式')"
        :options="[
          { value: 'legacy', label: t('现有自适应阅读') },
          { value: 'configured', label: t('配置间隔与增长范围') },
        ]"
        :description="t('切换模式不会重写材料当前已安排的日期。')"
        :disabled="saving"
      />
      <SettingField
        v-for="field in numericFields"
        :key="field.key"
        :id="`study-${field.key}`"
        type="number"
        :model-value="numeric(field.key)"
        :label="t(field.label)"
        :description="t(field.description)"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        :unit="'unit' in field && field.unit ? t(field.unit) : undefined"
        :disabled="
          saving ||
          (section === 'reading' && form.readingMode !== 'configured') ||
          (field.key === 'priorityRatio' && form.priorityMode !== 'weighted')
        "
        @update:model-value="updateNumber(field.key, $event)"
      />
      <SettingField
        v-if="section === 'review'"
        v-model="form.enableShortTerm"
        type="switch"
        :label="t('启用短期学习步骤')"
        :description="t('允许 FSRS 安排当天的短间隔复习；关闭后按天安排。仅影响后续评分。')"
        :disabled="saving"
      />
      <UiNotice v-if="stale" tone="warning">{{
        t('学习设置已在别处变化。继续保存将应用本页选项，也可重新载入。')
      }}</UiNotice>
      <UiNotice v-if="error" tone="error">{{ error }}</UiNotice>
      <p v-if="saved" role="status" class="form-note">
        {{ t('学习设置已保存，可使用撤销恢复。') }}
      </p>
      <div class="form-actions">
        <UiButton variant="secondary" :disabled="saving || !dirty" @click="reset">{{
          t('重新载入')
        }}</UiButton>
        <UiButton variant="primary" type="submit" :busy="saving" :disabled="!dirty">{{
          t('保存学习设置')
        }}</UiButton>
      </div>
    </form>
  </SettingGroup>
</template>
<style scoped>
.study-settings-form {
  --app-content-gap: 1rem;
}
</style>
