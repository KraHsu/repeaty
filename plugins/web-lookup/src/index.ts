import { defineComponent, h, ref } from 'vue'
import {
  onDispose,
  readSetting,
  registerCommand,
  registerSettings,
  persistSetting,
  type ExtensionPlugin,
} from '@repeaty/plugin-api'
import LookupSettings from './LookupSettings.vue'
import LookupDialog from './LookupDialog.vue'
import { defaults, normalizeTargets, type LookupTarget } from './lookup'
import { text } from './text'
export default function activate(): ExtensionPlugin {
  const targets = ref(defaults()),
    error = ref('')
  let alive = true
  onDispose(() => {
    alive = false
  })
  try {
    const saved = readSetting('targets')
    if (saved) targets.value = normalizeTargets(JSON.parse(saved))
  } catch {
    error.value = text('查询目标无法读取，当前使用默认目标。')
  }
  async function save(value: LookupTarget[]) {
    const next = normalizeTargets(value)
    await persistSetting('targets', JSON.stringify(next))
    if (alive) {
      targets.value = next
      error.value = ''
    }
  }
  registerSettings({
    id: 'targets',
    get title() {
      return text('选区查询')
    },
    category: [
      {
        id: 'tools',
        get title() {
          return text('工具')
        },
      },
      {
        id: 'web-lookup',
        get title() {
          return text('选区查询')
        },
      },
    ],
    component: defineComponent({
      setup: () => () => h(LookupSettings, { targets: targets.value, error: error.value, save }),
    }),
  })
  registerCommand({
    id: 'lookup',
    get title() {
      return text('查询选中文字')
    },
    formats: ['*'],
    component: defineComponent({
      props: ['context', 'onClose'],
      setup: (props) => () =>
        h(LookupDialog, {
          selection: props.context.selection?.text ?? '',
          targets: targets.value,
          onClose: props.onClose,
        }),
    }),
  })
  return {
    id: 'web-lookup',
    type: 'extension',
    kind: 'frontend',
    version: 1,
    get label() {
      return text('选区查询')
    },
    get description() {
      return text('使用搜索、词典和问答网站查询选中文字。')
    },
  }
}
