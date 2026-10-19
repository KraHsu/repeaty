import type { Library, MediaUpload, NoteInput } from '../model'

export const MAX_APKG_BYTES = 256 * 1024 * 1024
export const MAX_ANKI_NOTES = 5000
export const MAX_ANKI_DATABASE_BYTES = 128 * 1024 * 1024
export const MAX_ANKI_EXPANDED_BYTES = 512 * 1024 * 1024

export interface AnkiNote {
  id: string
  sourceId: string
  guid: string
  model: string
  input: Omit<NoteInput, 'deckId'>
}
export type AnkiIssueReason =
  'template' | 'fields' | 'content' | 'variants' | 'media' | 'active-content' | 'external-media'
export interface AnkiIssue {
  noteId: string
  model: string
  reason: AnkiIssueReason
  skipped: boolean
}
export interface AnkiPackage {
  name: string
  format: 'legacy' | 'modern'
  totalNotes: number
  reviewCount: number
  notes: AnkiNote[]
  assets: MediaUpload[]
  issues: AnkiIssue[]
}

/** Anki's GUID survives exports, edits, and Repeaty backup restores. */
export function ankiNoteId(guid: string): string {
  const bytes = new TextEncoder().encode(guid)
  if (!bytes.length || bytes.length > 60) throw new Error('Invalid Anki GUID')
  return `anki:${btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')}`
}

export function ankiImportCounts(library: Library, data: AnkiPackage) {
  const existing = new Set(library.notes.map((note) => note.id))
  const notes = data.notes.filter((note) => !existing.has(note.id))
  return { notes, duplicates: data.notes.length - notes.length }
}
