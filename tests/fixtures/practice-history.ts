import { fixture, now } from '../../src/core/test-fixtures'
import { saveNote, cardViews, librarySchema } from '../../src/core/model'
import type { Practice, Attempt } from '../../src/core/practice-data'

export function practiceHistoryFixture(count = 25) {
  const plugin = {
    id: 'leetcode',
    version: 1,
    data: {
      site: 'leetcode.cn',
      slug: 'first-problem',
      questionId: '1',
      frontendId: '1',
      title: 'First problem',
      difficulty: 'Easy',
      content: '<p>原始题面。</p><script>throw Error("unsafe")</script>',
      snippets: [{ lang: 'Python3', langSlug: 'python3', code: 'pass' }],
    },
  }
  let library = fixture({ type: 'plugin', plugin, front: 'First problem', back: '' })
  library = saveNote(
    library,
    {
      ...library.notes[0]!,
      front: 'Second problem',
      plugin: { ...plugin, data: { ...plugin.data, slug: 'second-problem', questionId: '2' } },
    },
    undefined,
    false,
    now,
  )
  const cards = cardViews(library)
  const practices: Practice[] = [],
    attempts: Attempt[] = []
  for (let index = 0; index < count; index++) {
    const card = cards[index % 2]!
    const date = new Date(now.getTime() + index * 1000).toISOString()
    practices.push({
      id: `practice-${index}`,
      cardId: card.id,
      contentRevision: 'snapshot',
      question: { front: card.front, back: card.back, format: card.format, plugin: card.plugin! },
      startedAt: date,
      completedAt: date,
      completion: 'practice',
    })
    const unknown = index % 3 === 2
    const accepted = index % 3 === 0
    attempts.push({
      id: `attempt-${index}`,
      practiceId: `practice-${index}`,
      submittedAt: date,
      updatedAt: date,
      language: 'python3',
      code: `# attempt ${index}\nprint("<script>stored text</script>")`,
      elapsedMs: 1000,
      status: unknown ? 'unknown' : 'completed',
      submissionId: unknown ? undefined : String(10_000 + index),
      result: unknown
        ? undefined
        : {
            outcome: accepted ? 'accepted' : 'rejected',
            status: accepted ? '通过' : '答案错误',
            runtime: '1 ms',
            memory: '10 MB',
            detail: '',
          },
    })
  }
  return librarySchema.parse({ ...library, practices, attempts })
}
