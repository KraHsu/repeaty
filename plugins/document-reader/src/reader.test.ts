// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, shallowReactive } from 'vue'
import type { MaterialReaderProps, MaterialRecord } from '@repeaty/plugin-api'
import { materials } from '../test/plugin-api'
import DocumentReader from './DocumentReader.vue'
import { cacheBook, clearCache } from './cache'
import { cleanHtml } from './html'
import type { DocumentBook } from './model'

const disposers: (() => void)[] = []
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  clearCache()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
async function flush() {
  for (let index = 0; index < 12; index++) {
    await Promise.resolve()
    await nextTick()
  }
}
function mount(props: MaterialReaderProps) {
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp({ render: () => h(DocumentReader, props) })
  app.mount(element)
  disposers.push(() => {
    app.unmount()
    element.remove()
  })
  return { element, unmount: () => app.unmount() }
}
function fixture(kind: 'html' | 'epub' = 'html') {
  const chapter = cleanHtml(
    '<h1>章节</h1><p>中文<strong>😀选区</strong>重复</p><img src="a.png"/>',
    'a.html',
    new Set(['a.png']),
    'Title',
  ).chapter
  const material: MaterialRecord = {
    id: 'chapter',
    title: '章节',
    versionId: 'v1',
    format: 'plain',
    locked: false,
    parentSourceId: 'book',
    document: {
      schemaVersion: 1,
      providerId: 'document-reader',
      format: kind,
      path: 'a.html',
      originalMediaId: 'original',
      resources: [{ path: 'a.png', mediaId: 'image' }],
    },
    studySequence:
      kind === 'epub'
        ? { groupId: 'book', index: 0, mode: 'sequential', completed: false }
        : undefined,
  }
  const book: DocumentBook = {
    kind,
    title: 'Book',
    chapters: [chapter],
    toc: [{ title: '章节', path: 'a.html', depth: 0 }],
    resources: [],
    warnings: [],
  }
  cacheBook(`test-library:${kind}:original:${kind === 'html' ? 'v1' : ''}`, book)
  return { material, book, chapter }
}
describe('document reader lifecycle', () => {
  it('renders persisted local resources and emits exact nested selections, releasing URLs on unmount', async () => {
    const { material, chapter } = fixture()
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-image'),
      revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const onSelect = vi.fn()
    const { element, unmount } = mount({
      workspaceScope: 'test-library',
      material,
      text: chapter.text,
      original: new Blob(['original']),
      resource: async () => new Blob(['image'], { type: 'image/png' }),
      onSelect,
    })
    await flush()
    expect(element.querySelector('img')?.getAttribute('src')).toBe('blob:local-image')
    const span = [...element.querySelectorAll('[data-doc-start]')].find(
      (item) => item.textContent === '😀选区',
    )!
    const range = document.createRange()
    range.setStart(span.firstChild!, 2)
    range.setEnd(span.firstChild!, 4)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    element.querySelector('article')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '选区',
        projection: { start: chapter.text.indexOf('选区'), end: chapter.text.indexOf('选区') + 2 },
      }),
    )
    unmount()
    expect(create).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:local-image')
  })
  it('does not publish late resources after the reader is closed', async () => {
    const { material, chapter } = fixture(),
      create = vi.spyOn(URL, 'createObjectURL')
    let release!: (blob: Blob) => void
    const pending = new Promise<Blob>((resolve) => {
      release = resolve
    })
    const { unmount } = mount({
      workspaceScope: 'test-library',
      material,
      text: chapter.text,
      original: new Blob(['original']),
      resource: () => pending,
      onSelect: vi.fn(),
    })
    await flush()
    unmount()
    release(new Blob(['late']))
    await flush()
    expect(create).not.toHaveBeenCalled()
  })
  it('uses read-only historical mode and falls back safely when projection no longer matches', async () => {
    const { material, chapter } = fixture('epub')
    materials.list.mockResolvedValue([material] as never)
    const { element } = mount({
      workspaceScope: 'test-library',
      material,
      text: chapter.text + 'edited',
      original: new Blob(['original']),
      readOnly: true,
      onSelect: vi.fn(),
    })
    await flush()
    expect(element.textContent).not.toContain('完成本章')
    expect(element.textContent).toContain('正文版本与原件不一致')
    expect(element.querySelector('article')).toBeNull()
    expect(element.querySelector('pre')?.textContent).toBe(chapter.text + 'edited')
    expect(materials.setSequence).not.toHaveBeenCalled()
  })
  it('applies explicit position changes without reloading or replacing a live reading viewport', async () => {
    const { material, chapter } = fixture()
    const props = shallowReactive<MaterialReaderProps>({
      workspaceScope: 'test-library',
      material,
      text: chapter.text,
      original: new Blob(['original']),
      onSelect: vi.fn(),
    })
    const { element } = mount(props)
    await flush()
    const viewport = element.querySelector<HTMLElement>('.document-viewport')!
    viewport.scrollTop = 250
    props.position = { projectionOffset: 0 }
    await flush()
    expect(viewport.scrollTop).toBe(0)
    expect(element.querySelector('.document-viewport')).toBe(viewport)
    expect(materials.list).toHaveBeenCalledTimes(1)
  })
  it('shows current completion, lock and mode after host undo without reloading the chapter', async () => {
    const { material, chapter } = fixture('epub')
    const completed = {
      ...material,
      studySequence: { ...material.studySequence!, completed: true },
    }
    materials.list.mockResolvedValue([completed] as never)
    const props = shallowReactive<MaterialReaderProps>({
      workspaceScope: 'test-library',
      material: completed,
      text: chapter.text,
      original: new Blob(['original']),
      onSelect: vi.fn(),
    })
    const { element } = mount(props)
    await flush()
    const viewport = element.querySelector('.document-viewport')
    expect(element.textContent).toContain('本章已完成')
    props.material = { ...material, studySequence: { ...material.studySequence!, mode: 'free' } }
    await flush()
    expect(element.textContent).not.toContain('本章已完成')
    expect(
      [...element.querySelectorAll('button')].find((button) => button.textContent === '完成本章')
        ?.disabled,
    ).toBe(false)
    expect(element.querySelector('[aria-label="学习顺序"]')?.getAttribute('model-value')).toBe(
      'free',
    )
    expect(element.querySelector('.document-viewport')).toBe(viewport)
  })
})
