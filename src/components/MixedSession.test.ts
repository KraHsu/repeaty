// @vitest-environment happy-dom
import { createApp, h, nextTick, shallowReactive, type App } from 'vue'
import { expect, it, vi } from 'vitest'
import MixedSession from './MixedSession.vue'
import { fixture, now } from '../core/test-fixtures'
import { addSource, prepareSource } from '../core/sources'
import { reviewCard } from '../core/scheduler'
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
