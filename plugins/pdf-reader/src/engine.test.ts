import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ getDocument: vi.fn(), destroy: vi.fn(), workerDestroy: vi.fn() }))
vi.mock('pdfjs-dist', () => ({
  getDocument: mock.getDocument,
  PDFWorker: class {
    destroy = mock.workerDestroy
  },
}))
import { resources } from '../test/plugin-api'
import { abortable, LocalBinaryDataFactory, openPdf } from './engine'

function lifetime() {
  const controller = new AbortController(),
    cleanup: (() => void)[] = [],
    terminate = vi.fn()
  return {
    controller,
    terminate,
    cleanup,
    signal: controller.signal,
    onCleanup: (fn: () => void) => cleanup.push(fn),
    createWorker: vi.fn(() => ({ terminate }) as unknown as Worker),
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  resources.read.mockReturnValue(new Blob(['worker']))
  mock.destroy.mockResolvedValue(undefined)
})
describe('PDF worker lifecycle and offline binaries', () => {
  it('rejects aborted requests even when their worker promise never settles', async () => {
    const controller = new AbortController()
    const pending = abortable(new Promise(() => {}), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('destroys failed and cancelled parses exactly once', async () => {
    const scope = lifetime()
    mock.getDocument.mockReturnValue({
      promise: Promise.reject(new Error('corrupt PDF')),
      destroy: mock.destroy,
    })
    await expect(openPdf(new Blob(['%PDF']), scope)).rejects.toThrow('corrupt PDF')
    scope.cleanup.forEach((fn) => fn())
    expect(mock.destroy).toHaveBeenCalledOnce()
    expect(mock.workerDestroy).toHaveBeenCalledOnce()
    expect(scope.terminate).toHaveBeenCalledOnce()
  })
  it('reports password protection without leaving a parser alive', async () => {
    mock.getDocument.mockReturnValue({
      promise: Promise.reject(Object.assign(new Error('password'), { name: 'PasswordException' })),
      destroy: mock.destroy,
    })
    const scope = lifetime()
    await expect(openPdf(new Blob(['%PDF']), scope)).rejects.toThrow('密码')
    expect(scope.terminate).toHaveBeenCalledOnce()
  })
  it('resolves only declared offline resource paths and rejects traversal/network names', async () => {
    const factory = new LocalBinaryDataFactory()
    await factory.fetch({ kind: 'cMapUrl', filename: 'UniGB-UTF16-H.bcmap' })
    expect(resources.read).toHaveBeenCalledWith('cmaps/UniGB-UTF16-H.bcmap')
    for (const filename of ['../../secret', 'https://remote.test/font', 'x/y'])
      await expect(factory.fetch({ kind: 'cMapUrl', filename })).rejects.toThrow('无效')
    resources.read.mockReturnValue(undefined)
    await expect(factory.fetch({ kind: 'wasmUrl', filename: 'openjpeg.wasm' })).rejects.toThrow(
      '缺少',
    )
  })
})
