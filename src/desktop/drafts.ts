import { shallowReactive } from 'vue'
import { DraftSession } from '../core/draft-proposals'
import { LearningQueryError } from '../core/learning-reader'
import { cardDraftSchema, type CardDraft } from '../core/card-draft-data'
import type { NoteInput, MediaUpload } from '../core/model'
import { msg, LocalizedError, type DisplayMessage } from '../i18n'
import type { useLibrary } from '../composables/useLibrary'

export type DraftWorkspace = ReturnType<typeof useLibrary>
export const draftSession = shallowReactive(new DraftSession())
export const draftState = shallowReactive({
  ready: false,
  loading: false,
  error: '' as DisplayMessage,
})
let epoch = 0
let loadSequence = 0

export function bindDraftScope(workspace: DraftWorkspace, scope: string) {
  if (scope !== draftSession.scope) {
    epoch++
    draftSession.bindScope(scope)
    draftState.ready = false
    draftState.loading = false
    draftState.error = ''
  }
  if (
    scope &&
    workspace.ready.value &&
    !workspace.busy.value &&
    !draftState.ready &&
    !draftState.loading &&
    !draftState.error
  )
    void reloadDrafts(workspace)
}

export async function reloadDrafts(workspace: DraftWorkspace) {
  const scope = draftSession.scope,
    generation = epoch,
    sequence = ++loadSequence
  if (!scope) return
  draftState.loading = true
  draftState.error = ''
  try {
    const drafts = await workspace.readCardDrafts(scope)
    if (generation !== epoch || sequence !== loadSequence) return
    if (drafts.some((draft) => draft.scope !== scope)) throw new Error('draft-scope')
    draftSession.restore(scope, drafts)
    draftState.ready = true
  } catch {
    if (generation === epoch && sequence === loadSequence) {
      draftState.ready = false
      draftState.error = '无法读取制卡草稿，已有草稿未被覆盖。请重试或重新打开应用。'
    }
  } finally {
    if (generation === epoch && sequence === loadSequence) draftState.loading = false
  }
}

function requireReady(workspace: DraftWorkspace, scope: string) {
  const context = workspace.localLearningSnapshot(scope)
  if (!draftState.ready || draftSession.scope !== scope)
    throw new LearningQueryError('library-unavailable')
  return context
}

function storageError(issue: unknown) {
  return issue instanceof DOMException && issue.name === 'QuotaExceededError'
    ? new LocalizedError(msg('存储空间不足，草稿未保存。请释放空间后重试。'))
    : issue instanceof LocalizedError
      ? issue
      : new LocalizedError(msg('无法保存制卡草稿，请重试。'))
}

/** A successful receipt means the batch is durable, even when the response is lost. */
export async function receiveDrafts(
  workspace: DraftWorkspace,
  scope: string,
  args: Record<string, unknown>,
) {
  const generation = epoch
  const proposal = draftSession.prepare(requireReady(workspace, scope), args)
  try {
    await workspace.addCardDrafts(scope, proposal.drafts)
    proposal.finish(true, false)
    if (generation === epoch && draftSession.scope === scope) await reloadDrafts(workspace)
    return proposal.receipt
  } catch (issue) {
    proposal.finish(false)
    if (generation === epoch && draftSession.scope === scope) draftState.error = storageError(issue)
    throw new LearningQueryError('library-unavailable')
  }
}

export async function saveDraftEdits(
  workspace: DraftWorkspace,
  id: string,
  input: NoteInput,
  uploads: MediaUpload[],
) {
  const scope = draftSession.scope,
    generation = epoch
  const draft = draftSession.getDraft(requireReady(workspace, scope), id)
  const ids = [...input.frontMedia, ...input.backMedia]
  const next = cardDraftSchema.parse({
    ...draft,
    deckId: input.deckId,
    updatedAt: new Date().toISOString(),
    input: {
      type: input.type,
      format: input.format ?? 'markdown',
      front: input.front,
      back: input.back,
      tags: input.tags,
      frontMedia: input.frontMedia,
      backMedia: input.backMedia,
    },
    uploads: uploads.filter((asset) => ids.includes(asset.meta.id)),
  })
  try {
    await workspace.updateCardDraft(scope, next)
    if (generation === epoch && draftSession.scope === scope) replaceDraft(next)
  } catch (issue) {
    throw storageError(issue)
  }
}

function replaceDraft(draft: CardDraft) {
  draftSession.drafts = draftSession.drafts.map((entry) => (entry.id === draft.id ? draft : entry))
}

export async function discardDraft(workspace: DraftWorkspace, id: string) {
  const scope = draftSession.scope,
    generation = epoch
  requireReady(workspace, scope)
  try {
    await workspace.discardCardDraft(scope, id)
    if (generation === epoch && draftSession.scope === scope) draftSession.discard(id)
  } catch (issue) {
    throw storageError(issue)
  }
}
