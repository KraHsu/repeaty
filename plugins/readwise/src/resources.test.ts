import { expect, it, vi } from 'vitest'
import { scanExportDirectory } from './directory'

const context = (signal = new AbortController().signal) => ({
  signal,
  progress() {},
  async yield() {},
})
function directory(content: Record<string, string | Blob>) {
  const files = Object.fromEntries(
    Object.entries(content).map(([path, value]) => [
      path,
      typeof value === 'string' ? new Blob([value]) : value,
    ]),
  )
  return {
    files: Object.entries(files).map(([path, blob]) => ({ path, size: blob.size })),
    read: vi.fn(async (path: string) => {
      if (!files[path]) throw new Error(`Unexpected read: ${path}`)
      return files[path]!
    }),
  }
}
it('copies relative Markdown images, audio and reference destinations while preserving code examples', async () => {
  const input = directory({
    'Books/A.md':
      '# A\n![figure](<../assets/a b.png>)\n![other][pic]\n[pic]: ../assets/a%20b.png "title"\n<audio controls src="../assets/clip.mp3"></audio>\n`![code](../assets/code.png)`\n```md\n![code](../assets/code.png)\n```\n    ![code](../assets/code.png)',
    'assets/a b.png': new Blob(['image']),
    'assets/clip.mp3': new Blob(['audio']),
    'assets/code.png': new Blob(['never read']),
  })
  const { items } = await scanExportDirectory(input, context())
  expect(items[0]?.text).toContain('![figure](repeaty-resource:assets/a%20b.png)')
  expect(items[0]?.text).toContain('[pic]: repeaty-resource:assets/a%20b.png "title"')
  expect(items[0]?.text).toContain(
    '<audio controls src="repeaty-resource:assets/clip.mp3"></audio>',
  )
  expect(items[0]?.text).toContain('`![code](../assets/code.png)`')
  expect(items[0]?.text).toContain('```md\n![code](../assets/code.png)\n```')
  expect(items[0]?.resources?.map(({ path, blob }) => [path, blob.type])).toEqual([
    ['assets/clip.mp3', 'audio/mpeg'],
    ['assets/a b.png', 'image/png'],
  ])
  expect(input.read.mock.calls.filter(([path]) => path === 'assets/a b.png')).toHaveLength(1)
  expect(input.read).not.toHaveBeenCalledWith('assets/code.png')
})
it('renders HTML export images/audio offline, removes remote embeds and rejects private or escaping paths', async () => {
  const input = directory({
    'Books/A.html':
      '<h1>A</h1><img src="../assets/p.png" alt="图"><audio><source src="../assets/s.ogg"></audio><img src="https://tracker.test/p.png" alt="远程"><img src="../../escape.png"><img src="../.secret/p.png"><img src="file:///secret.png"><img src="../assets/missing.png"><img src="..%2f..%2fescape.png"><img src="C:/secret.png"><script>run()</script>',
    'assets/p.png': new Blob(['local image']),
    'assets/s.ogg': new Blob(['local audio']),
    '.secret/p.png': new Blob(['private']),
    'escape.png': new Blob(['root file is not the escaped path']),
  })
  const { items } = await scanExportDirectory(input, context())
  expect(items[0]?.text).toContain('![图](repeaty-resource:assets/p.png)')
  expect(items[0]?.text).toContain('<audio controls src="repeaty-resource:assets/s.ogg"></audio>')
  expect(items[0]?.text).toContain('［远程］')
  expect(items[0]?.text).not.toMatch(/tracker|secret|escape|run\(/)
  expect(input.read.mock.calls.map(([path]) => path)).toEqual([
    'Books/A.html',
    'assets/p.png',
    'assets/s.ogg',
  ])
})
it('merges body and highlight resources and reads a shared file once', async () => {
  const input = directory({
    'Books/A.md': '# A\n![figure](../assets/a.png)',
    'Full Document Contents/Books/A.md': '# A\nBody ![figure](../../assets/a.png)',
    'assets/a.png': new Blob(['image']),
  })
  const { items } = await scanExportDirectory(input, context())
  expect(items).toHaveLength(1)
  expect(items[0]?.resources).toHaveLength(1)
  expect(items[0]?.text.match(/repeaty-resource:assets\/a.png/g)).toHaveLength(2)
  expect(input.read.mock.calls.filter(([path]) => path === 'assets/a.png')).toHaveLength(1)
})
it('resolves Reader and highlight JSON export resources relative to the JSON file', async () => {
  const input = directory({
    'export.json': JSON.stringify([
      { id: 'one', title: 'One', html_content: '<p>Body</p><img src="assets/a.png">' },
      { id: 'h1', parent_id: 'one', html_content: '<p>Highlight</p><img src="assets/a.png">' },
    ]),
    'books.json': JSON.stringify([
      { user_book_id: 5, title: 'Five', highlights: [{ text: 'Quote ![figure](assets/a.png)' }] },
    ]),
    'assets/a.png': new Blob(['image']),
  })
  const { items } = await scanExportDirectory(input, context())
  expect(items).toHaveLength(2)
  for (const item of items) {
    expect(item.resources).toHaveLength(1)
    expect(item.text).toContain('repeaty-resource:assets/a.png')
  }
  expect(input.read.mock.calls.filter(([path]) => path === 'assets/a.png')).toHaveLength(1)
})
it('rejects oversized attachments before reading and aborts a late attachment response', async () => {
  const input = directory({ 'A.md': '# A\n![figure](large.png)', 'large.png': new Blob(['small']) })
  input.files.find((file) => file.path === 'large.png')!.size = 10 * 1024 * 1024 + 1
  await expect(scanExportDirectory(input, context())).rejects.toThrow('10 MiB')
  expect(input.read).not.toHaveBeenCalledWith('large.png')
  const controller = new AbortController()
  const late = directory({ 'A.md': '# A\n![figure](p.png)', 'p.png': new Blob(['image']) })
  const read = late.read.getMockImplementation()!
  late.read.mockImplementation(async (path) => {
    const blob = await read(path)
    if (path === 'p.png') controller.abort()
    return blob
  })
  await expect(scanExportDirectory(late, context(controller.signal))).rejects.toMatchObject({
    name: 'AbortError',
  })
})
