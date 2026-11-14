import {
  onDispose,
  registerPage,
  registerSettings,
  type ExtensionPlugin,
} from '@repeaty/plugin-api'
import OptimizerPage from './OptimizerPage.vue'
import { optimizer } from './model'
import { errorText, text } from './text'
import { scheduleStartup } from './startup'

export default function activate(): ExtensionPlugin {
  registerPage({
    id: 'parameters',
    get title() {
      return text('title')
    },
    get description() {
      return text('description')
    },
    component: OptimizerPage,
  })
  registerSettings({
    id: 'automatic-training',
    category: [
      {
        id: 'study',
        get title() {
          return text('study')
        },
      },
      {
        id: 'review',
        get title() {
          return text('review')
        },
      },
    ],
    get title() {
      return text('settings')
    },
    get description() {
      return text('settingsHint')
    },
    get error() {
      return optimizer.error.value ? errorText(optimizer.error.value) : undefined
    },
    fields: [
      {
        key: 'scope',
        type: 'select',
        get label() {
          return text('scope')
        },
        get modelValue() {
          return optimizer.selectedDeck.value
        },
        get options() {
          return [
            { value: '', label: text('library') },
            ...(optimizer.state.value?.decks ?? []).map((deck) => ({
              value: deck.id,
              label: deck.name,
            })),
          ]
        },
        async onChange(value) {
          if (typeof value === 'string') await optimizer.select(value)
        },
      },
      {
        key: 'automatic',
        type: 'switch',
        get label() {
          return text('automatic')
        },
        get description() {
          return text('automaticHint')
        },
        get modelValue() {
          return optimizer.option.value.automatic
        },
        onChange(value) {
          if (typeof value === 'boolean') optimizer.configure(value, optimizer.option.value.apply)
        },
      },
      {
        key: 'apply',
        type: 'switch',
        get label() {
          return text('apply')
        },
        get description() {
          return text('applyHint')
        },
        get disabled() {
          return !optimizer.option.value.automatic
        },
        get modelValue() {
          return optimizer.option.value.apply
        },
        onChange(value) {
          if (typeof value === 'boolean')
            optimizer.configure(optimizer.option.value.automatic, value)
        },
      },
    ],
  })
  const cancelStartup = scheduleStartup(optimizer)
  onDispose(() => {
    cancelStartup()
    optimizer.dispose()
  })
  return {
    id: 'fsrs-optimizer',
    type: 'extension',
    kind: 'frontend',
    version: 1,
    get label() {
      return text('title')
    },
    get description() {
      return text('description')
    },
  }
}
