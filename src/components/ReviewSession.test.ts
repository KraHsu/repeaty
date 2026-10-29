// @vitest-environment happy-dom
import { createPinia } from 'pinia'
import { createApp, h, nextTick, ref, shallowReactive } from 'vue'
import { expect, it, vi } from 'vitest'
import ReviewSession from './ReviewSession.vue'
import { fixture, input } from '../core/test-fixtures'
import { saveNote, type Grade, type StudySession } from '../core/model'
import { reviewCard, undoReview } from '../core/scheduler'
import { operationFor, replayOperation, type Operation } from '../core/operations'
import { setLocale } from '../i18n'

vi.mock('../plugins', async () => {
  const { defineComponent, h } = await import('vue')
  const question = defineComponent({
    props: ['state'],
    setup(props) {
      props.state.allowedGrades = [1, 2, 3, 4]
      return () => h('p', 'Question')
    },
  })
  return {
    usePlugins: () => ({
      canReviewCard: () => true,
      enabledReviewPanels: [],
      questionPlugin: () => ({ showQuestion: question }),
    }),
  }
})
vi.mock('../plugins/manager', () => ({
  usePluginManager: () => ({ holdPluginRuntime: () => () => {} }),
}))
vi.mock('@nuxt/ui/components/DropdownMenu.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      setup(_, { slots }) {
        return () => h('div', slots.default?.())
      },
    }),
  }
})
async function flush() {
  for (let index = 0; index < 5; index++) await nextTick()
}
async function mountReview(filtered: boolean) {
  setLocale('zh-CN')
  const original = saveNote(fixture(), { ...input, front: 'Second question' })
  let operation: Operation | undefined
  const component = ref<InstanceType<typeof ReviewSession>>()
  const props = shallowReactive({
    library: original,
    busy: false,
    workspaceScope: 'local:test',
    lastOperationId: undefined as string | undefined,
    study: filtered
      ? ({ ids: original.cards.map((card) => card.id), reschedule: true } as StudySession)
      : undefined,
    submit: vi.fn(async (id: string, grade: Grade) => {
      const before = props.library
      props.library = reviewCard(before, id, grade, new Date(), filtered ? 'filtered' : 'normal')
      operation = operationFor(before, props.library, 'local:test', '评分', 'review')!
      props.lastOperationId = operation.id
      await nextTick()
      return true
    }),
    undo: async () => {
      props.library = undoReview(props.library)
      await nextTick()
      return true
    },
    change: async () => true,
    getMedia: async () => undefined,
    getSource: async () => '',
    getAttempt: async () => {
      throw new Error('Unexpected judge read')
    },
    saveAttempt: async () => {},
    finishPractice: async () => true,
  })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(ReviewSession, { ...props, ref: component }) })
  app.use(createPinia()).mount(host)
  await flush()
  return {
    props,
    component,
    host,
    original,
    operation: () => operation!,
    close: () => {
      app.unmount()
      host.remove()
    },
  }
}
async function grade() {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }),
  )
  await flush()
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: '3', code: 'Digit3', bubbles: true }),
  )
  await flush()
}

it.each([false, true])(
  'reconciles redo once in the current review session (filtered=%s)',
  async (filtered) => {
    const test = await mountReview(filtered)
    try {
      const firstCard = test.component.value!.current!.id
      await grade()
      const operation = test.operation(),
        rated = test.props.library
      expect(test.props.submit).toHaveBeenCalledTimes(1)
      expect(test.host.textContent).toContain('已复习 1 次')
      await test.component.value!.undoLast()
      await flush()
      expect(test.host.textContent).toContain('已复习 0 次')
      test.props.library = replayOperation(test.props.library, operation)
      await flush()
      test.component.value!.reconcileRedo(operation)
      await flush()
      expect(test.props.library).toEqual(rated)
      expect(test.host.textContent).toContain('已复习 1 次')
      expect(test.component.value!.current!.id).not.toBe(firstCard)
      test.component.value!.reconcileRedo(operation)
      await flush()
      expect(test.host.textContent).toContain('已复习 1 次')
      expect(test.props.submit).toHaveBeenCalledTimes(1)
      await grade()
      expect(test.props.submit).toHaveBeenCalledTimes(2)
      expect(test.props.submit.mock.calls[1]![0]).not.toBe(firstCard)
    } finally {
      test.close()
    }
  },
)

it('does not count persisted ratings from another session or grade them twice in a filtered round', async () => {
  const test = await mountReview(true)
  try {
    const firstCard = test.component.value!.current!.id
    const rated = reviewCard(test.original, firstCard, 3, new Date(), 'filtered')
    const operation = operationFor(test.original, rated, 'local:earlier-session', '评分', 'review')!
    test.props.library = rated
    await flush()
    test.component.value!.reconcileRedo(operation)
    await flush()
    expect(test.host.textContent).toContain('已复习 0 次')
    expect(test.component.value!.current!.id).not.toBe(firstCard)
    expect(test.props.submit).not.toHaveBeenCalled()
    test.props.library = undoReview(rated)
    await flush()
    test.component.value!.reconcileUndo(operation)
    await flush()
    expect(test.component.value!.current!.id).toBe(firstCard)
    expect(test.host.textContent).toContain('已复习 0 次')
  } finally {
    test.close()
  }
})
