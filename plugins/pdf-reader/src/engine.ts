import { getDocument, PDFWorker, type PDFDocumentProxy } from 'pdfjs-dist'
import {
  resources,
  type MaterialImportCandidate,
  type MaterialTaskContext,
} from '@repeaty/plugin-api'
import { PDF_LIMITS, pageProjection, splitPages, type PdfPageProjection } from './projection'

export interface PdfLifetime {
  signal: AbortSignal
  onCleanup(dispose: () => void): void
  createWorker?(source: string, options?: { type?: 'classic' | 'module'; name?: string }): Worker
}

export function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('PDF 操作已取消。', 'AbortError')
}

/** The race rejects even if a terminated worker can no longer answer its last request. */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  checkCancelled(signal)
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('PDF 操作已取消。', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** All binaries are read from this installed plugin. PDFs never choose a network resource URL. */
export class LocalBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const directory = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' }[
      kind
    ]
    if (!directory || !/^[\w.-]+$/.test(filename) || filename.includes('..'))
      throw new Error('PDF 资源请求无效。')
    const blob = resources.read(`${directory}/${filename}`)
    if (!blob) throw new Error(`PDF 阅读器缺少离线资源：${filename}。请重新安装插件。`)
    return new Uint8Array(await blob.arrayBuffer())
  }
}

export async function openPdf(original: Blob, lifetime: PdfLifetime) {
  checkCancelled(lifetime.signal)
  if (!original.size || original.size > PDF_LIMITS.bytes)
    throw new Error('PDF 原件需在 1 字节至 64 MiB 之间。')
  if (!lifetime.createWorker)
    throw new Error('当前宿主不支持 PDF 阅读器所需的 Worker，请更新 Repeaty。')
  const asset = resources.read('pdf.worker.min.mjs')
  if (!asset) throw new Error('PDF 阅读器缺少离线 Worker，请重新安装插件。')
  const source = await abortable(asset.text(), lifetime.signal)
  const port = lifetime.createWorker(source, { type: 'module', name: 'repeaty-pdf' })
  // PDF.js 6.4's generated constructor declaration infers `port: null`, although its
  // documented constructor accepts a real Worker (and avoids the fake-worker fallback).
  const WorkerWithPort = PDFWorker as unknown as new (options: { port: Worker }) => PDFWorker
  const worker = new WorkerWithPort({ port })
  let closed = false
  let loading: ReturnType<typeof getDocument> | undefined
  const close = () => {
    if (closed) return
    closed = true
    // PDF.js' teardown is asynchronous. Destroy the message handler immediately as well,
    // so unmount/cancellation cannot leave a live parser waiting for another request.
    void loading?.destroy().catch(() => undefined)
    worker.destroy()
    port.terminate()
  }
  lifetime.onCleanup(close)
  lifetime.signal.addEventListener('abort', close, { once: true })
  lifetime.onCleanup(() => lifetime.signal.removeEventListener('abort', close))
  try {
    const data = new Uint8Array(await abortable(original.arrayBuffer(), lifetime.signal))
    loading = getDocument({
      data,
      worker,
      useWorkerFetch: false,
      BinaryDataFactory: LocalBinaryDataFactory,
      cMapUrl: 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'standard_fonts/',
      wasmUrl: 'wasm/',
      enableXfa: false,
      stopAtErrors: true,
      useSystemFonts: false,
      maxImageSize: 32_000_000,
      canvasMaxAreaInBytes: PDF_LIMITS.canvasPixels * 4,
      isImageDecoderSupported: false,
    })
    const document = await abortable(loading.promise, lifetime.signal)
    if (!document.numPages || document.numPages > PDF_LIMITS.pages)
      throw new Error(`PDF 页数超过 ${PDF_LIMITS.pages} 页，请先按章节拆分原件。`)
    return { document, close }
  } catch (error) {
    close()
    if (lifetime.signal.aborted) throw new DOMException('PDF 操作已取消。', 'AbortError')
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error('此 PDF 需要密码。请先保存一份已解除密码保护的副本，再导入。')
    throw error
  }
}

export async function projectPdf(
  document: PDFDocumentProxy,
  start: number,
  end: number,
  lifetime: PdfLifetime,
  progress?: (page: number) => void,
  yieldControl?: () => Promise<void>,
) {
  const pages: PdfPageProjection[] = []
  let characters = 0,
    objects = 0
  for (let pageNumber = start; pageNumber <= end; pageNumber++) {
    checkCancelled(lifetime.signal)
    const page = await abortable(document.getPage(pageNumber + 1), lifetime.signal)
    try {
      const text = await abortable(page.getTextContent(), lifetime.signal)
      const projection = pageProjection(
        pageNumber,
        text.items.filter((item) => 'str' in item),
      )
      characters += projection.text.length
      objects += projection.runs.length
      if (characters > PDF_LIMITS.totalCharacters || objects > PDF_LIMITS.totalTextItems)
        throw new Error('PDF 文字总量过大，请先按章节拆分原件；本次没有截断或导入部分内容。')
      pages.push(projection)
      progress?.(pageNumber)
    } finally {
      page.cleanup()
    }
    await yieldControl?.()
  }
  return pages
}

export async function importPdf(
  file: File,
  context: MaterialTaskContext,
): Promise<MaterialImportCandidate[]> {
  const { document, close } = await openPdf(file, context)
  try {
    const pages = await projectPdf(
      document,
      0,
      document.numPages - 1,
      context,
      (page) =>
        context.progress({
          completed: page + 1,
          total: document.numPages,
          message: `读取 PDF 第 ${page + 1} 页`,
        }),
      () => context.yield(),
    )
    const parts = splitPages(pages),
      title = file.name.replace(/\.pdf$/i, '') || 'PDF'
    const candidates: MaterialImportCandidate[] = parts.map((part, index) => ({
      key: `pages-${part.startPage}-${part.endPage}`,
      title: parts.length === 1 ? title : `${title} · ${part.startPage + 1}–${part.endPage + 1} 页`,
      text: part.text,
      format: 'plain',
      documentFormat: 'pdf',
      readerId: 'pdf',
      ...(parts.length > 1 ? { parentKey: 'document' } : {}),
      documentData: {
        projectionVersion: 1,
        pageStart: part.startPage,
        pageEnd: part.endPage,
        pageCount: document.numPages,
        part: index,
      },
    }))
    if (parts.length > 1)
      candidates.unshift({
        key: 'document',
        title,
        text:
          `${title}\n${document.numPages} 页 PDF，分为 ${parts.length} 个阅读章节。\n` +
          candidates.map((part) => part.title).join('\n'),
        format: 'plain',
        documentFormat: 'pdf',
        readerId: 'pdf',
        container: true,
        documentData: { projectionVersion: 1, pageCount: document.numPages },
      })
    return candidates
  } finally {
    close()
  }
}
