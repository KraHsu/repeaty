import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { createRepository } from './storage'
import { createBrowserRepository } from '../browser/repository'
import { emptyLibrary } from './model'
import { fixture } from './test-fixtures'
import { noteLifecycle } from '../desktop/retirement'
import {
  createWorkspaceMarkdown,
  readWorkspaceMarkdown,
  workspaceBytes,
} from '../workspace/markdown'
import { sha256 } from '../workspace/source-revisions'
import { prepareBackupRestore } from './backup-restore'

it.each(['indexeddb', 'readonly-copy'] as const)(
  '%s keeps edited note metadata and raw Markdown consistent when another region retires',
  async (kind) => {
    const original = emptyLibrary(),
      repo =
        kind === 'indexeddb'
          ? createRepository(`retired-raw-${crypto.randomUUID()}`)
          : createBrowserRepository({
              snapshot: { id: 'original', name: 'Read-only', revision: 0, library: original },
              media: async () => undefined,
              attempts: async () => [],
              close: () => {},
            })
    try {
      const library = fixture({
          type: 'plugin',
          plugin: { id: 'visual-occlusion', version: 1, data: {}, variants: ['a', 'b', 'c'] },
        }),
        note = library.notes[0]!
      let saved = await repo.save(library, 0)
      const retiredA = noteLifecycle(
        saved.library,
        {
          ...note,
          plugin: { ...note.plugin!, variants: ['b', 'c'] },
        },
        note.id,
        undefined,
        true,
      ).library
      saved = await repo.save(retiredA, saved.revision)
      const retired = await repo.retiredNotes()
      const raw = createWorkspaceMarkdown(
        {
          custom: { kept: true },
          repeaty: {
            version: 1,
            kind: 'note',
            id: note.id,
            deckId: note.deckId,
            type: note.type,
            format: note.format,
            plugin: note.plugin!,
          },
        },
        { kind: 'note', front: note.front, back: note.back },
      )
      retired[0]!.document = {
        id: note.id,
        kind: 'note',
        path: 'notes/retained-name.md',
        raw,
        hash: await sha256(workspaceBytes(raw)),
      }
      // Simulate importing a native snapshot, whose raw document is retained alongside its note.
      saved = await repo.save(saved.library, saved.revision, { retired })
      const edited = { ...saved.library.notes[0]!, front: 'Edited question', tags: ['new-tag'] }
      saved = await repo.save({ ...saved.library, notes: [edited] }, saved.revision)
      const retiredB = noteLifecycle(
        saved.library,
        {
          ...edited,
          plugin: { ...edited.plugin!, variants: ['c'] },
        },
        note.id,
        await repo.retiredNote(note.id),
        true,
      ).library
      saved = await repo.save(retiredB, saved.revision)
      const archived = (await repo.retiredNotes())[0]!
      expect(archived.cards.map((card) => card.variant).sort()).toEqual(['plugin:a', 'plugin:b'])
      expect(archived.note!.front).toBe('Edited question')
      const restored = await prepareBackupRestore({
        library: saved.library,
        retired: [archived],
        assets: [],
      })
      const document = restored.retired![0]!.document!
      const parsed = readWorkspaceMarkdown(document.raw)
      expect(parsed.status).toBe('managed')
      if (parsed.status !== 'managed') throw new Error('invalid retired document')
      expect(parsed.document.content).toEqual({
        kind: 'note',
        front: 'Edited question',
        back: note.back,
      })
      expect(parsed.document.properties.tags).toEqual(['new-tag'])
      expect(parsed.document.properties.custom).toEqual({ kept: true })
      expect(parsed.document.header.plugin).toEqual(edited.plugin)
      expect(document.hash).toBe(await sha256(workspaceBytes(document.raw)))
      expect(document.path).toBe('notes/retained-name.md')
      expect(original).toEqual(emptyLibrary())
    } finally {
      await repo.close()
    }
  },
)
