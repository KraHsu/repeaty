import type { CardView, Library } from './model'
import type { Source } from './source-data'
import { studySettings } from './study-settings'

type ResolvedPriority = {
  value: number
  inherited: boolean
  from: string
  kind: 'source' | 'folder' | 'note' | 'deck' | 'default'
  numeric: boolean
}
const legacy = { high: 1, normal: 5, low: 9 }
export function sourcePriorityGroup(value: number) {
  return value <= 3 ? 'high' : value <= 6 ? 'normal' : 'low'
}

export function createPriorityResolver(library: Library) {
  const sources = new Map(library.sources.map((source) => [source.id, source]))
  const folders = new Map(library.materialFolders.map((folder) => [folder.id, folder]))
  const notes = new Map(library.notes.map((note) => [note.id, note]))
  const decks = new Map(library.decks.map((deck) => [deck.id, deck]))
  const fallback = (): ResolvedPriority => ({
    value: studySettings(library).defaultPriority,
    inherited: true,
    from: 'study',
    kind: 'default',
    numeric: false,
  })
  function sourcePriority(source: Source): ResolvedPriority {
    const seen = new Set<string>()
    let current: Source | undefined = source
    let folderId: string | undefined
    while (current && !seen.has(current.id) && seen.size <= 32) {
      seen.add(current.id)
      const value =
        current.studyPriority ?? (current.priority ? legacy[current.priority] : undefined)
      if (value !== undefined)
        return {
          value,
          inherited: current.id !== source.id,
          from: current.id,
          kind: 'source',
          numeric: current.studyPriority !== undefined,
        }
      // The actual organization wins over immutable provenance after a move.
      if (current.folderId) {
        folderId = current.folderId
        break
      }
      current = sources.get(current.parentSourceId ?? current.origin?.sourceId ?? '')
    }
    const folderSeen = new Set<string>()
    while (folderId && !folderSeen.has(folderId) && folderSeen.size <= 32) {
      folderSeen.add(folderId)
      const folder = folders.get(folderId)
      if (!folder) break
      if (folder.studyPriority !== undefined)
        return {
          value: folder.studyPriority,
          inherited: true,
          from: folder.id,
          kind: 'folder',
          numeric: true,
        }
      folderId = folder.parentId
    }
    return fallback()
  }
  function cardPriority(card: Pick<CardView, 'noteId' | 'deckId'>): ResolvedPriority {
    const note = notes.get(card.noteId)
    if (note?.studyPriority !== undefined)
      return {
        value: note.studyPriority,
        inherited: false,
        from: note.id,
        kind: 'note',
        numeric: true,
      }
    const source = sources.get(note?.excerpt?.sourceId ?? '')
    if (source) {
      const value = sourcePriority(source)
      if (value.kind !== 'default') return { ...value, inherited: true }
    }
    const deck = decks.get(card.deckId)
    return deck?.studyPriority !== undefined
      ? { value: deck.studyPriority, inherited: true, from: deck.id, kind: 'deck', numeric: true }
      : fallback()
  }
  return { source: sourcePriority, card: cardPriority }
}
export function effectiveSourcePriority(source: Source, library: Library) {
  return createPriorityResolver(library).source(source)
}
export function effectiveCardPriority(card: Pick<CardView, 'noteId' | 'deckId'>, library: Library) {
  return createPriorityResolver(library).card(card)
}

export function priorityWeight(priority: number, ratio = 5) {
  if (
    !Number.isInteger(priority) ||
    priority < 1 ||
    priority > 9 ||
    !Number.isFinite(ratio) ||
    ratio < 1 ||
    ratio > 100
  )
    throw new RangeError('学习优先级或权重无效。')
  return (10 - priority) ** (Math.log(ratio) / Math.log(9))
}
function seededRandom(seed: string) {
  let state = 2166136261
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619)
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
/** Stable weighted buckets preserve within-priority due order and never reroll on a render. */
export function weightedPriorityOrder<T>(
  entries: readonly T[],
  priority: (entry: T) => number,
  ratio: number,
  seed: string,
): T[] {
  const buckets = Array.from({ length: 10 }, () => [] as T[])
  for (const entry of entries) {
    const value = priority(entry)
    if (!Number.isInteger(value) || value < 0 || value > 9)
      throw new RangeError('学习优先级需为 0–9。')
    buckets[value]!.push(entry)
  }
  const result = [...buckets[0]!]
  const offsets = Array(10).fill(0) as number[]
  const random = seededRandom(seed)
  const weights = Array.from({ length: 10 }, (_, index) =>
    index ? priorityWeight(index, ratio) : 0,
  )
  while (result.length < entries.length) {
    let remaining = 0
    for (let index = 1; index <= 9; index++)
      if (offsets[index]! < buckets[index]!.length) remaining += weights[index]!
    let pick = random() * remaining
    for (let index = 1; index <= 9; index++) {
      if (offsets[index]! >= buckets[index]!.length) continue
      pick -= weights[index]!
      if (pick < 0) {
        result.push(buckets[index]![offsets[index]!]!)
        offsets[index] = offsets[index]! + 1
        break
      }
    }
  }
  return result
}
