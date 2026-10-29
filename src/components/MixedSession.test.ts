import { createPinia } from 'pinia'
// @vitest-environment happy-dom
import { createApp, h, nextTick, ref, shallowReactive, type App } from 'vue'
import { expect, it, vi } from 'vitest'
import MixedSession from './MixedSession.vue'
import { fixture, now } from '../core/test-fixtures'
import { addSource, prepareSource } from '../core/sources'
import { reviewCard, undoReview } from '../core/scheduler'
import { operationFor, replayOperation, revertOperation, type Operation } from '../core/operations'
import { arrangeSource } from '../core/source-queue'
import { setLocale } from '../i18n'

it.each(['card', 'reading'] as const)(
  'does not undo %s after disposal while saving a reading position',
  async (kind) => {
    setLocale('zh-CN')
    const prepared = prepareSource(
      { title: 'Source', url: '', format: 'plain', content: 'Text' },
      now,
    )
    const library = addSource(fixture(), prepared.source, prepared.asset)
    if (kind === 'reading') {
      library.notes = []
      library.cards = []
    }
    let resume!: (value: boolean) => void
    const waiting = new Promise<boolean>((resolve) => {
      resume = resolve
    })
    const undoCard = vi.fn(async () => true),
      undoReading = vi.fn(async () => true)
    const props = shallowReactive({
      library,
      now,
      scope: 'local:test',
      busy: false,
      cardsPerReading: 1,
      leaveReading: () => waiting,
      undoCard,
      undoReading,
      canUndoReading: true,
      readingUndoId: 'undo-source',
    })
    const host = document.createElement('div')
    document.body.append(host)
    let app: App | undefined = createApp({
      render: () =>
        h(MixedSession, props, {
          card: ({
            item,
            done,
            activity,
          }: {
            item: { id: string }
            done: (graded: boolean) => void
            activity: (busy: boolean) => void
          }) =>
            h(
              'button',
              {
                'data-test': 'grade',
                onClick: async () => {
                  activity(true)
                  props.library = reviewCard(props.library, item.id, 3, now)
                  await nextTick()
                  done(true)
                  activity(false)
                },
              },
              'Grade',
            ),
          reading: () => h('p', { 'data-test': 'reading' }, 'Reading'),
        }),
    })
    try {
      app.use(createPinia())
      app.mount(host)
      if (kind === 'card') {
        host.querySelector<HTMLButtonElement>('[data-test=grade]')!.click()
        await nextTick()
        await nextTick()
      }
      expect(host.querySelector('[data-test=reading]')).not.toBeNull()
      const title = kind === 'card' ? '撤销上次评分' : '撤销阅读安排'
      const button = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === title,
      )!
      expect(button.disabled).toBe(false)
      button.click()
      await nextTick()
      app.unmount()
      app = undefined
      resume(true)
      await nextTick()
      await nextTick()
      expect(undoCard).not.toHaveBeenCalled()
      expect(undoReading).not.toHaveBeenCalled()
    } finally {
      app?.unmount()
      resume(true)
      host.remove()
    }
  },
)

it.each(['card', 'reading'] as const)(
  'restores the mixed-session %s checkpoint exactly once on redo',
  async (kind) => {
    setLocale('zh-CN')
    const prepared = prepareSource(
      { title: 'Source', url: '', format: 'plain', content: 'Text' },
      now,
    )
    const original = addSource(fixture(), prepared.source, prepared.asset)
    if (kind === 'reading') {
      original.notes = []
      original.cards = []
    }
    let operation: Operation
    const component = ref<InstanceType<typeof MixedSession>>()
    const props = shallowReactive({
      library: original,
      now,
      scope: 'local:test',
      busy: false,
      cardsPerReading: 1,
      leaveReading: async () => true,
      undoCard: async (): Promise<boolean> => {
        props.library = undoReview(props.library)
        await nextTick()
        return true
      },
      undoReading: async (): Promise<boolean> => {
        props.library = revertOperation(props.library, operation)
        await nextTick()
        return true
      },
      canUndoReading: true,
      readingUndoId: undefined as string | undefined,
    })
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      render: () =>
        h(
          MixedSession,
          { ...props, ref: component },
          {
            card: ({
              item,
              done,
              activity,
            }: {
              item: { id: string }
              done: (graded: boolean) => void
              activity: (busy: boolean) => void
            }) =>
              h(
                'button',
                {
                  'data-test': 'grade',
                  onClick: async () => {
                    activity(true)
                    const before = props.library
                    props.library = reviewCard(before, item.id, 3, now)
                    operation = operationFor(before, props.library, props.scope, '评分', 'review')!
                    await nextTick()
                    done(true)
                    activity(false)
                  },
                },
                'Grade',
              ),
            reading: ({
              done,
              activity,
            }: {
              done: (arranged: boolean) => void
              activity: (busy: boolean) => void
            }) =>
              h(
                'button',
                {
                  'data-test': 'reading',
                  onClick: async () => {
                    activity(true)
                    const before = props.library
                    props.library = arrangeSource(
                      before,
                      prepared.source.id,
                      prepared.source.mediaId,
                      { type: 'archive' },
                      now,
                    )
                    operation = operationFor(
                      before,
                      props.library,
                      props.scope,
                      '阅读安排',
                      'reading',
                    )!
                    props.readingUndoId = operation.id
                    await nextTick()
                    done(true)
                    activity(false)
                  },
                },
                'Reading',
              ),
          },
        ),
    })
    app.use(createPinia()).mount(host)
    const flush = async () => {
      for (let index = 0; index < 4; index++) await nextTick()
    }
    try {
      host
        .querySelector<HTMLButtonElement>(
          kind === 'card' ? '[data-test=grade]' : '[data-test=reading]',
        )!
        .click()
      await flush()
      expect(host.querySelector('[role=status]')!.textContent).toContain(
        kind === 'card' ? '已复习 1 次' : '已处理 1 篇',
      )
      if (kind === 'card') await component.value!.undoCard()
      else await component.value!.undoReading()
      await flush()
      expect(host.querySelector('[role=status]')!.textContent).toContain(
        kind === 'card' ? '已复习 0 次' : '已处理 0 篇',
      )
      props.library = replayOperation(props.library, operation!)
      await flush()
      await component.value!.reconcileRedo(operation!)
      await flush()
      const status = host.querySelector('[role=status]')!.textContent
      expect(status).toContain(kind === 'card' ? '已复习 1 次' : '已处理 1 篇')
      await component.value!.reconcileRedo(operation!)
      await flush()
      expect(host.querySelector('[role=status]')!.textContent).toBe(status)
      if (kind === 'card') expect(host.querySelector('[data-test=reading]')).not.toBeNull()
      else expect(host.querySelector('[data-test=reading]')).toBeNull()
    } finally {
      app.unmount()
      host.remove()
    }
  },
)
