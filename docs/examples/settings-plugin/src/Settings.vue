<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  SettingGroup,
  SettingField,
  UiButton,
  UiIconButton,
  vUiControl,
  vUiButton,
  readSetting,
  writeSetting,
  type SettingValue,
} from '@repeaty/plugin-api'

interface DemoState {
  name: string
  notes: string
  limit: number
  layout: string
  placement: string
  features: string[]
  scale: number
  notifications: boolean
  confirmation: boolean
  email: string
}
const defaults = (): DemoState => ({
  name: 'Learning desk',
  notes: 'A small workspace for daily reading.',
  limit: 10,
  layout: 'comfortable',
  placement: 'side',
  features: ['history'],
  scale: 50,
  notifications: true,
  confirmation: false,
  email: 'example',
})
const state = reactive(defaults())
// Password fields demonstrate masking only. Real credentials belong in the device credential API.
const secret = ref('')
const nativeDefault = 'const result = 42\nreturn result'
const nativeDraft = ref(nativeDefault)
const nativeAdjustment = ref(4)
const nativeInput = ref<HTMLTextAreaElement>()
const saveIssue = ref('')
const emailError = computed(() =>
  state.email.includes('@') ? '' : 'Enter an email address containing @.',
)
try {
  const saved = JSON.parse(readSetting('shared-controls') ?? '{}') as Partial<DemoState>
  for (const key of Object.keys(state) as (keyof DemoState)[]) {
    const value = saved[key]
    if (
      (Array.isArray(state[key]) &&
        Array.isArray(value) &&
        value.every((item) => typeof item === 'string')) ||
      (typeof value === typeof state[key] && (typeof value !== 'number' || Number.isFinite(value)))
    )
      Object.assign(state, { [key]: value })
  }
} catch {
  // An unavailable preference store still permits this session's controls to work.
}
function save() {
  saveIssue.value = ''
  try {
    writeSetting('shared-controls', JSON.stringify(state), () => {
      saveIssue.value = 'Changes apply now, but could not be saved.'
    })
  } catch {
    saveIssue.value = 'Changes apply now, but could not be saved.'
  }
}
function update(key: keyof DemoState, value: SettingValue) {
  const previous = state[key]
  if (Array.isArray(previous)) {
    if (!Array.isArray(value)) return
    Object.assign(state, { [key]: [...value] })
  } else {
    if (typeof previous !== typeof value) return
    Object.assign(state, { [key]: value })
  }
  save()
}
function reset() {
  Object.assign(state, defaults())
  secret.value = ''
  save()
}
function clearNativeDraft() {
  nativeDraft.value = ''
  nativeInput.value?.focus()
}
function restoreNativeDraft() {
  nativeDraft.value = nativeDefault
  nativeInput.value?.focus()
}
</script>

<template>
  <div class="settings-example">
    <div class="settings-example__intro">
      <p>Every control below is rendered by Repeaty through its public plugin SDK.</p>
      <UiButton @click="reset">Reset defaults</UiButton>
    </div>
    <p v-if="saveIssue" role="alert">{{ saveIssue }}</p>
    <SettingGroup
      title="Text and values"
      description="Labels, descriptions and validation share one layout."
      :level="3"
    >
      <SettingField
        id="example-name"
        label="Workspace name"
        description="Saved when you leave the field."
        :model-value="state.name"
        commit="change"
        @update:model-value="update('name', $event)"
      />
      <SettingField
        id="example-secret"
        type="password"
        label="Demo password"
        description="Use synthetic text only. Real credentials use the device credential API. This value is not saved."
        :model-value="secret"
        autocomplete="new-password"
        @update:model-value="secret = String($event)"
      />
      <SettingField
        id="example-notes"
        type="textarea"
        label="Notes"
        description="A multiline field using the same font and focus states."
        :model-value="state.notes"
        :rows="3"
        commit="change"
        @update:model-value="update('notes', $event)"
      />
      <SettingField
        id="example-limit"
        type="number"
        label="Daily limit"
        description="A whole number from 1 to 50."
        :model-value="state.limit"
        :min="1"
        :max="50"
        :step="1"
        unit="cards"
        @update:model-value="update('limit', $event)"
      />
      <SettingField
        id="example-email"
        label="Contact email"
        :model-value="state.email"
        :error="emailError"
        commit="change"
        @update:model-value="update('email', $event)"
      />
      <SettingField
        id="example-disabled"
        label="Managed option"
        model-value="Managed by the host"
        disabled
        description="A disabled field remains visible and cannot be edited."
      />
      <SettingField
        id="example-readonly"
        label="Reference value"
        model-value="Read-only example"
        readonly
        description="A read-only value remains selectable."
      />
    </SettingGroup>
    <SettingGroup
      title="Choices and adjustments"
      description="Native keyboard behavior with the host's visual style."
      :level="3"
    >
      <SettingField
        id="example-layout"
        type="select"
        label="Layout density"
        :model-value="state.layout"
        :options="[
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'compact', label: 'Compact' },
        ]"
        @update:model-value="update('layout', $event)"
      />
      <SettingField
        id="example-placement"
        type="radio"
        label="History placement"
        :model-value="state.placement"
        :options="[
          { value: 'side', label: 'Beside the card', description: 'Keep the question in view.' },
          { value: 'below', label: 'Below the card' },
        ]"
        @update:model-value="update('placement', $event)"
      />
      <SettingField
        id="example-features"
        type="multiselect"
        label="Visible details"
        :model-value="state.features"
        :options="[
          { value: 'history', label: 'Review history' },
          { value: 'counts', label: 'Card counts' },
          { value: 'unavailable', label: 'Unavailable detail', disabled: true },
        ]"
        @update:model-value="update('features', $event)"
      />
      <SettingField
        id="example-scale"
        type="range"
        label="Reading scale"
        description="Updates while dragging; saves when the adjustment finishes."
        :model-value="state.scale"
        :min="0"
        :max="100"
        :step="5"
        unit="%"
        @update:model-value="update('scale', $event)"
      />
      <SettingField
        id="example-notifications"
        type="switch"
        label="Notifications"
        description="Show messages after an action completes."
        :model-value="state.notifications"
        @update:model-value="update('notifications', $event)"
      />
      <SettingField
        id="example-confirmation"
        type="checkbox"
        label="Confirm changes"
        :model-value="state.confirmation"
        @update:model-value="update('confirmation', $event)"
      />
      <section class="settings-example__native" aria-labelledby="example-native-title">
        <h4 id="example-native-title">Native editing surface</h4>
        <p id="example-native-description">
          Native refs, selection and keyboard events stay in the plugin. This draft is not saved.
        </p>
        <label for="example-native-draft">Native code draft</label>
        <textarea
          id="example-native-draft"
          ref="nativeInput"
          v-model="nativeDraft"
          v-ui-control="{ monospace: true }"
          rows="3"
          spellcheck="false"
          aria-describedby="example-native-description"
        />
        <label for="example-native-adjustment">Native adjustment</label>
        <input
          id="example-native-adjustment"
          v-model.number="nativeAdjustment"
          v-ui-control
          type="range"
          min="0"
          max="10"
          step="1"
        />
        <output for="example-native-adjustment">{{ nativeAdjustment }}</output>
        <div class="settings-example__native-actions">
          <UiIconButton label="Clear native draft" @click="clearNativeDraft">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                d="m5 5 8 8m0-8-8 8"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </UiIconButton>
          <button v-ui-button type="button" @click="restoreNativeDraft">
            Restore native draft
          </button>
        </div>
      </section>
    </SettingGroup>
  </div>
</template>

<style scoped>
.settings-example__intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.settings-example__intro p {
  max-width: 42rem;
  color: var(--muted);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-ui);
}
.settings-example__native {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
  padding: 1.25rem 0;
}
.settings-example__native h4,
.settings-example__native p {
  margin: 0;
}
.settings-example__native h4 {
  font-size: var(--font-size-control);
  font-weight: var(--font-weight-semibold);
}
.settings-example__native p,
.settings-example__native output {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.settings-example__native-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
</style>
