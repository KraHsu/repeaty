// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, shallowRef, type Component, type VNode } from 'vue'
import { fixture } from '../core/test-fixtures'
import { studySettingsSchema, type StudySettings as Settings } from '../core/study-settings'
import { previewNewCardBalance } from '../core/new-card-balance'
import StudySettings from './StudySettings.vue'
import NewCardBalanceDialog from './NewCardBalanceDialog.vue'

const context = vi.hoisted(() => ({ application: {} as Record<string, unknown> }))
vi.mock('../app/context', () => ({ useApplication: () => context.application }))
vi.mock('./AppModal.vue', () => ({
  default: {
    props: ['title', 'error'],
    setup:
      (
        props: { title: string; error: string },
        { slots }: { slots: { default?: () => VNode[] } },
      ) =>
      () =>
        h('section', [
          h('h1', props.title),
          props.error && h('p', { role: 'alert' }, props.error),
          slots.default?.(),
        ]),
  },
}))
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop())
  vi.restoreAllMocks()
})
async function settle() {
  for (let index = 0; index < 8; index++) await nextTick()
}
async function mount(component: Component, props: Record<string, unknown>) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(component, props) })
  app.mount(root)
  const dispose = () => {
    app.unmount()
    root.remove()
  }
  cleanups.push(dispose)
  await settle()
  const button = (label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (entry) => entry.textContent?.trim() === label,
    )!
  const number = async (id: string, value: string) => {
    const input = root.querySelector<HTMLInputElement>(`#${id}`)!
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
  }
  return { root, button, number, dispose }
}
it('validates scheduling values, keeps model metadata, and updates a clean form after undo', async () => {
  const library = shallowRef(fixture())
  library.value.studySettings = [
    studySettingsSchema.parse({
      statisticsSince: '2026-10-30T00:00:00Z',
      activeFsrsModelId: 'model',
      cardsPerReading: 7,
    }),
  ]
  const scope = ref('library')
  const saveStudySettings = vi.fn(async (settings: Settings) => {
    library.value = { ...library.value, studySettings: [settings] }
  })
  context.application = { library, workspace: { scope, saveStudySettings } }
  const { root, button, number } = await mount(StudySettings, {
    section: 'review',
    isCurrent: () => true,
  })
  await number('study-dayStartHour', '24')
  root
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await settle()
  expect(saveStudySettings).not.toHaveBeenCalled()
  await number('study-dayStartHour', '4')
  button('保存学习设置').click()
  await settle()
  expect(saveStudySettings).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      dayStartHour: 4,
      cardsPerReading: 7,
      activeFsrsModelId: 'model',
      statisticsSince: '2026-10-30T00:00:00Z',
    }),
    'library',
  )
  expect(root.textContent).toContain('学习设置已保存')
  library.value = {
    ...library.value,
    studySettings: [{ ...library.value.studySettings[0]!, dayStartHour: 0 }],
  }
  await settle()
  expect(root.querySelector<HTMLInputElement>('#study-dayStartHour')!.value).toBe('0')
  expect(button('保存学习设置').disabled).toBe(true)
})
it('retains unsaved settings on storage failure and refuses a stale library save', async () => {
  const library = shallowRef(fixture()),
    scope = ref('library')
  const saveStudySettings = vi.fn(async () => {
    throw new Error('save failed')
  })
  context.application = { library, workspace: { scope, saveStudySettings } }
  const { root, button, number } = await mount(StudySettings, {
    section: 'queue',
    isCurrent: () => true,
  })
  await number('study-cardsPerReading', '6')
  button('保存学习设置').click()
  await settle()
  expect(root.textContent).toContain('save failed')
  expect(root.querySelector<HTMLInputElement>('#study-cardsPerReading')!.value).toBe('6')
  scope.value = 'other-library'
  button('保存学习设置').click()
  await settle()
  expect(saveStudySettings).toHaveBeenCalledOnce()
})
it('requires a balanced preview before applying and invalidates a preview when its inputs change', async () => {
  const library = fixture(),
    preview = vi.fn((options) =>
      previewNewCardBalance(library, options, new Date('2026-10-30T12:00:00Z')),
    ),
    apply = vi.fn(async (plan) => {
      structuredClone(plan)
    })
  const { root, button } = await mount(NewCardBalanceDialog, {
    ids: [library.cards[0]!.id],
    scope: 'library',
    windowDays: 3,
    preview,
    apply,
  })
  expect(button('确认应用安排')).toBeUndefined()
  button('预览安排').click()
  await settle()
  expect(root.querySelectorAll('tbody tr')).toHaveLength(3)
  expect(apply).not.toHaveBeenCalled()
  const input = root.querySelector<HTMLInputElement>('input[type="number"]')!
  input.value = '2'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
  expect(button('确认应用安排')).toBeUndefined()
  button('预览安排').click()
  await settle()
  button('确认应用安排').click()
  await settle()
  expect(apply).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ windowDays: 2, ids: [library.cards[0]!.id] }),
    'library',
  )
})
it('does not apply partial plans when the daily limit cannot fit selected new cards', async () => {
  const library = fixture()
  library.decks[0]!.newLimit = 0
  const apply = vi.fn()
  const { root, button } = await mount(NewCardBalanceDialog, {
    ids: [library.cards[0]!.id],
    scope: 'library',
    windowDays: 2,
    preview: (options: { ids: string[] }) => previewNewCardBalance(library, options),
    apply,
  })
  button('预览安排').click()
  await settle()
  expect(root.textContent).toContain('窗口内的新卡额度不足')
  expect(button('确认应用安排').disabled).toBe(true)
  expect(apply).not.toHaveBeenCalled()
})
