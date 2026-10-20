import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseNoteImport, importNotes } from './batch'
import { cardViews } from './model'
import { fixture } from './test-fixtures'

it('imports the distributed no-MCP skill example through the normal CSV parser, including cloze answers', () => {
  const csv = readFileSync(
    new URL('../../public/skills/repeaty-cards/example.csv', import.meta.url),
    'utf8',
  )
  const notes = parseNoteImport(csv, 'deck', ',')
  expect(notes.map((note) => note.type)).toEqual(['basic', 'cloze'])
  const library = importNotes(fixture(), notes, true)
  expect(library.notes).toHaveLength(3)
  expect(cardViews(library).find((card) => card.type === 'cloze')?.cloze?.answers).toEqual(['4'])
})
