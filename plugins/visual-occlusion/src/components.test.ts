// @vitest-environment happy-dom
import { createApp, h, nextTick, reactive, type Component } from 'vue'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import type { MaterialCommandContext, NoteInput } from '@repeaty/plugin-api'
import { materials } from '../test/plugin-api'
import { imageData, png, source } from '../test/fixtures'
import FormulaSurface from './FormulaSurface.vue'
import VisualTool from './VisualTool.vue'
import NoteEditor from './NoteEditor.vue'
import ImageSurface from './ImageSurface.vue'
import Question from './Question.vue'
import { formulaLeaves, renderFormula, RENDERER } from './formula'
import type { QuestionProps } from '@repeaty/plugin-api'
import { visualNote } from './model'
import { regionLocators } from './workflow'
const disposals: (() => void)[] = []
async function settle() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
function mount(component: Component, props: Record<string, unknown>) {
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ render: () => h(component, props) })
  app.mount(container)
  disposals.push(() => {
    app.unmount()
    container.remove()
  })
  return container
}
function button(root: HTMLElement, text: string) {
  const result = [...root.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(text),
  )
  expect(result).toBeDefined()
  return result!
}
beforeEach(() => {
  vi.clearAllMocks()
  materials.snapshot.mockReturnValue({
    workspaceScope: 'scope',
    revision: 3,
    sources: [source],
    decks: [{ id: 'deck', name: '卡组' }],
  })
  materials.original.mockResolvedValue(new Blob([png().buffer as ArrayBuffer]))
  materials.createNote.mockResolvedValue({ noteId: 'note', revision: 4 })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:visual')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('visual authoring and review', () => {
  it('enables manual grades only after a valid rendered formula has been revealed', async () => {
    const own = document.createElement('div')
    own.innerHTML = renderFormula('a+b')
    const data = {
      kind: 'formula' as const,
      latex: 'a+b',
      renderer: RENDERER,
      tokens: formulaLeaves(own).tokens,
      mode: 'one' as const,
      regions: [{ id: 'a', label: '区域', leaves: [0] }],
    }
    const note = visualNote(
      { deckId: 'deck', front: 'question', back: '$$\na+b\n$$', tags: [] },
      data,
    )
    const props = reactive<QuestionProps>({
      card: {
        ...note,
        id: 'card',
        noteId: 'note',
        variant: 'plugin:a',
        format: 'markdown',
        createdAt: '',
        updatedAt: '',
      },
      media: [],
      getMedia: async () => undefined,
      state: { allowedGrades: [], busy: false },
      revealed: false,
    })
    mount(Question, props)
    await settle()
    expect(props.state.allowedGrades).toEqual([])
    props.revealed = true
    await settle()
    expect(props.state.allowedGrades).toEqual([1, 2, 3, 4])
  })
  it('creates a real formula note from rendered DOM selection with exact source locator', async () => {
    const text = '记忆这个公式：$$\\frac{a+b}{c^2}$$。'
    materials.get.mockResolvedValue({
      material: { ...source, format: 'markdown', document: undefined },
      text,
    })
    const context: MaterialCommandContext = {
      sourceId: 'source',
      workspaceScope: 'scope',
      expectedRevision: 3,
      operationId: 'tool',
      signal: new AbortController().signal,
      progress() {},
      onCleanup() {},
      yield: async () => {},
    }
    const close = vi.fn(),
      root = mount(VisualTool, { context, onClose: close, kind: 'formula' })
    await settle()
    const leaf = [...root.querySelectorAll<HTMLElement>('[data-formula-leaf]')].find(
      (node) => node.textContent === 'c',
    )!
    expect(leaf).toBeDefined()
    leaf.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await settle()
    button(root, '添加遮挡区域').click()
    await settle()
    button(root, '创建 1 张卡片').click()
    await settle()
    expect(materials.createNote).toHaveBeenCalledOnce()
    const request = materials.createNote.mock.calls[0]![0],
      key = request.note.plugin.variants[0]
    expect(request.selection).toMatchObject({
      text: '$$\\frac{a+b}{c^2}$$',
      projection: { start: 7, end: text.length - 1 },
      locator: {
        kind: 'formula',
        latex: '\\frac{a+b}{c^2}',
        leaves: [Number(leaf.dataset.formulaLeaf)],
      },
    })
    expect(request.note.plugin.variantLocators[key]).toEqual(request.selection.locator)
    expect(request.note.plugin.data.tokens[request.selection.locator.leaves[0]]).toBe('c')
    expect(close).toHaveBeenCalledOnce()
  })
  it('reveals the same DOM nodes without moving or replacing the formula tree', async () => {
    const selected: number[][] = [],
      tokens: string[][] = []
    const props = reactive({
      latex: 'a+b',
      editable: true,
      selected: [] as number[],
      onSelect: (leaves: number[]) => selected.push(leaves),
      onReady: (value: string[]) => tokens.push(value),
    })
    const root = mount(FormulaSurface, props)
    await settle()
    const leaves = [...root.querySelectorAll<HTMLElement>('[data-formula-leaf]')]
    leaves[0]!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    leaves[2]!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, shiftKey: true }))
    await settle()
    expect(selected).toEqual([[0], [0, 1, 2]])
    expect(tokens[0]).toEqual(['a', '+', 'b'])
    props.selected = [1]
    await settle()
    expect(root.querySelector('[data-formula-leaf="1"]')).toBe(leaves[1])
    expect(leaves[1]!.classList.contains('vo-leaf-selected')).toBe(true)
  })
  it('retires and restores the same region ID via the actual shared note editor', async () => {
    const data = imageData(),
      locators = regionLocators(data, { sourceId: 'source', versionId: 'version-old' })
    const original: NoteInput = {
      ...visualNote(
        { deckId: 'deck', front: 'question', back: 'answer', tags: [] },
        data,
        locators,
      ),
      excerpt: {
        sourceId: 'source',
        mediaId: 'version-old',
        start: 0,
        end: 8,
        quote: 'cell.png',
        locator: locators['region-a'],
      },
    }
    const props = reactive({
      modelValue: original,
      'onUpdate:modelValue': (value: NoteInput) => {
        props.modelValue = value
      },
    })
    const root = mount(NoteEditor, props)
    await settle()
    expect(materials.original).toHaveBeenCalledOnce()
    button(root, '退役当前区域').click()
    await settle()
    expect(props.modelValue.plugin?.variants).toEqual(['region-b'])
    expect((props.modelValue.plugin?.data.retiredRegions as { id: string }[])[0]?.id).toBe(
      'region-a',
    )
    button(root, '恢复 细胞核').click()
    await settle()
    expect(props.modelValue.plugin?.variants).toEqual(['region-b', 'region-a'])
    expect(props.modelValue.plugin?.variantLocators?.['region-a']).toEqual(locators['region-a'])
    expect(props.modelValue.back).toBe('answer')
    expect(materials.original).toHaveBeenCalledOnce()
  })
  it('draws a canonical rectangle after rotating and releases its original object URL', async () => {
    const add = vi.fn(),
      root = mount(ImageSurface, {
        blob: new Blob([png().buffer as ArrayBuffer]),
        rotation: 90,
        editable: true,
        onAdd: add,
      })
    await settle()
    const stage = root.querySelector<HTMLElement>('.vo-stage')!
    expect(stage).toBeDefined()
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 600,
    } as DOMRect)
    stage.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        clientX: 40,
        clientY: 120,
        button: 0,
      }),
    )
    stage.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 1,
        clientX: 120,
        clientY: 300,
        button: 0,
      }),
    )
    await settle()
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0.2, width: 0.3, height: expect.closeTo(0.2) }),
    )
    expect(add.mock.calls[0]![0].y).toBeCloseTo(0.7)
    disposals.pop()!()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:visual')
  })
  it('keeps the displayed opposite corner anchored when resizing a rotated image region', async () => {
    const change = vi.fn(),
      root = mount(ImageSurface, {
        blob: new Blob([png().buffer as ArrayBuffer]),
        rotation: 90,
        editable: true,
        selected: 'region',
        regions: [{ id: 'region', label: 'Area', x: 0.2, y: 0.3, width: 0.3, height: 0.2 }],
        onChange: change,
      })
    await settle()
    const stage = root.querySelector<HTMLElement>('.vo-stage')!
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 600,
    } as DOMRect)
    root.querySelector('.vo-resize')!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        clientX: 280,
        clientY: 300,
        button: 0,
      }),
    )
    stage.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        clientX: 320,
        clientY: 360,
        button: 0,
      }),
    )
    expect(change).toHaveBeenCalledWith(
      expect.objectContaining({
        x: expect.closeTo(0.2),
        y: expect.closeTo(0.2),
        width: expect.closeTo(0.4),
        height: expect.closeTo(0.3),
      }),
    )
  })
})
