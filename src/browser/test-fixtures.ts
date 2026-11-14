import type { SqlJsStatic } from 'sql.js'
import { recordStores } from '../core/storage'
import type { Library, MediaUpload } from '../core/model'
import { fixture } from '../core/test-fixtures'
import { createWorkspaceMarkdown } from '../workspace/markdown'
import { digest } from './workspace-files'

export function selectedFile(path: string, content: string | Uint8Array, name = '学习库') {
  const file = new File(
    [typeof content === 'string' ? content : Uint8Array.from(content).buffer],
    path.split('/').at(-1)!,
    { lastModified: 1 },
  )
  Object.defineProperty(file, 'webkitRelativePath', { value: `${name}/${path}` })
  return file
}
export async function workspaceFixture(
  SQL: SqlJsStatic,
  library: Library = fixture(),
  assets: MediaUpload[] = [],
) {
  const id = crypto.randomUUID(),
    db = new SQL.Database()
  db.run(
    'PRAGMA application_id=1380996185; PRAGMA user_version=10; CREATE TABLE workspace_identity(id); CREATE TABLE workspace(id,revision); CREATE TABLE publications(status); CREATE TABLE documents(kind,id,path,hash); CREATE TABLE assets(id,mime,path,size);',
  )
  db.run('INSERT INTO workspace_identity VALUES(?)', [id])
  db.run('INSERT INTO workspace VALUES(1,7)')
  const files: File[] = [
    selectedFile('workspace.json', JSON.stringify({ format: 'repeaty-workspace', version: 3, id })),
  ]
  for (const store of recordStores) {
    db.run(`CREATE TABLE ${store}(id TEXT PRIMARY KEY,position INTEGER,data TEXT)`)
    for (const [position, value] of library[store].entries())
      db.run(`INSERT INTO ${store} VALUES(?,?,?)`, [value.id, position, JSON.stringify(value)])
  }
  for (const asset of assets) {
    const bytes = new Uint8Array(await asset.blob.arrayBuffer())
    const path =
      (await digest(bytes)) +
      (asset.meta.type.startsWith('image/')
        ? '.png'
        : asset.meta.type.startsWith('audio/')
          ? '.wav'
          : '.md')
    files.push(selectedFile('.repeaty/media/' + path, bytes))
    db.run('INSERT INTO assets VALUES(?,?,?,?)', [
      asset.meta.id,
      asset.meta.type,
      path,
      bytes.length,
    ])
  }
  for (const kind of ['note', 'source'] as const) {
    for (const value of kind === 'note' ? library.notes : library.sources) {
      let raw: string
      if (kind === 'note') {
        const note = library.notes.find((note) => note.id === value.id)!
        raw = createWorkspaceMarkdown(
          JSON.parse(
            JSON.stringify({
              repeaty: {
                version: 1,
                kind: 'note',
                id: note.id,
                format: note.format,
                type: note.type,
                deckId: note.deckId,
                plugin: note.plugin,
              },
            }),
          ),
          { kind: 'note', front: note.front, back: note.back },
        )
      } else {
        const source = library.sources.find((source) => source.id === value.id)!
        raw = createWorkspaceMarkdown(
          { repeaty: { version: 1, kind: 'source', id: source.id, format: source.format } },
          {
            kind: 'source',
            body: await assets.find((asset) => asset.meta.id === source.mediaId)!.blob.text(),
          },
        )
      }
      const hash = await digest(new TextEncoder().encode(raw))
      files.push(selectedFile('.repeaty/objects/' + hash, raw))
      const path = `${kind === 'note' ? 'notes' : 'sources'}/${value.id.replaceAll(':', '-')}.md`
      files.push(selectedFile(path, raw))
      db.run('INSERT INTO documents VALUES(?,?,?,?)', [kind, value.id, path, hash])
    }
  }
  files.push(selectedFile('.repeaty/state.sqlite3', db.export()))
  return { id, library, files, db }
}
