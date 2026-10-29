import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { fixture, now, input } from '../core/test-fixtures'
import { saveNote } from '../core/model'
import { reviewCard } from '../core/scheduler'
import { prepareMedia } from '../core/media'
import { prepareSource, addSource, removeSource } from '../core/sources'
import { operationFor, revertOperation } from '../core/operations'
import { operationHistory } from '../core/operation-history'
import { createBrowserRepository } from './repository'
import { practiceHistoryFixture } from '../../tests/fixtures/practice-history'
import { BrowserWorkspaceReader } from './workspace-reader'
import { selectedFile, workspaceFixture } from './test-fixtures'
import { collectWorkspaceFiles } from './workspace-files'
import { materialFixture } from '../../tests/fixtures/material-model'

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs()
})
async function open(env: Awaited<ReturnType<typeof workspaceFixture>>) {
  return BrowserWorkspaceReader.open(SQL, { kind: 'files', files: env.files })
}
function rewrite(env: Awaited<ReturnType<typeof workspaceFixture>>) {
  env.files = env.files.filter((file) => !file.webkitRelativePath.endsWith('/state.sqlite3'))
  env.files.push(selectedFile('.repeaty/state.sqlite3', env.db.export()))
}
describe('browser workspace SQLite snapshots', () => {
  it('reads DB 12 journals and restores retained source originals only in the trial copy', async () => {
    const prepared = prepareSource(
      { title: 'Deleted source', url: '', format: 'plain', content: 'immutable original' },
      now,
    )
    const before = addSource(fixture(), prepared.source, prepared.asset)
    const after = removeSource(before, prepared.source.id)
    const entry = operationFor(before, after, 'local:workspace:original', '删除材料')!
    const history = operationHistory([entry])
    const env = await workspaceFixture(SQL, after, [prepared.asset])
    env.db.run(
      'PRAGMA user_version=12; CREATE TABLE operation_history(id INTEGER PRIMARY KEY,data TEXT);',
    )
    env.db.run('INSERT INTO operation_history VALUES(1,?)', [JSON.stringify(history)])
    rewrite(env)
    const originalFiles = await Promise.all(env.files.map((file) => file.arrayBuffer()))
    const reader = await open(env)
    expect(reader.snapshot.operationHistory).toEqual(history)
    const trial = createBrowserRepository({
      snapshot: reader.snapshot,
      media: (id) => reader.media(id),
      attempts: async (ids) => reader.attempts(ids),
      close: () => reader.close(),
    })
    const current = await trial.load()
    const restored = await trial.save(revertOperation(current.library, entry), current.revision, {
      operationHistory: operationHistory([], [entry]),
    })
    expect(restored.library.sources).toEqual(before.sources)
    expect(await (await trial.getMedia(prepared.source.mediaId))!.text()).toBe('immutable original')
    expect(restored.operationHistory!.redo[0]!.id).toBe(entry.id)
    await trial.close()
    expect(await Promise.all(env.files.map((file) => file.arrayBuffer()))).toEqual(originalFiles)
    env.db.run('DROP TABLE operation_history')
    rewrite(env)
    await expect(open(env)).rejects.toThrow()
    env.db.close()
  })
  it('reads DB 10 without a material store and DB 11 originals without changing either directory', async () => {
    const old = await workspaceFixture(SQL)
    old.db.run('DROP TABLE materialReceipts')
    rewrite(old)
    const oldReader = await open(old)
    expect(oldReader.snapshot.library.materialReceipts).toEqual([])
    oldReader.close()
    old.db.close()
    const material = materialFixture()
    const env = await workspaceFixture(SQL, material.library, material.assets)
    env.db.run('PRAGMA user_version=11')
    rewrite(env)
    const reader = await open(env)
    expect(reader.snapshot.library).toEqual(material.library)
    expect(await (await reader.media(material.original.meta.id))!.text()).toBe(
      await material.original.blob.text(),
    )
    reader.close()
    env.db.run('DROP TABLE materialReceipts')
    rewrite(env)
    await expect(open(env)).rejects.toThrow()
    env.db.close()
  })
  it('reads accepted records, grading and Unicode filenames while ignoring pending Markdown', async () => {
    let library = fixture({ front: '**已接受：** 内容' })
    library = reviewCard(library, library.cards[0]!.id, 3, now)
    const env = await workspaceFixture(SQL, library)
    env.files = env.files.map((file) =>
      file.webkitRelativePath.includes('/notes/')
        ? selectedFile('notes/unaccepted.md', '正在外部编辑，不是当前题面')
        : file,
    )
    const before = await Promise.all(
      env.files.map(async (file) => new Uint8Array(await file.arrayBuffer())),
    )
    const reader = await open(env)
    expect(reader.snapshot.id).toBe(env.id)
    expect(reader.snapshot.library).toEqual(library)
    expect(reader.snapshot.revision).toBe(7)
    reader.close()
    expect(
      await Promise.all(env.files.map(async (file) => new Uint8Array(await file.arrayBuffer()))),
    ).toEqual(before)
    env.db.close()
  })
  it('keeps 257 complete code submissions in SQLite and returns requested bodies only', async () => {
    const full = practiceHistoryFixture(257)
    full.attempts[0]!.code = '完整代码\n'.repeat(5000)
    const env = await workspaceFixture(SQL, full),
      reader = await open(env)
    expect(reader.snapshot.library.attempts).toHaveLength(257)
    expect(
      reader.snapshot.library.attempts.every(
        (row) => row.code === undefined && row.result?.detail === undefined,
      ),
    ).toBe(true)
    expect(reader.attempts([full.attempts[0]!.id, full.attempts[256]!.id])).toEqual([
      full.attempts[0],
      full.attempts[256],
    ])
    expect(() => reader.attempts(Array(129).fill(full.attempts[0]!.id))).toThrow()
    reader.close()
    env.db.close()
  })
  it('reads a long source and image/audio lazily from immutable media, not working assets', async () => {
    const image = prepareMedia(new File(['image-bytes'], '图.png', { type: 'image/png' }))
    const audio = prepareMedia(
      new File([new Uint8Array(8 * 1024 * 1024)], '长音频.wav', { type: 'audio/wav' }),
    )
    let library = fixture({ frontMedia: [image.meta.id], backMedia: [audio.meta.id] })
    library.media = [image.meta, audio.meta]
    const text = '# 标题\n\n长文本与公式 $x^2$。\n'.repeat(8000)
    const prepared = prepareSource({ title: '长材料', content: text, format: 'markdown', url: '' })
    library = addSource(library, prepared.source, prepared.asset)
    const env = await workspaceFixture(SQL, library, [image, audio, prepared.asset])
    const reads = new Map<string, number>()
    for (const file of env.files) {
      const original = file.arrayBuffer.bind(file)
      Object.defineProperty(file, 'arrayBuffer', {
        value: () => {
          reads.set(file.name, (reads.get(file.name) ?? 0) + 1)
          return original()
        },
      })
    }
    const reader = await open(env)
    for (const file of env.files.filter((file) => file.webkitRelativePath.includes('/media/')))
      expect(reads.get(file.name) ?? 0).toBe(0)
    expect(await (await reader.media(prepared.asset.meta.id))!.text()).toBe(text)
    expect(await (await reader.media(image.meta.id))!.text()).toBe('image-bytes')
    expect((await reader.media(audio.meta.id))!.size).toBe(8 * 1024 * 1024)
    reader.close()
    env.db.close()
  })
  it('reads a thousand cards without reducing the library to sample data', async () => {
    let library = fixture()
    for (let i = 1; i < 1000; i++)
      library = saveNote(library, { ...input, front: `第 ${i} 题` }, undefined, false, now)
    const env = await workspaceFixture(SQL, library),
      reader = await open(env)
    expect(reader.snapshot.library.cards).toHaveLength(1000)
    expect(reader.snapshot.library.notes.at(-1)!.front).toBe('第 999 题')
    reader.close()
    env.db.close()
  }, 30_000)
  it('rejects missing hidden files, active WAL and a rollback journal', async () => {
    const env = await workspaceFixture(SQL)
    await expect(
      BrowserWorkspaceReader.open(SQL, {
        kind: 'files',
        files: env.files.filter((file) => !file.webkitRelativePath.includes('/.repeaty/')),
      }),
    ).rejects.toMatchObject({ code: 'missing' })
    for (const suffix of ['-wal', '-journal']) {
      await expect(
        BrowserWorkspaceReader.open(SQL, {
          kind: 'files',
          files: [...env.files, selectedFile('.repeaty/state.sqlite3' + suffix, 'pending')],
        }),
      ).rejects.toMatchObject({ code: 'incomplete' })
    }
    env.db.close()
  })
  it('rejects unfinished publications and incompatible identities without recovering them', async () => {
    const env = await workspaceFixture(SQL)
    env.db.run("INSERT INTO publications VALUES('pending')")
    rewrite(env)
    await expect(open(env)).rejects.toMatchObject({ code: 'incomplete' })
    env.db.run('DELETE FROM publications; PRAGMA user_version=99;')
    rewrite(env)
    await expect(open(env)).rejects.toMatchObject({ code: 'incompatible' })
    env.db.close()
  })
  it('allows superseded publications and rejects damaged records or content objects', async () => {
    const env = await workspaceFixture(SQL)
    env.db.run("INSERT INTO publications VALUES('superseded')")
    rewrite(env)
    const reader = await open(env)
    reader.close()
    env.db.run("UPDATE cards SET data=json_set(data,'$.noteId','missing')")
    rewrite(env)
    await expect(open(env)).rejects.toThrow()
    const clean = await workspaceFixture(SQL)
    clean.files = clean.files.map((file) =>
      file.webkitRelativePath.includes('/objects/')
        ? selectedFile(file.webkitRelativePath.split('/').slice(1).join('/'), 'corrupted')
        : file,
    )
    await expect(open(clean)).rejects.toMatchObject({ code: 'invalid' })
    env.db.close()
    clean.db.close()
  })
  it('detects a changed database between initial read and final verification', async () => {
    const env = await workspaceFixture(SQL)
    const dbFile = env.files.find((file) => file.name === 'state.sqlite3')!
    let count = 0
    const original = dbFile.arrayBuffer.bind(dbFile)
    Object.defineProperty(dbFile, 'arrayBuffer', {
      value: async () => {
        const bytes = new Uint8Array(await original())
        if (++count > 1) bytes[100] = bytes[100]! ^ 1
        return bytes.buffer
      },
    })
    await expect(open(env)).rejects.toMatchObject({ code: 'changed' })
    env.db.close()
  })
  it('rejects traversal and duplicate selected paths', async () => {
    const env = await workspaceFixture(SQL)
    await expect(
      collectWorkspaceFiles({ kind: 'files', files: [...env.files, env.files[0]!] }),
    ).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      collectWorkspaceFiles({
        kind: 'files',
        files: [...env.files, selectedFile('../escape', 'x')],
      }),
    ).rejects.toMatchObject({ code: 'invalid' })
    env.db.close()
  })
})
