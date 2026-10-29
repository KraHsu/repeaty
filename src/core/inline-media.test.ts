import { expect, it } from 'vitest'
import { localMediaReferences, mediaPath } from './inline-media'
import { renderMarkdown, renderReadingMarkdown } from './content'

it('resolves Unicode, nested paths, reference-style images and HTML audio while ignoring code and remote resources', () => {
  const text =
    '![图][image]\n\n[image]: ../../assets/%E5%9B%BE.png\n\n<audio controls><source src="../../assets/sound.ogg"></audio>\n\n`![code](../../secret.png)`\n\n```md\n![code](../../../secret.png)\n```\n\n![remote](https://example.com/tracker.png)'
  expect([...localMediaReferences(text, 'sources/chapter/file.md')]).toEqual([
    ['../../assets/%E5%9B%BE.png', 'assets/图.png'],
    ['../../assets/sound.ogg', 'assets/sound.ogg'],
  ])
  for (const path of [
    '../../../escape.png',
    '../../.repeaty/private.png',
    '//server/file.png',
    'file:///etc/file.png',
    '../../assets/%00.png',
    '../../assets/\\evil.png',
  ])
    expect(() => {
      const resolved = mediaPath(path, 'sources/chapter/file.md')
      if (!resolved?.startsWith('assets/')) throw new Error('unsafe')
    }).toThrow()
})

it('renders only mapped local images and audio without admitting arbitrary blob URLs, scripts or remote fetches', () => {
  const text =
    '![图](../assets/a.png)\n\n<audio src="../assets/sound.ogg" autoplay></audio><img src="https://example.com/a.png" onerror="alert(1)"><audio src="blob:untrusted"></audio><script>alert(1)</script>'
  const resources = new Map([
    ['../assets/a.png', 'blob:accepted-image'],
    ['../assets/sound.ogg', 'blob:accepted-sound'],
  ])
  for (const render of [renderMarkdown, renderReadingMarkdown]) {
    const html = render(text, resources)
    expect(html).toContain('src="blob:accepted-image"')
    expect(html).toContain('src="blob:accepted-sound"')
    expect(html).toContain('controls')
    expect(html).not.toMatch(/autoplay|onerror|<script|src="https:|blob:untrusted/)
    const ordinary = render(text)
    expect(ordinary).not.toContain('blob:')
    expect(ordinary).not.toContain('<audio')
  }
})
