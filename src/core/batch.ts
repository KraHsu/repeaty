import { noteSchema, saveNote, type Library, type NoteInput } from './model'

export function parseTable(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = []
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false
  text = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        quoted = false
        closed = true
      } else cell += ch
    } else if (ch === delimiter || ch === '\n') {
      row.push(cell)
      cell = ''
      closed = false
      if (ch === '\n') {
        if (row.some((field) => field.trim())) rows.push(row)
        row = []
      }
    } else if (ch === '"') {
      if (cell || closed) throw new Error('引号格式不正确：请用双引号包围整个字段。')
      quoted = true
    } else {
      if (closed) throw new Error('结束引号后只能接分隔符或换行。')
      cell += ch
    }
    if (rows.length > 5001) throw new Error('每次最多导入 5000 条笔记。')
  }
  if (quoted) throw new Error('文件存在未闭合的引号。')
  row.push(cell)
  if (row.some((field) => field.trim())) rows.push(row)
  return rows
}
export function parseNoteImport(text: string, deckId: string, delimiter: ',' | '\t'): NoteInput[] {
  if (text.length > 2 * 1024 * 1024) throw new Error('导入文本不能超过 2 MB。')
  const rows = parseTable(text, delimiter)
  const header = rows.shift()?.map((field) => field.trim().toLowerCase()) ?? []
  if (
    !header.includes('front') ||
    !header.includes('back') ||
    new Set(header).size !== header.length ||
    header.some((field) => !['front', 'back', 'type', 'tags', 'format'].includes(field))
  )
    throw new Error('表头须包含 front、back，可选 type、tags、format；请使用示例格式。')
  if (!rows.length || rows.length > 5000) throw new Error('文件须包含 1–5000 条笔记。')
  return rows.map((row, index) => {
    if (row.length !== header.length) throw new Error(`第 ${index + 2} 行的列数与表头不一致。`)
    const data = Object.fromEntries(header.map((key, i) => [key, row[i]!.trim()]))
    const note = noteSchema.safeParse({
      ...data,
      type: data.type || 'basic',
      format: data.format || 'plain',
      tags: [
        ...new Set(
          (data.tags || '')
            .split('|')
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      ],
      deckId,
      frontMedia: [],
      backMedia: [],
      id: 'preview',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    if (!note.success)
      throw new Error(`第 ${index + 2} 行：${note.error.issues[0]?.message ?? '内容格式不正确'}`)
    return note.data
  })
}
export function noteKey(
  note: Pick<NoteInput, 'type' | 'front' | 'back' | 'deckId' | 'format'>,
): string {
  return JSON.stringify([note.deckId, note.type, note.front, note.back, note.format ?? 'plain'])
}
export function importNotes(
  library: Library,
  inputs: NoteInput[],
  skipDuplicates: boolean,
  now = new Date(),
): Library {
  let next = library
  const existing = new Set(library.notes.map(noteKey))
  for (const input of inputs) {
    const key = noteKey(input)
    if (skipDuplicates && existing.has(key)) continue
    next = saveNote(next, input, undefined, false, now)
    existing.add(key)
  }
  return next
}
export interface BatchEdit {
  deckId?: string
  addTags: string[]
  removeTags: string[]
}
export function editNotes(
  library: Library,
  ids: Set<string>,
  edit: BatchEdit,
  now = new Date(),
): Library {
  if (edit.deckId && !library.decks.some((deck) => deck.id === edit.deckId))
    throw new Error('目标卡组不存在。')
  return {
    ...library,
    notes: library.notes.map((note) =>
      ids.has(note.id)
        ? noteSchema.parse({
            ...note,
            deckId: edit.deckId || note.deckId,
            tags: [
              ...new Set([
                ...note.tags.filter((tag) => !edit.removeTags.includes(tag)),
                ...edit.addTags,
              ]),
            ],
            updatedAt: now.toISOString(),
          })
        : note,
    ),
  }
}
