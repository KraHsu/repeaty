// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, shallowRef, type App } from 'vue'
import SourceReader from './SourceReader.vue'
import { prepareSource } from '../core/sources'

const mocks = vi.hoisted(() => ({ manager: vi.fn() }))
vi.mock('../plugins/manager', () => ({ usePluginManager: () => mocks.manager() }))
vi.mock('./AppModal.vue', () => ({
  default: defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h('section', slots.default?.()),
  }),
}))
const apps: App[] = []
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function settle() {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
function setup() {
  const command = {
    id: 'regions',
    title: 'Open regions',
    formats: ['markdown'],
    component: defineComponent({
      props: { onClose: { type: Function, required: true } },
      setup: (props) => () => h('button', { onClick: () => props.onClose() }, 'Finish command'),
    }),
  }
  const owner = { plugin: { id: 'visual' }, commands: [command] },
    owners = shallowRef([owner]),
    dispose = vi.fn(),
    snapshot = vi.fn(() => ({ revision: 4 })),
    openMaterialTool = vi.fn((_plugin, _command, context) => ({
      command,
      installation: owner,
      context,
      dispose,
    }))
  mocks.manager.mockReturnValue({
    pluginRuntime: {
      get installations() {
        return owners.value
      },
    },
    materialApiFor: () => ({ snapshot }),
    openMaterialTool,
  })
  const source = prepareSource({
      title: 'Source',
      content: '$a+b$',
      format: 'markdown',
      url: '',
    }).source,
    gate = deferred<() => void>(),
    release = vi.fn(),
    holdReading = vi.fn(() => gate.promise),
    props = reactive({ source, text: '$a+b$', scope: 'scope-one', holdReading }),
    root = document.createElement('div'),
    app = createApp({ render: () => h(SourceReader, props) })
  document.body.append(root)
  app.mount(root)
  apps.push(app)
  const click = (name: string) =>
    [...root.querySelectorAll('button')].find((button) => button.textContent === name)!.click()
  return {
    root,
    app,
    click,
    gate,
    release,
    holdReading,
    snapshot,
    openMaterialTool,
    dispose,
    props,
    owners,
  }
}

it('captures the command revision only after the position-save hold is acquired and owns it through the modal lifetime', async () => {
  const test = setup()
  await settle()
  test.click('Open regions')
  await settle()
  expect(test.holdReading).toHaveBeenCalledOnce()
  expect(test.snapshot).not.toHaveBeenCalled()
  test.gate.resolve(test.release)
  await settle()
  expect(test.openMaterialTool).toHaveBeenCalledWith(
    'visual',
    'regions',
    expect.objectContaining({ expectedRevision: 4 }),
  )
  expect(test.release).not.toHaveBeenCalled()
  test.props.source = {
    ...test.props.source,
    reading: { offset: 0, fraction: 0, view: 'preview', updatedAt: new Date().toISOString() },
  }
  await settle()
  expect(test.dispose).not.toHaveBeenCalled()
  test.click('Finish command')
  await settle()
  expect(test.release).toHaveBeenCalledOnce()
  expect(test.dispose).toHaveBeenCalledOnce()
  test.click('Open regions')
  await settle()
  test.owners.value = []
  await settle()
  expect(test.release).toHaveBeenCalledTimes(2)
  expect(test.dispose).toHaveBeenCalledTimes(2)
})

it.each(['scope', 'unmount'] as const)(
  'releases a late hold without opening a tool after %s changes',
  async (change) => {
    const test = setup()
    await settle()
    test.click('Open regions')
    await settle()
    if (change === 'scope') test.props.scope = 'scope-two'
    else {
      test.app.unmount()
      apps.splice(apps.indexOf(test.app), 1)
    }
    await settle()
    test.gate.resolve(test.release)
    await settle()
    expect(test.openMaterialTool).not.toHaveBeenCalled()
    expect(test.snapshot).not.toHaveBeenCalled()
    expect(test.release).toHaveBeenCalledOnce()
  },
)
