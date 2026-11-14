import { describe, expect, it, vi } from 'vitest'
import { convertLinks, resolveVaultLink, safePath, scanVault } from './vault'

describe('Obsidian vault conversion', () => {
  it('resolves root, relative, unique short names and encoded attachments without path escape', () => {
    const paths = new Set(['A.md', 'folder/B.md', 'assets/猫 图.png', 'one/C.md', 'two/C.md'])
    expect(resolveVaultLink('folder/B.md', '../A', paths)).toBe('A.md')
    expect(resolveVaultLink('A.md', 'B', paths)).toBe('folder/B.md')
    expect(resolveVaultLink('A.md', 'C', paths)).toBeUndefined()
    expect(resolveVaultLink('A.md', '../../A.md', paths)).toBeUndefined()
    expect(resolveVaultLink('A.md', 'assets/%E7%8C%AB%20%E5%9B%BE.png', paths)).toBe(
      'assets/猫 图.png',
    )
    expect(safePath('.obsidian/config.json')).toBeUndefined()
    expect(safePath('folder/.hidden.md')).toBeUndefined()
  })
  it('retains anchors and labels, copies only linked resources and leaves code unchanged', () => {
    const result = convertLinks(
      '[[folder/B#标题|别名]] ![[assets/a.png|320]]\n`[[folder/B]]`\n```md\n[[folder/B]]\n```\n![图片](assets/a.png) [[missing]]',
      'A.md',
      new Set(['A.md', 'folder/B.md', 'assets/a.png']),
    )
    expect(result.text).toContain('[别名](repeaty-source:folder%2FB.md#%E6%A0%87%E9%A2%98)')
    expect(result.text).toContain('![a.png](repeaty-resource:assets/a.png)')
    expect(result.text).toContain('`[[folder/B]]`')
    expect(result.text).toContain('```md\n[[folder/B]]\n```')
    expect(result.text).toContain('[[missing]]')
    expect(result.resources).toEqual(['assets/a.png'])
    expect(result.links).toEqual([{ targetKey: 'folder/B.md', label: '别名', anchor: '标题' }])
  })
  it('produces stable keys, filters private files and never mutates source files', async () => {
    const content = new Map([
      ['N.md', '# Note\n![[image.png]]'],
      ['image.png', 'image'],
      ['.obsidian/private.md', 'private'],
    ])
    const read = vi.fn(async (path: string) => new Blob([content.get(path)!]))
    const directory = {
      files: [...content].map(([path, value]) => ({ path, size: value.length })),
      read,
    }
    const context = {
      signal: new AbortController().signal,
      progress: vi.fn(),
      yield: async () => {},
    }
    const first = await scanVault(directory, context)
    const second = await scanVault(directory, context)
    expect(first.items.map((item) => item.key)).toEqual(second.items.map((item) => item.key))
    expect(first.items[0]?.resources[0]?.blob.type).toBe('image/png')
    expect(read.mock.calls.flat()).not.toContain('.obsidian/private.md')
    expect(first.complete).toBe(true)
  })
  it('cancellation cannot return a partial snapshot that implies deletions', async () => {
    const abort = new AbortController()
    await expect(
      scanVault(
        {
          files: [{ path: 'N.md', size: 1 }],
          read: async () => {
            abort.abort()
            return new Blob(['x'])
          },
        },
        { signal: abort.signal, progress() {}, async yield() {} },
      ),
    ).rejects.toThrow()
  })
  it('bounds long headings to the host title limit without truncating the original note', async () => {
    const heading = '笔记标题'.repeat(60),
      text = `# ${heading}\n\nFull note body`
    const result = await scanVault(
      {
        files: [{ path: 'long.md', size: new Blob([text]).size }],
        read: async () => new Blob([text]),
      },
      { signal: new AbortController().signal, progress() {}, async yield() {} },
    )
    expect(result.items[0]?.title).toBe(heading.slice(0, 160))
    expect(result.items[0]?.text).toBe(text)
    expect(result.complete).toBe(true)
  })
  it('rejects an empty note without returning a partial snapshot that implies deletion', async () => {
    await expect(
      scanVault(
        {
          files: [{ path: 'empty.md', size: 3 }],
          read: async () => new Blob([' \n\t']),
        },
        { signal: new AbortController().signal, progress() {}, async yield() {} },
      ),
    ).rejects.toThrow('暂时为空')
  })
})
