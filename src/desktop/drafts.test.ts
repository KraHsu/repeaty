import { beforeEach, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import {
  bindDraftScope,
  draftSession,
  draftState,
  receiveDrafts,
  reloadDrafts,
  type DraftWorkspace,
} from './drafts'
import type { CardDraft } from '../core/card-draft-data'
import { fixture } from '../core/test-fixtures'
import { addSource, prepareSource, sourceExcerpt } from '../core/sources'
import { LearningQueryError } from '../core/learning-reader'

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (issue: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function workspace() {
  const scope = ref('local:example')
  const text = 'prefix\nselected text\nsuffix'
  const { source, asset } = prepareSource({
    title: 'Source',
    url: '',
    format: 'plain',
    content: text,
  })
  const library = shallowRef(addSource(fixture(), source, asset))
  let persisted: CardDraft[] = []
  const read = vi.fn(async () => persisted)
  const write = vi.fn(async (_scope: string, drafts: CardDraft[]) => {
    persisted = drafts
  })
  const api = {
    scope,
    library,
    ready: ref(true),
    busy: ref(false),
    readCardDrafts: read,
    addCardDrafts: write,
    localLearningSnapshot(expectedScope: string) {
      if (scope.value !== expectedScope || api.busy.value)
        throw new LearningQueryError('library-unavailable')
      return { scope: scope.value, revision: 1, library: library.value }
    },
  }
  return { api: api as unknown as DraftWorkspace, read, write, source, text }
}
beforeEach(() => {
  bindDraftScope(workspace().api, '')
})

it('ignores a late old load failure after leaving and reopening the same local scope', async () => {
  const { api, read } = workspace(),
    old = deferred<CardDraft[]>()
  read.mockReturnValueOnce(old.promise)
  bindDraftScope(api, api.scope.value)
  expect(draftState.loading).toBe(true)
  bindDraftScope(api, '')
  bindDraftScope(api, api.scope.value)
  await reloadDrafts(api)
  expect(draftState.ready).toBe(true)
  old.reject(new Error('old connection closed'))
  await Promise.allSettled([old.promise])
  expect(draftSession.scope).toBe(api.scope.value)
  expect(draftState.ready).toBe(true)
  expect(draftState.error).toBe('')
})

it('keeps a durable batch for review if sharing stops while its transaction is pending', async () => {
  const { api, write, source, text } = workspace()
  bindDraftScope(api, api.scope.value)
  await reloadDrafts(api)
  const context = api.localLearningSnapshot(api.scope.value)
  draftSession.share(context, sourceExcerpt(source, text, 7, 20), 'deck', source.mediaId, text)
  const waiting = deferred<void>()
  const original = write.getMockImplementation()!
  write.mockImplementationOnce(async (scope, drafts) => {
    await waiting.promise
    await original(scope, drafts)
  })
  const accepted = receiveDrafts(api, api.scope.value, {
    selectionId: draftSession.selection!.selectionId,
    requestId: 'pending',
    cards: [{ type: 'basic', front: 'Q', back: 'A' }],
  })
  draftSession.revoke()
  expect(draftSession.drafts).toHaveLength(0)
  waiting.resolve()
  const receipt = await accepted
  expect(draftSession.drafts.map((draft) => draft.id)).toEqual(receipt.draftIds)
  expect(draftSession.selection).toBeUndefined()
  expect(context.library.notes).toHaveLength(1)
  expect(() => draftSession.readSelection(context, {})).toThrow('selection-unavailable')
})
