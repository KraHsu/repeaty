import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from '@zip.js/zip.js'
import { generateSite } from './generate'
import type { SiteFile } from './model'
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void
  postMessage(value: unknown, transfer?: Transferable[]): void
}
scope.onmessage = async ({ data }) => {
  try {
    if (data.type === 'zip') {
      const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false })
      for (const file of data.files as SiteFile[])
        await writer.add(file.path, new Uint8ArrayReader(file.bytes), {
          lastModDate: new Date('2026-01-01T00:00:00Z'),
        })
      const bytes = await writer.close()
      scope.postMessage({ type: 'zip', bytes }, [bytes.buffer])
    } else {
      const build = await generateSite(data.input, (completed, total) =>
        scope.postMessage({ type: 'progress', completed, total }),
      )
      scope.postMessage(
        { type: 'done', build },
        build.files.map((file) => file.bytes.buffer),
      )
    }
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '站点生成失败。',
    })
  }
}
