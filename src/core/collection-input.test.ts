import { describe, expect, it, vi } from 'vitest'
import {
  collectSelectedFiles,
  collectDroppedEntries,
  collectDataTransfer,
  detectCollectionFormats,
  inspectCollectionPath,
  readCollectionClipboard,
  type CollectionEntry,
  type CollectionLimits,
} from './collection-input'

const file = (path: string, body = '材料') => {
  const result = new File([body], path.split('/').at(-1)!, { type: 'text/plain' })
  Object.defineProperty(result, 'webkitRelativePath', { value: path })
  return result
}
const leaf = (path: string, body = '材料'): CollectionEntry => ({
  name: path,
  isFile: true,
  isDirectory: false,
  file: (done) => done(file(path, body)),
})
const directory = (name: string, batches: CollectionEntry[][]): CollectionEntry => ({
  name,
  isFile: false,
  isDirectory: true,
  createReader: () => {
    let page = 0
    return { readEntries: (done) => done(batches[page++] ?? []) }
  },
})
const limits: CollectionLimits = { files: 20, entries: 30, bytes: 1000, depth: 4 }

describe('collection input', () => {
  it('filters unsafe, private and temporary paths without normalizing away traversal', () => {
    for (const path of ['/note.md', '../note.md', 'a/../b.md', 'C:/note.md', 'a\\b.md', 'a//b.md'])
      expect(inspectCollectionPath(path)).toEqual({ reason: 'unsafe-path' })
    for (const path of ['.git/config', 'vault/.obsidian/token', 'vault/node_modules/a.md'])
      expect(inspectCollectionPath(path)).toEqual({ reason: 'private' })
    for (const path of ['vault/~$note.md', 'vault/note.md.swp', 'note.tmp'])
      expect(inspectCollectionPath(path)).toEqual({ reason: 'temporary' })
    expect(inspectCollectionPath('材料/中文 😊.md')).toEqual({ path: '材料/中文 😊.md' })
  })

  it('does not read bodies during selection, and reports path collisions instead of overwriting', () => {
    const original = file('vault/note.md')
    const read = vi.spyOn(original, 'arrayBuffer')
    const result = collectSelectedFiles([original, file('vault/note.md', 'different')])
    expect(read).not.toHaveBeenCalled()
    expect(result.files).toEqual([{ file: original, path: 'vault/note.md' }])
    expect(result.issues).toEqual([{ path: 'vault/note.md', reason: 'duplicate-path' }])
  })

  it('reads every paginated directory batch and preserves relative hierarchy', async () => {
    const result = await collectDroppedEntries([
      directory('vault', [[leaf('a.md')], [directory('nested', [[leaf('b.txt')]])]]),
    ])
    expect(result.files.map((entry) => entry.path)).toEqual(['vault/a.md', 'vault/nested/b.txt'])
    expect(result.issues).toEqual([])
  })

  it('never opens ignored directory contents', async () => {
    const ignored = directory('.obsidian', [[leaf('secrets.txt')]])
    const read = vi.spyOn(ignored, 'createReader')
    const result = await collectDroppedEntries([directory('vault', [[ignored, leaf('note.md')]])])
    expect(read).not.toHaveBeenCalled()
    expect(result.issues).toEqual([{ path: 'vault/.obsidian', reason: 'private' }])
    expect(result.files.map((entry) => entry.path)).toEqual(['vault/note.md'])
  })

  it('reports unreadable files and continues through independent siblings', async () => {
    const denied = leaf('denied.md')
    denied.file = (_, fail) => fail(new DOMException('denied', 'NotAllowedError'))
    const result = await collectDroppedEntries([directory('vault', [[denied, leaf('ok.md')]])])
    expect(result.files.map((entry) => entry.path)).toEqual(['vault/ok.md'])
    expect(result.issues).toEqual([{ path: 'vault/denied.md', reason: 'unreadable' }])
  })

  it('bounds recursive traversal, file count and bytes with explicit skipped reasons', async () => {
    const tooDeep = directory('a', [[directory('b', [[directory('c', [[leaf('d.md')]])]])]])
    const deep = await collectDroppedEntries([tooDeep], { limits: { ...limits, depth: 3 } })
    expect(deep.issues).toEqual([{ path: 'a/b/c/d.md', reason: 'limit' }])
    const count = collectSelectedFiles([file('a.md'), file('b.md')], {
      limits: { ...limits, files: 1 },
    })
    expect(count.files).toHaveLength(1)
    expect(count.issues).toEqual([{ path: 'b.md', reason: 'limit' }])
    const size = collectSelectedFiles([file('big.md', 'a'.repeat(11)), file('small.md', 'b')], {
      limits: { ...limits, bytes: 10 },
    })
    expect(size.files.map((entry) => entry.path)).toEqual(['small.md'])
    expect(size.issues).toEqual([{ path: 'big.md', reason: 'limit' }])
  })

  it('stops empty-directory enumeration at the entry bound', async () => {
    const many = directory('vault', [[directory('a', []), directory('b', []), leaf('c.md')]])
    const result = await collectDroppedEntries([many], { limits: { ...limits, entries: 2 } })
    expect(result.files).toHaveLength(0)
    expect(result.issues).toEqual([{ path: 'vault/b', reason: 'limit' }])
  })

  it('cancels late file reads instead of exposing a partial result', async () => {
    const controller = new AbortController()
    let finish: (value: File) => void = () => {}
    const slow = leaf('slow.md')
    slow.file = (done) => {
      finish = done
    }
    const promise = collectDroppedEntries([slow], { signal: controller.signal })
    controller.abort()
    finish(file('slow.md'))
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('snapshots a DataTransfer before its protected data store is cleared', async () => {
    let protectedMode = false
    const transfer = {
      getData: () => (protectedMode ? '' : 'clipboard text'),
      get files() {
        return protectedMode ? [] : [file('note.md')]
      },
      items: [],
    } as unknown as DataTransfer
    const promise = collectDataTransfer(transfer)
    protectedMode = true
    const result = await promise
    expect(result.text).toBe('clipboard text')
    expect(result.files.map((entry) => entry.path)).toEqual(['note.md'])
  })

  it('preserves ambiguous format matches for explicit selection and identifies unsupported inputs', () => {
    const formats = [
      { id: 'a', title: 'A', extensions: ['.md'] },
      { id: 'b', title: 'B', extensions: ['.md'] },
      { id: 'pdf', title: 'PDF', extensions: ['.pdf'] },
    ]
    const result = detectCollectionFormats(
      collectSelectedFiles([file('NOTE.MD'), file('note.PDF'), file('unknown.zip')]).files,
      formats,
    )
    expect(result.map((entry) => entry.formats.map((format) => format.id))).toEqual([
      ['a', 'b'],
      ['pdf'],
      [],
    ])
  })

  it('reads plain text and a single image representation without changing the clipboard', async () => {
    const getType = vi.fn(
      async (type: string) => new Blob([type === 'text/plain' ? '笔记' : 'png']),
    )
    const result = await readCollectionClipboard(async () => [
      {
        types: ['text/html', 'text/plain', 'image/png', 'image/jpeg'],
        getType,
      },
    ])
    expect(getType.mock.calls.map(([type]) => type)).toEqual(['text/plain', 'image/png'])
    expect(result.text).toBe('笔记')
    expect(result.files[0]?.file.type).toBe('image/png')
    expect(result.bytes).toBe(new TextEncoder().encode('笔记').length + 3)
  })

  it('surfaces clipboard permission failures without converting them to empty success', async () => {
    await expect(
      readCollectionClipboard(async () => {
        throw new DOMException('denied', 'NotAllowedError')
      }),
    ).rejects.toMatchObject({ name: 'NotAllowedError' })
  })

  it('rejects oversized clipboard text before reading its body', async () => {
    const blob = new Blob(['12345'])
    const read = vi.spyOn(blob, 'text')
    await expect(
      readCollectionClipboard(
        async () => [
          {
            types: ['text/plain'],
            getType: async () => blob,
          },
        ],
        { limits: { ...limits, bytes: 4 } },
      ),
    ).rejects.toThrow('大小限制')
    expect(read).not.toHaveBeenCalled()
  })
})
