import { z } from 'zod'
import { noteSchema, type NoteInput } from './model'
import type { SourceExcerpt } from './source-data'
import { sourceExcerpt } from './sources'
import { LearningQueryError, type LocalLearningSnapshot } from './learning-reader'

export const MAX_DRAFTS = 50
export const MAX_PROPOSALS = 32
export const proposalSchema = z
  .strictObject({
    selectionId: z.uuid(),
    requestId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    cards: z
      .array(
        z.strictObject({
          type: z.enum(['basic', 'reversed', 'cloze']),
          format: z.enum(['plain', 'markdown']).default('markdown'),
          front: z.string().trim().min(1).max(10_000),
          back: z.string().trim().max(10_000).default(''),
          tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
        }),
      )
      .min(1)
      .max(10),
  })
  .refine(
    (value) =>
      value.cards.reduce((sum, card) => sum + card.front.length + card.back.length, 0) <= 50_000,
  )

type SharedExcerpt = {
  selectionId: string
  scope: string
  mediaId: string
  deckId: string
  title: string
  format: 'plain' | 'markdown'
  excerpt: SourceExcerpt
}
export type CardDraft = SharedExcerpt & {
  id: string
  receivedAt: string
  input: Pick<NoteInput, 'type' | 'front' | 'back' | 'format' | 'tags'>
}
type Receipt = { requestId: string; draftIds: string[]; status: 'received' }
type Proposal = {
  selectionId: string
  fingerprint: string
  drafts: CardDraft[]
  receipt: Receipt
  committed: boolean
  waiting: number
}

/** Session memory only. Formal notes are saved separately by the editor's application operation. */
export class DraftSession {
  scope = ''
  selection: SharedExcerpt | undefined
  drafts: CardDraft[] = []
  private proposals = new Map<string, Proposal>()

  bindScope(scope: string) {
    if (scope === this.scope) return
    this.scope = scope
    this.revoke()
    this.drafts = []
  }
  revoke() {
    this.selection = undefined
    this.proposals.clear()
  }
  private context(context: LocalLearningSnapshot) {
    if (!this.scope || !this.scope.startsWith('local:') || context.scope !== this.scope)
      throw new LearningQueryError('library-unavailable')
  }
  valid(context: LocalLearningSnapshot, entry: SharedExcerpt) {
    return (
      context.scope === entry.scope &&
      context.scope === this.scope &&
      context.library.sources.some(
        (source) => source.id === entry.excerpt.sourceId && source.mediaId === entry.mediaId,
      ) &&
      context.library.decks.some((deck) => deck.id === entry.deckId)
    )
  }
  share(
    context: LocalLearningSnapshot,
    excerpt: SourceExcerpt,
    deckId: string,
    mediaId: string,
    text: string,
  ) {
    this.context(context)
    const source = context.library.sources.find((source) => source.id === excerpt.sourceId)
    if (
      !source ||
      source.mediaId !== mediaId ||
      !context.library.decks.some((deck) => deck.id === deckId)
    )
      throw new LearningQueryError('selection-unavailable')
    const verified = sourceExcerpt(source, text, excerpt.start, excerpt.end)
    if (verified.quote !== excerpt.quote) throw new LearningQueryError('selection-unavailable')
    this.revoke()
    this.selection = {
      selectionId: crypto.randomUUID(),
      scope: context.scope,
      mediaId,
      deckId,
      title: source.title,
      format: source.format,
      excerpt: verified,
    }
  }
  readSelection(context: LocalLearningSnapshot, args: Record<string, unknown>) {
    this.context(context)
    if (Object.keys(args).length) throw new LearningQueryError('invalid-arguments')
    const selection = this.requireSelection(context)
    return {
      selectionId: selection.selectionId,
      title: selection.title,
      format: selection.format,
      text: selection.excerpt.quote,
      deck: {
        id: selection.deckId,
        name: context.library.decks.find((deck) => deck.id === selection.deckId)!.name,
      },
    }
  }
  private requireSelection(context: LocalLearningSnapshot) {
    const selection = this.selection
    if (!selection || !this.valid(context, selection))
      throw new LearningQueryError('selection-unavailable')
    return selection
  }
  prepare(context: LocalLearningSnapshot, args: Record<string, unknown>, now = new Date()) {
    this.context(context)
    const selection = this.requireSelection(context)
    const parsed = proposalSchema.safeParse(args)
    if (!parsed.success) throw new LearningQueryError('invalid-arguments')
    const input = parsed.data
    if (input.selectionId !== selection.selectionId)
      throw new LearningQueryError('selection-unavailable')
    const cards = input.cards.map((card) => {
      const checked = noteSchema.safeParse({
        ...card,
        id: 'draft',
        deckId: selection.deckId,
        frontMedia: [],
        backMedia: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      if (!checked.success) throw new LearningQueryError('invalid-arguments')
      return {
        type: checked.data.type,
        format: checked.data.format,
        front: checked.data.front,
        back: checked.data.back,
        tags: checked.data.tags,
      }
    })
    const fingerprint = JSON.stringify(cards)
    let proposal = this.proposals.get(input.requestId)
    if (proposal && proposal.fingerprint !== fingerprint)
      throw new LearningQueryError('request-conflict')
    if (!proposal) {
      const reserved = [...this.proposals.values()]
        .filter((entry) => !entry.committed)
        .reduce((sum, entry) => sum + entry.drafts.length, 0)
      if (
        this.proposals.size >= MAX_PROPOSALS ||
        this.drafts.length + reserved + cards.length > MAX_DRAFTS
      )
        throw new LearningQueryError('draft-limit')
      const drafts = cards.map((card) => ({
        ...selection,
        id: crypto.randomUUID(),
        receivedAt: now.toISOString(),
        input: card,
      }))
      proposal = {
        selectionId: selection.selectionId,
        fingerprint,
        drafts,
        receipt: {
          requestId: input.requestId,
          draftIds: drafts.map((draft) => draft.id),
          status: 'received',
        },
        committed: false,
        waiting: 0,
      }
      this.proposals.set(input.requestId, proposal)
    }
    const staged = proposal
    staged.waiting++
    let finished = false
    return {
      receipt: structuredClone(staged.receipt),
      // Display drafts only after the native bridge accepted the response.
      finish: (accepted: boolean) => {
        if (finished) return
        finished = true
        staged.waiting--
        if (this.proposals.get(input.requestId) !== staged) return
        if (accepted && !staged.committed && this.selection?.selectionId === staged.selectionId) {
          this.drafts = [...this.drafts, ...staged.drafts]
          staged.committed = true
        }
        if (!staged.waiting && !staged.committed) this.proposals.delete(input.requestId)
      },
    }
  }
  getDraft(context: LocalLearningSnapshot, id: string) {
    this.context(context)
    const draft = this.drafts.find((entry) => entry.id === id)
    if (!draft || !this.valid(context, draft)) throw new LearningQueryError('selection-unavailable')
    return structuredClone(draft)
  }
  discard(id: string) {
    this.drafts = this.drafts.filter((entry) => entry.id !== id)
  }
}
