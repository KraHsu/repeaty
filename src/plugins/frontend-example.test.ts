// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, reactive } from 'vue'
import Question from '../../examples/plugins/typed-answer/Question.vue'
import Answer from '../../examples/plugins/typed-answer/Answer.vue'
import plugin from '../../examples/plugins/typed-answer'
import { fixture } from '../core/test-fixtures'
import { cardViews } from '../core/model'
import type { QuestionProps } from './types'
import { validateInstallations } from '.'

afterEach(() => vi.unstubAllGlobals())
it('a frontend plugin renders, gates ratings, and shows escaped answers without a server', async () => {
  const fetch = vi.fn(() => {
    throw new Error('Unexpected network request')
  })
  vi.stubGlobal('fetch', fetch)
  expect(validateInstallations([{ plugin }])).toHaveLength(1)
  const props: QuestionProps = {
    card: cardViews(
      fixture({
        type: 'plugin',
        plugin: { id: plugin.id, version: 1, data: { answer: '<b>Vue</b>' } },
      }),
    )[0]!,
    media: [],
    getMedia: async () => undefined,
    state: reactive({ allowedGrades: [], busy: false }),
    revealed: false,
  }
  const question = document.createElement('div'),
    answer = document.createElement('div')
  const q = createApp(Question, { ...props }),
    a = createApp(Answer, { ...props })
  q.mount(question)
  a.mount(answer)
  try {
    const input = question.querySelector('input')!
    expect(props.state.allowedGrades).toEqual([1])
    input.value = ' <B>vue</B> '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(props.state.allowedGrades).toEqual([1, 2, 3, 4])
    expect(answer.textContent).toBe('<b>Vue</b>')
    expect(answer.querySelector('b')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    q.unmount()
    a.unmount()
  }
})
