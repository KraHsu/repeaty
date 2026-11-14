<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { t } from '../i18n'
import { useOptionalInputCommands } from '../input/controller'
import { chordFromEvent, normalizeChord } from '../input/shortcuts'
import { createGestureTracker, gestureLabel, validGesture } from '../input/gestures'
import { SettingField, SettingGroup, UiButton, UiInput, UiNotice, UiSelect } from './ui'
import AppModal from './AppModal.vue'

const input = useOptionalInputCommands()
const filter = ref(''),
  context = ref('all'),
  editing = ref(''),
  chord = ref(''),
  recording = ref(false)
const saving = ref(false),
  error = ref(''),
  feedback = ref('')
const contextLabels: Record<string, string> = {
  global: '全局',
  review: '复习',
  material: '学习材料',
  editor: '编辑器',
}
const commands = computed(
  () =>
    input?.commands.value.filter(
      (command) =>
        (context.value === 'all' || context.value === command.context) &&
        `${t(command.title)} ${command.id}`.toLowerCase().includes(filter.value.toLowerCase()),
    ) ?? [],
)
const selected = computed(() =>
  input?.commands.value.find((command) => command.id === editing.value),
)
const chords = computed(() =>
  chord.value
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean),
)
const conflicts = computed(() => input?.conflicts(editing.value, chords.value) ?? [])
function edit(id: string) {
  editing.value = id
  chord.value = input?.bindings(id).join(', ') ?? ''
  recording.value = false
  error.value = ''
  feedback.value = ''
}
function capture(event: KeyboardEvent) {
  if (!recording.value) return
  event.preventDefault()
  event.stopPropagation()
  const value = chordFromEvent(event)
  if (value) {
    chord.value = value
    recording.value = false
  }
}
async function save(action: () => Promise<unknown>, close = false) {
  if (saving.value) return
  saving.value = true
  error.value = ''
  feedback.value = ''
  try {
    await action()
    feedback.value = t('设置已保存')
    if (close) editing.value = ''
  } catch (issue) {
    error.value = t(issue instanceof Error ? issue : new Error('设置未能保存，请重试。'))
  } finally {
    saving.value = false
  }
}
const gesture = reactive({
  ...input?.state.value.gestures,
  bindings: { ...input?.state.value.gestures.bindings },
})
watch(
  () => input?.state.value.gestures,
  (value) => {
    if (value) Object.assign(gesture, value, { bindings: { ...value.bindings } })
  },
)
const pattern = ref(''),
  command = ref(''),
  drawing = ref(false)
let tracker: ReturnType<typeof createGestureTracker> | undefined, pointer: number | undefined
const points = ref('')
function start(event: PointerEvent) {
  if (event.pointerType !== 'mouse' || ![0, 2].includes(event.button)) return
  event.preventDefault()
  pointer = event.pointerId
  drawing.value = true
  const element = event.currentTarget as HTMLElement,
    box = element.getBoundingClientRect()
  const point = { x: event.clientX - box.left, y: event.clientY - box.top }
  tracker = createGestureTracker(point, gesture.threshold ?? 18)
  points.value = `${point.x},${point.y}`
  pattern.value = ''
  element.setPointerCapture?.(event.pointerId)
}
function move(event: PointerEvent) {
  if (pointer !== event.pointerId || !tracker) return
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const point = { x: event.clientX - box.left, y: event.clientY - box.top }
  pattern.value = tracker.move(point)
  if (points.value.length < 10000) points.value += ` ${point.x},${point.y}`
}
function finish(event?: PointerEvent) {
  if (event && pointer !== event.pointerId) return
  drawing.value = false
  pointer = undefined
  tracker = undefined
}
function saveGesture() {
  if (!input) return Promise.resolve()
  return input.saveGestures({
    ...input.state.value.gestures,
    ...gesture,
    bindings: { ...gesture.bindings },
  })
}
function addGesture() {
  if (!validGesture(pattern.value) || !command.value) return
  gesture.bindings = { ...gesture.bindings, [pattern.value]: command.value }
  void save(saveGesture)
}
function toggleGestures(value: unknown) {
  gesture.enabled = !!value
  void save(saveGesture)
}
function removeGesture(shape: string) {
  delete gesture.bindings[shape]
  void save(saveGesture)
}
</script>

<template>
  <div v-if="input" class="input-settings">
    <SettingGroup
      :title="t('快捷键')"
      :description="t('按命令调整按键；编辑器中的原生输入、撤销与选区操作保持可用。')"
    >
      <template #actions
        ><UiButton
          variant="ghost"
          :disabled="saving"
          @click="save(() => input!.resetShortcuts())"
          >{{ t('重置快捷键') }}</UiButton
        ></template
      >
      <div class="input-settings-filter">
        <UiInput v-model="filter" :placeholder="t('搜索命令')" :aria-label="t('搜索命令')" />
        <UiSelect
          v-model="context"
          :aria-label="t('命令范围')"
          :items="[
            { value: 'all', label: t('全部') },
            ...Object.entries(contextLabels).map(([value, label]) => ({ value, label: t(label) })),
          ]"
        />
      </div>
      <div class="input-command-list">
        <div v-for="entry in commands" :key="entry.id" class="input-command-row">
          <div class="input-command-title">
            <span>{{ t(entry.title) }}</span
            ><small>{{ t(contextLabels[entry.context] ?? entry.context) }}</small>
          </div>
          <UiButton
            variant="secondary"
            class="input-binding"
            :aria-label="`${t('修改快捷键')} · ${t(entry.title)}`"
            @click="edit(entry.id)"
            >{{ input.bindings(entry.id).join(' / ') || t('未绑定') }}</UiButton
          >
          <span
            v-if="input.conflicts(entry.id, input.bindings(entry.id)).length"
            role="status"
            class="input-conflict"
            >{{ t('冲突') }}</span
          >
        </div>
        <p v-if="!commands.length" class="muted">{{ t('没有匹配的命令') }}</p>
      </div>
    </SettingGroup>

    <SettingGroup
      :title="t('鼠标手势')"
      :description="
        t(
          '启用后按住鼠标右键划动，松开执行；单击右键仍打开菜单。输入框、文字编辑与触摸滚动不受影响。',
        )
      "
    >
      <template #actions
        ><UiButton variant="ghost" :disabled="saving" @click="save(() => input!.resetGestures())">{{
          t('重置手势')
        }}</UiButton></template
      >
      <SettingField
        type="switch"
        :label="t('启用鼠标手势')"
        :model-value="gesture.enabled ?? false"
        @update:model-value="toggleGestures"
      />
      <div class="gesture-binding-list">
        <div v-for="(id, shape) in gesture.bindings" :key="shape" class="gesture-binding-row">
          <strong class="gesture-shape">{{ gestureLabel(shape) }}</strong>
          <span>{{
            t(input.commands.value.find((entry) => entry.id === id)?.title ?? '命令暂不可用')
          }}</span>
          <UiButton
            variant="ghost"
            :aria-label="`${t('删除手势')} ${gestureLabel(shape)}`"
            :disabled="saving"
            @click="removeGesture(shape)"
            >{{ t('删除') }}</UiButton
          >
        </div>
      </div>
      <div
        class="gesture-recorder"
        data-gesture-recorder
        tabindex="0"
        :aria-label="t('在此绘制手势')"
        @pointerdown="start"
        @pointermove="move"
        @pointerup="finish"
        @pointercancel="finish"
        @lostpointercapture="finish"
        @contextmenu.prevent
        @keydown.esc="finish()"
      >
        <svg aria-hidden="true">
          <polyline
            :points="points"
            fill="none"
            :stroke="gesture.color"
            :stroke-width="gesture.width"
            :opacity="gesture.opacity"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>{{
          drawing ? gestureLabel(pattern) : pattern ? gestureLabel(pattern) : t('在此绘制手势')
        }}</span>
      </div>
      <div class="gesture-new-binding">
        <SettingField
          :label="t('手势方向')"
          :description="t('也可输入 L、R、U、D 表示左、右、上、下，最多八段。')"
          :model-value="pattern"
          placeholder="LDR"
          @update:model-value="pattern = String($event).toUpperCase()"
        />
        <SettingField
          type="select"
          :label="t('执行命令')"
          :model-value="command"
          :options="
            input.commands.value
              .filter((entry) => entry.context !== 'editor')
              .map((entry) => ({ value: entry.id, label: t(entry.title) }))
          "
          @update:model-value="command = String($event)"
        />
        <UiButton :disabled="saving || !validGesture(pattern) || !command" @click="addGesture">{{
          gesture.bindings[pattern] ? t('更新手势') : t('添加手势')
        }}</UiButton>
      </div>
      <details class="gesture-appearance">
        <summary>{{ t('识别与轨迹') }}</summary>
        <SettingField
          type="range"
          :label="t('方向识别距离')"
          :model-value="gesture.threshold ?? 18"
          :min="8"
          :max="48"
          :step="1"
          unit="px"
          @update:model-value="gesture.threshold = Number($event)"
        />
        <SettingField
          type="range"
          :label="t('轨迹采样距离')"
          :model-value="gesture.pointThreshold ?? 6"
          :min="2"
          :max="24"
          :step="1"
          unit="px"
          @update:model-value="gesture.pointThreshold = Number($event)"
        />
        <SettingField
          type="switch"
          :label="t('显示轨迹')"
          :model-value="gesture.trail ?? true"
          @update:model-value="gesture.trail = !!$event"
        />
        <SettingField
          type="switch"
          :label="t('显示动作提示')"
          :model-value="gesture.hint ?? true"
          @update:model-value="gesture.hint = !!$event"
        />
        <SettingField
          :label="t('轨迹颜色')"
          :model-value="gesture.color ?? '#6fa880'"
          placeholder="#6fa880"
          @update:model-value="gesture.color = String($event)"
        />
        <SettingField
          type="range"
          :label="t('轨迹粗细')"
          :model-value="gesture.width ?? 3"
          :min="1"
          :max="12"
          :step="1"
          unit="px"
          @update:model-value="gesture.width = Number($event)"
        />
        <SettingField
          type="range"
          :label="t('轨迹不透明度')"
          :model-value="gesture.opacity ?? 0.65"
          :min="0.05"
          :max="1"
          :step="0.05"
          @update:model-value="gesture.opacity = Number($event)"
        />
        <UiButton
          :disabled="saving || !/^#[0-9a-f]{6}$/i.test(gesture.color ?? '')"
          @click="save(saveGesture)"
          >{{ t('保存') }}</UiButton
        >
      </details>
    </SettingGroup>
    <UiNotice v-if="error || input.error.value" tone="error" role="alert">{{
      error || t(input.error.value)
    }}</UiNotice>
    <p v-else-if="feedback" role="status" class="muted">{{ feedback }}</p>
    <AppModal
      v-if="editing && selected"
      :title="t(selected.title)"
      :busy="saving"
      @close="editing = ''"
    >
      <div class="shortcut-editor" @keydown.capture="capture">
        <SettingField
          :label="t('快捷键')"
          :model-value="chord"
          :description="
            t('使用 Mod 表示 Windows 的 Ctrl 或 macOS 的 Command。多个快捷键以逗号分隔，最多三个。')
          "
          placeholder="Mod+Shift+K"
          @update:model-value="chord = String($event)"
        />
        <UiButton variant="secondary" @click="recording = !recording">{{
          recording ? t('请按下快捷键') : t('录制快捷键')
        }}</UiButton>
        <p v-if="conflicts.length" role="alert" class="input-conflict">
          {{ t('快捷键冲突') }}：{{ conflicts.map((entry) => t(entry.title)).join('、') }}
        </p>
        <UiNotice v-if="error" tone="error">{{ error }}</UiNotice>
        <div class="shortcut-editor-actions">
          <UiButton
            variant="ghost"
            :disabled="saving"
            @click="save(() => input!.resetShortcuts(editing), true)"
            >{{ t('恢复默认') }}</UiButton
          >
          <UiButton
            variant="ghost"
            :disabled="saving"
            @click="save(() => input!.saveShortcuts(editing, []), true)"
            >{{ t('取消绑定') }}</UiButton
          >
          <UiButton
            :disabled="
              saving ||
              recording ||
              conflicts.length > 0 ||
              chords.length > 3 ||
              chords.some((key) => !normalizeChord(key))
            "
            @click="save(() => input!.saveShortcuts(editing, chords), true)"
            >{{ t('保存') }}</UiButton
          >
        </div>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.input-settings {
  display: grid;
  gap: 24px;
  min-width: 0;
}
.input-settings-filter,
.input-command-row,
.gesture-binding-row,
.shortcut-editor-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.input-settings-filter > :first-child {
  flex: 1;
  min-width: 180px;
}
.input-command-list {
  margin-top: 16px;
}
.input-command-row {
  padding: 12px 0;
  border-bottom: 1px solid var(--ui-border);
}
.input-command-title {
  display: grid;
  gap: 4px;
  flex: 1;
  min-width: 160px;
}
.input-command-title small {
  color: var(--ui-text-muted);
}
.input-binding {
  min-width: 112px;
  font-variant-numeric: tabular-nums;
}
.input-conflict {
  color: var(--ui-error);
}
.gesture-binding-row {
  padding: 8px 0;
  border-bottom: 1px solid var(--ui-border);
}
.gesture-binding-row > span {
  flex: 1;
  min-width: 120px;
}
.gesture-shape {
  min-width: 72px;
  font-size: 1.25rem;
  letter-spacing: 3px;
}
.gesture-recorder {
  position: relative;
  display: grid;
  place-items: center;
  height: 144px;
  margin: 16px 0;
  border: 1px dashed var(--ui-border-accented);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
  user-select: none;
  touch-action: pan-y;
  color: var(--ui-text-muted);
}
.gesture-recorder svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.gesture-recorder span {
  pointer-events: none;
}
.gesture-recorder:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}
.gesture-new-binding,
.shortcut-editor {
  display: grid;
  gap: 16px;
}
.gesture-new-binding > button {
  justify-self: start;
}
.gesture-appearance {
  margin-top: 20px;
}
.gesture-appearance summary {
  padding: 12px 0;
  cursor: pointer;
}
.shortcut-editor-actions {
  justify-content: flex-end;
}
</style>
