<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import UTextarea from '@nuxt/ui/components/Textarea.vue'
import USelect from './UiSelect.vue'
import USwitch from '@nuxt/ui/components/Switch.vue'
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'
import URadioGroup from '@nuxt/ui/components/RadioGroup.vue'
import UCheckboxGroup from '@nuxt/ui/components/CheckboxGroup.vue'
import USlider from '@nuxt/ui/components/Slider.vue'
import type { SettingFieldProps, SettingValue } from './types'

const props = withDefaults(defineProps<SettingFieldProps>(), {
  type: 'text',
  options: () => [],
  rows: 4,
  layout: 'row',
})
const emit = defineEmits<{ 'update:modelValue': [value: SettingValue] }>()
const generatedId = `setting-${useId()}`
const controlId = computed(() => props.id || generatedId)
const grouped = computed(() => props.type === 'radio' || props.type === 'multiselect')
const binary = computed(() => props.type === 'switch' || props.type === 'checkbox')
const editableText = computed(() => ['text', 'password', 'textarea', 'number'].includes(props.type))
const inactive = computed(() => props.disabled || (props.readonly && !editableText.value))
const updateOn = computed(
  () => props.commit ?? (props.type === 'number' || props.type === 'range' ? 'change' : 'input'),
)
const draft = ref<SettingValue>(props.modelValue)
let composing = false
watch(
  () => props.modelValue,
  (value) => {
    draft.value = value
  },
  { flush: 'sync' },
)
const inputUi = computed(() => ({ base: props.monospace ? 'font-mono' : undefined }))

function rollback(element: HTMLInputElement | HTMLTextAreaElement) {
  draft.value = props.modelValue
  element.value = String(props.modelValue)
}
function numericValue(element: HTMLInputElement) {
  if (!element.value.trim()) return undefined
  const value = Number(element.value)
  if (!Number.isFinite(value) || !element.validity.valid) return undefined
  if (props.min !== undefined && value < props.min) return undefined
  if (props.max !== undefined && value > props.max) return undefined
  const step = props.step ?? 1
  if (step !== 'any' && step > 0) {
    const ticks = (value - (props.min ?? 0)) / step
    if (Math.abs(ticks - Math.round(ticks)) > 1e-8) return undefined
  }
  return value
}
function edit(event: Event, phase: 'input' | 'change') {
  if (composing || (event as InputEvent).isComposing) return
  const element = event.target as HTMLInputElement | HTMLTextAreaElement
  if (props.disabled || props.readonly) {
    rollback(element)
    return
  }
  const value = props.type === 'number' ? numericValue(element as HTMLInputElement) : element.value
  draft.value = props.type === 'number' && value !== undefined ? value : element.value
  if (phase !== updateOn.value) return
  if (value === undefined) {
    if (phase === 'change') rollback(element)
    return
  }
  emit('update:modelValue', value)
}
function finishComposition(event: CompositionEvent) {
  if (!composing) return
  composing = false
  edit(event, 'input')
}
function changeChoice(value: SettingValue) {
  if (!props.disabled && !props.readonly) emit('update:modelValue', value)
}
function previewRange(value: number | number[] | undefined) {
  if (inactive.value) return
  const next = Array.isArray(value) ? value[0] : value
  if (next === undefined || !Number.isFinite(next)) return
  draft.value = next
  if (updateOn.value === 'input') changeChoice(next)
}
async function commitRange() {
  if (updateOn.value !== 'change') return
  // Reka commits before its model update reaches this wrapper on keyboard input.
  await nextTick()
  changeChoice(Number(draft.value))
}
function resetNumber(event: FocusEvent) {
  if (props.type === 'number') rollback(event.target as HTMLInputElement)
}
</script>

<template>
  <UFormField
    :name="controlId"
    :label="label"
    :description="description"
    :error="error || undefined"
    :orientation="layout === 'stack' || type === 'textarea' || grouped ? 'vertical' : 'horizontal'"
    class="ui-setting-field"
    :class="{ 'ui-setting-field--mono': monospace, 'ui-setting-field--binary': binary }"
    :ui="{ root: 'min-w-0 w-full', wrapper: 'min-w-0', container: 'min-w-0' }"
  >
    <template v-if="error" #error="{ error: message }"
      ><span role="alert">{{ message }}</span></template
    >
    <USwitch
      v-if="type === 'switch'"
      :id="controlId"
      :model-value="Boolean(modelValue)"
      :disabled="inactive"
      @update:model-value="changeChoice($event)"
    />
    <UCheckbox
      v-else-if="type === 'checkbox'"
      :id="controlId"
      :model-value="Boolean(modelValue)"
      :disabled="inactive"
      @update:model-value="changeChoice($event === true)"
    />
    <USelect
      v-else-if="type === 'select'"
      :id="controlId"
      :items="[...options]"
      :model-value="String(modelValue)"
      :disabled="inactive"
      class="w-full"
      @update:model-value="changeChoice(String($event))"
    />
    <URadioGroup
      v-else-if="type === 'radio'"
      :id="controlId"
      :aria-label="label"
      :items="[...options]"
      :model-value="String(modelValue)"
      :disabled="inactive"
      @update:model-value="changeChoice(String($event))"
    />
    <UCheckboxGroup
      v-else-if="type === 'multiselect'"
      :id="controlId"
      :aria-label="label"
      :items="[...options]"
      :model-value="Array.isArray(modelValue) ? modelValue : []"
      :disabled="inactive"
      @update:model-value="changeChoice($event ?? [])"
    />
    <UTextarea
      v-else-if="type === 'textarea'"
      :id="controlId"
      :model-value="String(draft)"
      :disabled="disabled"
      :readonly="readonly"
      :rows="rows"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :autocomplete="autocomplete"
      :autocapitalize="autocapitalize"
      :spellcheck="spellcheck"
      :ui="inputUi"
      class="w-full"
      @input="edit($event, 'input')"
      @change="edit($event, 'change')"
      @compositionstart="composing = true"
      @compositionend="finishComposition"
    />
    <div v-else-if="type === 'range'" class="flex min-w-0 items-center gap-4">
      <USlider
        :id="controlId"
        :aria-label="label"
        :aria-valuetext="unit ? `${draft} ${unit}` : undefined"
        :model-value="Number(draft)"
        :min="min ?? 0"
        :max="max ?? 100"
        :step="step === 'any' ? 0.000001 : (step ?? 1)"
        :disabled="inactive"
        class="min-w-0 flex-1"
        @update:model-value="previewRange"
        @change="commitRange"
      />
      <output :for="controlId" class="shrink-0 text-sm text-muted"
        >{{ draft }}<span v-if="unit"> {{ unit }}</span></output
      >
    </div>
    <UInput
      v-else
      :id="controlId"
      :type="type"
      :model-value="String(draft)"
      :disabled="disabled"
      :readonly="readonly"
      :placeholder="placeholder"
      :min="min"
      :max="max"
      :step="step"
      :maxlength="maxlength"
      :autocomplete="autocomplete"
      :autocapitalize="autocapitalize"
      :inputmode="inputmode"
      :spellcheck="spellcheck"
      :ui="inputUi"
      class="w-full"
      @input="edit($event, 'input')"
      @change="edit($event, 'change')"
      @blur="resetNumber"
      @compositionstart="composing = true"
      @compositionend="finishComposition"
      ><template v-if="unit" #trailing
        ><span aria-hidden="true" class="text-sm text-muted">{{ unit }}</span></template
      ></UInput
    >
  </UFormField>
</template>
