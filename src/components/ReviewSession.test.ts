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
import { studyEventSchema } from '../core/study-data'
import { createInputController, INPUT_COMMANDS, type InputController } from '../input/controller'
import { useSettingsStore } from '../settings-store'

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
async function mountReview(filtered: boolean, plainPractice = false, commands?: InputController) {
  setLocale('zh-CN')
  const original = saveNote(fixture(), { ...input, front: 'Second question' })
  if (plainPractice) original.cards[0]!.id = 'c'.repeat(150)
  let operation: Operation | undefined
  const component = ref<InstanceType<typeof ReviewSession>>()
  const props = shallowReactive({
    library: original,
    busy: false,
    workspaceScope: 'local:test',
    lastOperationId: undefined as string | undefined,
    study:
      filtered || plainPractice
        ? ({
            ids: original.cards.map((card) => card.id),
            reschedule: !plainPractice,
          } as StudySession)
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
    recordPlainPractice: vi.fn(async (id: string, cardId: string) => {
      studyEventSchema.parse({
        id,
        cardId,
        kind: 'practice',
        studyDay: '2026-10-30',
        occurredAt: new Date().toISOString(),
      })
      return true
    }),
    undoPlainPractice: vi.fn(async () => true),
  })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(ReviewSession, { ...props, ref: component }) })
  if (commands) app.provide(INPUT_COMMANDS, commands)
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

it('honors remapped review keys and removes active commands on unmount', async () => {
  useSettingsStore({ getItem: () => null, setItem: () => {} })
  const commands = createInputController(ref('local:test'))
  await commands.saveShortcuts('review.reveal', ['K'])
  await commands.saveShortcuts('review.good', ['G'])
  const test = await mountReview(false, false, commands)
  try {
    expect(test.host.textContent).toContain('或按 K')
    expect(test.host.textContent).not.toContain('或按空格键')
    await grade()
    expect(test.props.submit).not.toHaveBeenCalled()
    const press = async (key: string, isComposing = false) => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key, isComposing, bubbles: true, cancelable: true }),
      )
      await flush()
    }
    await press('k', true)
    await press('g')
    expect(test.props.submit).not.toHaveBeenCalled()
    await press('k')
    expect(
      [...test.host.querySelectorAll('.grade-title kbd')].map((node) => node.textContent),
    ).toContain('G')
    await press('g')
    expect(test.props.submit).toHaveBeenCalledTimes(1)
  } finally {
    test.close()
    expect(await commands.run('review.reveal')).toBe(false)
    commands.dispose()
  }
})

it('uses bounded stable practice event IDs for valid long card IDs and repeat after undo', async () => {
  const test = await mountReview(false, true)
  try {
    await grade()
    expect(test.props.recordPlainPractice).toHaveBeenCalledOnce()
    const [eventId, cardId] = test.props.recordPlainPractice.mock.calls[0]!
    expect(eventId.length).toBeLessThanOrEqual(150)
    expect(cardId).toHaveLength(150)
    await test.component.value!.undoLast()
    await flush()
    expect(test.props.undoPlainPractice).toHaveBeenCalledWith(eventId, 'local:test')
    await grade()
    expect(test.props.recordPlainPractice.mock.calls[1]![0]).toBe(eventId)
    expect(test.props.library.reviews).toHaveLength(0)
  } finally {
    test.close()
  }
})

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
