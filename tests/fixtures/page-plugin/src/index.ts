import {
  defineComponent,
  h,
  onMounted,
  onUnmounted,
  ref,
  type DefineComponent,
  type PropType,
} from 'vue'
import {
  AppPage,
  UiButton,
  UiInput,
  onDispose,
  pluginData,
  readSetting,
  registerPage,
  registerWidget,
  writeSetting,
  type ExtensionPlugin,
  type Review,
  type UiButtonVariant,
} from '@repeaty/plugin-api'

// Keep render-function inference bounded while consuming the real public SDK components.
const Button = UiButton as DefineComponent<{
  variant?: UiButtonVariant
  onClick?: () => void | Promise<void>
}>
const Input = UiInput as DefineComponent<{
  modelValue?: string
  'onUpdate:modelValue'?: (value: string | number | null) => void
  'aria-label'?: string
  placeholder?: string
}>

// These probes belong to this independently compiled test package, never to the host.
const global = globalThis as typeof globalThis & {
  __pagePluginProbe?: { mounted: number; unmounted: number; timers: number; disposed: number }
}
const probe = (global.__pagePluginProbe ??= { mounted: 0, unmounted: 0, timers: 0, disposed: 0 })
onDispose(() => probe.disposed++)
let unregisterCustom: (() => void) | undefined
let unregisterWidget: (() => void) | undefined
let failNext = true

const Widget = defineComponent({
  props: { reviews: { type: Array as PropType<readonly Review[]>, required: true } },
  setup(props) {
    return () =>
      h('div', { 'data-testid': 'plugin-review-widget' }, [
        h('output', { 'data-testid': 'widget-review-count' }, String(props.reviews.length)),
        h(
          Button,
          {
            onClick() {
              unregisterWidget?.()
              unregisterWidget = undefined
            },
          },
          () => 'Remove widget',
        ),
      ])
  },
})
function restoreWidget() {
  unregisterWidget ??= registerWidget({
    id: 'review-total',
    title: 'Plugin review total',
    placement: 'overview.after-decks',
    component: Widget,
  })
}
const Custom = defineComponent({
  setup() {
    return () =>
      h('article', { class: 'external-custom-page' }, [
        h('h1', 'Custom workspace'),
        h('p', 'This page chooses its own layout.'),
        h(
          Button,
          {
            onClick() {
              unregisterCustom?.()
              unregisterCustom = undefined
            },
          },
          () => 'Remove this page',
        ),
      ])
  },
})
function restoreCustom() {
  unregisterCustom ??= registerPage({ id: 'custom', title: 'Custom workspace', component: Custom })
}
const Notebook = defineComponent({
  props: { workspaceScope: { type: String, required: true } },
  setup(props) {
    const note = ref(readSetting('note') ?? '')
    const saved = ref(note.value)
    const privateNote = ref('')
    let alive = true
    let timer: ReturnType<typeof setInterval> | undefined
    onMounted(async () => {
      probe.mounted++
      probe.timers++
      timer = setInterval(() => {}, 1000)
      const value = await pluginData.get('note', props.workspaceScope)
      if (alive) privateNote.value = typeof value === 'string' ? value : ''
    })
    onUnmounted(() => {
      alive = false
      clearInterval(timer)
      probe.unmounted++
      probe.timers--
    })
    async function save() {
      writeSetting('note', note.value)
      await pluginData.set('note', note.value, props.workspaceScope)
      if (alive) saved.value = privateNote.value = note.value
    }
    return () =>
      h(
        AppPage,
        {
          title: 'Plugin notebook',
          description: 'An independent plugin page using the shared container.',
          class: 'external-notebook-page',
        },
        {
          actions: () => h(Button, { variant: 'primary', onClick: save }, () => 'Save plugin note'),
          default: () => [
            h(Input, {
              modelValue: note.value,
              'onUpdate:modelValue': (value: string | number | null) =>
                (note.value = String(value ?? '')),
              'aria-label': 'Plugin note',
              placeholder: 'A note in this learning library',
            }),
            h('output', { 'data-testid': 'saved-plugin-note' }, saved.value),
            h('output', { 'data-testid': 'private-plugin-note' }, privateNote.value),
            h('output', { 'data-testid': 'plugin-page-scope' }, props.workspaceScope),
            h(Button, { onClick: restoreCustom }, () => 'Restore custom page'),
            h(Button, { onClick: restoreWidget }, () => 'Restore widget'),
          ],
        },
      )
  },
})
const Recoverable = defineComponent({
  setup() {
    if (failNext) {
      failNext = false
      throw new Error('page-plugin-intentional-render-error')
    }
    return () => h(AppPage, { title: 'Recovered plugin page' }, () => 'Recovered successfully')
  },
})

registerPage({ id: 'notebook', title: 'Plugin notebook', component: Notebook })
restoreCustom()
registerPage({ id: 'recoverable', title: 'Recoverable page', component: Recoverable })
restoreWidget()

export default {
  id: 'page-lifecycle-check',
  kind: 'frontend',
  version: 1,
  label: 'Page Lifecycle Check',
  type: 'extension',
} satisfies ExtensionPlugin
