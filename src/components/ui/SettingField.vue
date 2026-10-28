<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import type { SettingFieldProps, SettingValue } from './types'
import { vUiControl } from './directives'

const props = withDefaults(defineProps<SettingFieldProps>(), {
  type: 'text',
  options: () => [],
  rows: 4,
  layout: 'row',
})
const emit = defineEmits<{ 'update:modelValue': [value: SettingValue] }>()
const generatedId = `setting-${useId()}`
const controlId = computed(() => props.id || generatedId)
const labelId = computed(() => `${controlId.value}-label`)
const descriptionId = computed(() => `${controlId.value}-description`)
const errorId = computed(() => `${controlId.value}-error`)
const describedBy = computed(
  () =>
    [props.description && descriptionId.value, props.error && errorId.value]
      .filter(Boolean)
      .join(' ') || undefined,
)
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
const rangeProgress = computed(() => {
  const min = props.min ?? 0,
    max = props.max ?? 100
  return `${max > min ? Math.min(100, Math.max(0, ((Number(draft.value) - min) / (max - min)) * 100)) : 0}%`
})

function rollback(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
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
  const element = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  if (props.disabled || props.readonly) {
    rollback(element)
    return
  }
  const numeric = props.type === 'number' || props.type === 'range'
  const value = numeric ? numericValue(element as HTMLInputElement) : element.value
  draft.value = numeric && value !== undefined ? value : element.value
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
function changeBinary(event: Event) {
  const element = event.target as HTMLInputElement
  if (props.disabled || props.readonly) {
    element.checked = Boolean(props.modelValue)
    return
  }
  changeChoice(element.checked)
}
function changeMultiple(value: string, checked: boolean) {
  const selected = Array.isArray(props.modelValue) ? props.modelValue : []
  changeChoice(
    checked ? [...new Set([...selected, value])] : selected.filter((item) => item !== value),
  )
}
function resetNumber(event: FocusEvent) {
  if (props.type === 'number') rollback(event.target as HTMLInputElement)
}
</script>

<template>
  <div
    class="ui-setting-field"
    :class="{
      'ui-setting-field--stack': layout === 'stack' || type === 'textarea' || grouped,
      'ui-setting-field--binary': binary,
      'ui-setting-field--disabled': disabled,
      'ui-setting-field--error': error,
      'ui-setting-field--mono': monospace,
    }"
  >
    <fieldset
      v-if="grouped"
      class="ui-setting-field__fieldset"
      :disabled="inactive"
      :aria-describedby="describedBy"
      :aria-invalid="error ? true : undefined"
    >
      <legend :id="labelId" class="ui-setting-field__label">{{ label }}</legend>
      <p v-if="description" :id="descriptionId" class="ui-setting-field__description">
        {{ description }}
      </p>
      <div class="ui-setting-field__options">
        <label v-for="(option, index) in options" :key="option.value" class="ui-setting-choice">
          <input
            :id="`${controlId}-${index}`"
            class="ui-setting-choice__input"
            :type="type === 'radio' ? 'radio' : 'checkbox'"
            :name="controlId"
            :value="option.value"
            :disabled="inactive || option.disabled"
            :checked="
              type === 'radio'
                ? modelValue === option.value
                : Array.isArray(modelValue) && modelValue.includes(option.value)
            "
            @change="
              type === 'radio'
                ? changeChoice(option.value)
                : changeMultiple(option.value, ($event.target as HTMLInputElement).checked)
            "
          />
          <span class="ui-setting-choice__copy">
            <span class="ui-setting-choice__label">{{ option.label }}</span>
            <span v-if="option.description" class="ui-setting-choice__description">{{
              option.description
            }}</span>
          </span>
        </label>
      </div>
      <p v-if="error" :id="errorId" class="ui-setting-field__error" role="alert">{{ error }}</p>
    </fieldset>
    <template v-else>
      <div class="ui-setting-field__copy">
        <label :id="labelId" class="ui-setting-field__label" :for="controlId">{{ label }}</label>
        <p v-if="description" :id="descriptionId" class="ui-setting-field__description">
          {{ description }}
        </p>
        <p v-if="error" :id="errorId" class="ui-setting-field__error" role="alert">{{ error }}</p>
      </div>
      <div class="ui-setting-field__control">
        <label
          v-if="binary"
          class="ui-setting-toggle"
          :class="{ 'ui-setting-toggle--checkbox': type === 'checkbox' }"
        >
          <input
            :id="controlId"
            :type="'checkbox'"
            :role="type === 'switch' ? 'switch' : undefined"
            class="ui-setting-toggle__input"
            :checked="Boolean(modelValue)"
            :disabled="inactive"
            :aria-labelledby="labelId"
            :aria-describedby="describedBy"
            :aria-invalid="error ? true : undefined"
            @change="changeBinary"
          />
          <span v-if="type === 'switch'" class="ui-setting-toggle__track" aria-hidden="true" />
        </label>
        <select
          v-ui-control
          v-else-if="type === 'select'"
          :id="controlId"
          class="ui-control ui-control--select"
          :value="String(draft)"
          :disabled="inactive"
          :aria-describedby="describedBy"
          :aria-invalid="error ? true : undefined"
          @change="edit($event, updateOn)"
        >
          <option
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            :disabled="option.disabled"
          >
            {{ option.label }}
          </option>
        </select>
        <textarea
          v-ui-control="{ monospace }"
          v-else-if="type === 'textarea'"
          :id="controlId"
          class="ui-control ui-control--textarea"
          :value="String(draft)"
          :disabled="disabled"
          :readonly="readonly"
          :rows="rows"
          :placeholder="placeholder"
          :maxlength="maxlength"
          :autocomplete="autocomplete"
          :autocapitalize="autocapitalize"
          :spellcheck="spellcheck"
          :aria-describedby="describedBy"
          :aria-invalid="error ? true : undefined"
          @input="edit($event, 'input')"
          @change="edit($event, 'change')"
          @compositionstart="composing = true"
          @compositionend="finishComposition"
        />
        <template v-else-if="type === 'range'">
          <div class="ui-setting-range">
            <input
              v-ui-control
              :id="controlId"
              type="range"
              class="ui-control ui-control--range"
              :value="draft"
              :min="min ?? 0"
              :max="max ?? 100"
              :step="step ?? 1"
              :disabled="inactive"
              :aria-describedby="describedBy"
              :aria-invalid="error ? true : undefined"
              :aria-valuetext="unit ? `${draft} ${unit}` : undefined"
              :style="{ '--ui-range-progress': rangeProgress }"
              @input="edit($event, 'input')"
              @change="edit($event, 'change')"
            />
            <output :for="controlId" class="ui-setting-range__value"
              >{{ draft }}<span v-if="unit"> {{ unit }}</span></output
            >
          </div>
        </template>
        <div v-else class="ui-setting-input" :class="{ 'ui-setting-input--unit': unit }">
          <input
            v-ui-control="{ monospace }"
            :id="controlId"
            :type="type"
            class="ui-control"
            :value="draft"
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
            :aria-describedby="describedBy"
            :aria-invalid="error ? true : undefined"
            @input="edit($event, 'input')"
            @change="edit($event, 'change')"
            @blur="resetNumber"
            @compositionstart="composing = true"
            @compositionend="finishComposition"
          />
          <span v-if="unit" class="ui-setting-input__unit" aria-hidden="true">{{ unit }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
