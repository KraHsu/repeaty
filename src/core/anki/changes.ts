import { LocalizedError, msg } from '../../i18n'
import { variants, type Library, type Note, type NoteInput } from '../model'
import { ankiNoteId, MAX_ANKI_NOTES, type AnkiNote, type AnkiPackage } from './types'

export type AnkiDifference =
  'type' | 'format' | 'front' | 'back' | 'tags' | 'frontMedia' | 'backMedia'
export interface AnkiRemovedCard {
  id: string
  variant: string
  reviews: number
  practices: number
  attempts: number
}
export interface AnkiChange {
  incoming: AnkiNote
  current?: Note
  status: 'new' | 'same' | 'changed' | 'unavailable'
  differences: AnkiDifference[]
  input: Omit<NoteInput, 'deckId'>
  added: string[]
  removed: AnkiRemovedCard[]
  retained: number
}
/** In-memory preview, bound to one immutable workspace view; never a backup record. */
export interface AnkiImportPlan {
  base: Library
  data: AnkiPackage
  changes: AnkiChange[]
}
export interface AnkiSelection {
  ids: string[]
  confirmCardChanges: boolean
}

const invalid = () => new LocalizedError(msg('Anki 文件损坏、格式不受支持或超过导入限制。'))
export const staleAnkiPreview = () => new LocalizedError(msg('学习库已变化，请重新比较后再导入。'))

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

/** Compare only imported identities. Blob reads are lazy, cached, and bounded per file. */
export async function compareAnkiImport(
  library: Library,
  data: AnkiPackage,
  getMedia: (id: string) => Promise<Blob | undefined>,
  signal?: AbortSignal,
): Promise<AnkiImportPlan> {
  signal?.throwIfAborted()
  if (data.notes.length > MAX_ANKI_NOTES) throw invalid()
  const notes = new Map(library.notes.map((note) => [note.id, note]))
  const media = new Map(library.media.map((entry) => [entry.id, entry]))
  const assets = new Map(data.assets.map((entry) => [entry.meta.id, entry]))
  if (assets.size !== data.assets.length || data.assets.some((asset) => media.has(asset.meta.id)))
    throw invalid()
  const cards = new Map<string, Library['cards']>()
  for (const card of library.cards) {
    const group = cards.get(card.noteId) ?? []
    group.push(card)
    cards.set(card.noteId, group)
  }
  const fingerprints = new Map<string, Promise<string>>()
  async function fingerprint(id: string, incoming: boolean): Promise<string> {
    const key = `${incoming ? 'file' : 'library'}:${id}`
    let cached = fingerprints.get(key)
    if (!cached) {
      cached = (async () => {
        signal?.throwIfAborted()
        const asset = incoming ? assets.get(id) : undefined
        const meta = incoming ? asset?.meta : media.get(id)
        if (!meta) throw invalid()
        const blob = incoming ? asset?.blob : await getMedia(id)
        signal?.throwIfAborted()
        if (!blob || blob.type !== meta.type || blob.size !== meta.size) throw invalid()
        const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
        signal?.throwIfAborted()
        return JSON.stringify([
          meta.name,
          meta.type,
          meta.size,
          [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
        ])
      })()
      fingerprints.set(key, cached)
    }
    return cached
  }
  const aliases = new Map<string, string>(),
    seen = new Set<string>(),
    changes: AnkiChange[] = []
  for (const incoming of data.notes) {
    signal?.throwIfAborted()
    if (incoming.id !== ankiNoteId(incoming.guid) || seen.has(incoming.id)) throw invalid()
    seen.add(incoming.id)
    const current = notes.get(incoming.id)
    const before = cards.get(incoming.id) ?? [],
      next = variants(incoming.input)
    const beforeKeys = new Set(before.map((card) => card.variant))
    const change: AnkiChange = {
      incoming,
      current,
      status: current ? 'same' : 'new',
      differences: [],
      input: incoming.input,
      added: next.filter((variant) => !beforeKeys.has(variant)),
      removed: before
        .filter((card) => !next.includes(card.variant))
        .map((card) => ({
          id: card.id,
          variant: card.variant,
          reviews: 0,
          practices: 0,
          attempts: 0,
        })),
      retained: before.filter((card) => next.includes(card.variant)).length,
    }
    if (current) {
      for (const field of ['type', 'format', 'front', 'back'] as const)
        if (
          current[field] !== (incoming.input[field] ?? (field === 'format' ? 'plain' : undefined))
        )
          change.differences.push(field)
      if (!sameStrings([...current.tags].sort(), [...incoming.input.tags].sort()))
        change.differences.push('tags')
      try {
        const existingKeys = new Map<string, string>()
        for (const id of new Set([...current.frontMedia, ...current.backMedia]))
          existingKeys.set(await fingerprint(id, false), id)
        for (const field of ['frontMedia', 'backMedia'] as const) {
          const oldKeys: string[] = [],
            newKeys: string[] = []
          for (const id of current[field]) oldKeys.push(await fingerprint(id, false))
          for (const id of incoming.input[field]) {
            const key = await fingerprint(id, true)
            newKeys.push(key)
            const existing = existingKeys.get(key)
            if (existing && !aliases.has(id)) aliases.set(id, existing)
          }
          if (!sameStrings(oldKeys, newKeys)) change.differences.push(field)
        }
        change.status = change.differences.length ? 'changed' : 'same'
      } catch (error) {
        signal?.throwIfAborted()
        change.status = 'unavailable'
        // An unavailable attachment is a comparison failure, never evidence that
        // two notes match. Other notes can still be imported independently.
        if (!(error instanceof Error)) throw error
      }
    }
    changes.push(change)
  }
  for (const change of changes)
    change.input = {
      ...change.incoming.input,
      frontMedia: change.incoming.input.frontMedia.map((id) => aliases.get(id) ?? id),
      backMedia: change.incoming.input.backMedia.map((id) => aliases.get(id) ?? id),
    }
  const removed = new Map(
    changes.flatMap((change) => change.removed).map((card) => [card.id, card]),
  )
  if (removed.size) {
    for (const review of library.reviews) {
      const card = removed.get(review.cardId)
      if (card) card.reviews++
    }
    const practices = new Map<string, AnkiRemovedCard>()
    for (const practice of library.practices) {
      const card = removed.get(practice.cardId)
      if (card) {
        card.practices++
        practices.set(practice.id, card)
      }
    }
    for (const attempt of library.attempts) {
      const card = practices.get(attempt.practiceId)
      if (card) card.attempts++
    }
  }
  signal?.throwIfAborted()
  return { base: library, data, changes }
}

export function ankiSelectionSummary(plan: AnkiImportPlan, ids: readonly string[]) {
  const selected = new Set(ids)
  const existingMedia = new Set(plan.base.media.map((meta) => meta.id))
  const changes = plan.changes.filter((entry) => selected.has(entry.incoming.id))
  return {
    addedNotes: changes.filter((entry) => entry.status === 'new').length,
    updatedNotes: changes.filter((entry) => entry.status === 'changed').length,
    addedCards: changes.reduce((count, entry) => count + entry.added.length, 0),
    removedCards: changes.flatMap((entry) => entry.removed),
    newMedia: new Set(
      changes
        .flatMap((entry) => [...entry.input.frontMedia, ...entry.input.backMedia])
        .filter((id) => !existingMedia.has(id)),
    ).size,
    cardChanges: changes.some(
      (entry) => entry.status === 'changed' && (entry.added.length || entry.removed.length),
    ),
  }
}
