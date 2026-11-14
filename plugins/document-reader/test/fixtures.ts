import { ZipWriter, Uint8ArrayWriter, TextReader, Uint8ArrayReader } from '@zip.js/zip.js'

export const pixel = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=',
  ),
  (character) => character.charCodeAt(0),
)
export async function archive(files: Record<string, string | Uint8Array>) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, level: 0 })
  for (const [path, value] of Object.entries(files))
    await writer.add(
      path,
      typeof value === 'string' ? new TextReader(value) : new Uint8ArrayReader(value),
    )
  return writer.close()
}
export function epubFiles(version: 2 | 3 = 3): Record<string, string | Uint8Array> {
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/book.opf': `<package version="${version}.0"><metadata><dc:title>绿色阅读书</dc:title></metadata><manifest>
      <item id="a" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
      <item id="b" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
      <item id="pic" href="images/pixel.png" media-type="image/png"/>
      <item id="nav" href="${version === 3 ? 'nav.xhtml' : 'toc.ncx'}" media-type="${version === 3 ? 'application/xhtml+xml' : 'application/x-dtbncx+xml'}" ${version === 3 ? 'properties="nav"' : ''}/>
    </manifest><spine toc="nav"><itemref idref="a"/><itemref idref="b"/></spine></package>`,
    'OPS/chapter1.xhtml':
      '<html><head><title>第一章</title></head><body><h1 id="start">学习</h1><p>中文<strong>强调😀</strong>重复文本。重复文本。</p><img src="images/pixel.png" alt="示意图"/><a href="chapter2.xhtml#answer">下一章</a><script>globalThis.hacked = true</script></body></html>',
    'OPS/chapter2.xhtml':
      '<html><head><title>第二章</title></head><body><h1 id="answer">回答</h1><p>离线资源和出处。</p><a href="chapter1.xhtml#start">返回</a></body></html>',
    'OPS/images/pixel.png': pixel,
    ...(version === 3
      ? {
          'OPS/nav.xhtml':
            '<html><body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml#start">第一章 · 学习</a></li><li><a href="chapter2.xhtml#answer">第二章 · 回答</a></li></ol></nav></body></html>',
        }
      : {
          'OPS/toc.ncx':
            '<ncx><navMap><navPoint id="p1"><navLabel><text>第一章 · 学习</text></navLabel><content src="chapter1.xhtml#start"/></navPoint><navPoint id="p2"><navLabel><text>第二章 · 回答</text></navLabel><content src="chapter2.xhtml#answer"/></navPoint></navMap></ncx>',
        }),
  }
}
