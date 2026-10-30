import {
  materials,
  type MaterialCommandContext,
  type MaterialLocator,
  type MaterialSelection,
  type NoteInput,
} from '@repeaty/plugin-api'
import { visualNote, type VisualData } from './model'
import type { Formula } from './formula'
export function current(context: MaterialCommandContext) {
  context.signal.throwIfAborted()
  const snapshot = materials.snapshot()
  if (snapshot.workspaceScope !== context.workspaceScope)
    throw new Error('学习库已切换，请重新打开工具。')
  return snapshot
}
export async function frozenMaterial(context: MaterialCommandContext) {
  const snapshot = current(context)
  if (!context.sourceId) throw new Error('请先打开一份学习材料。')
  const version =
    context.selection?.locator.versionId ??
    snapshot.sources.find((source) => source.id === context.sourceId)?.versionId
  if (!version) throw new Error('材料版本不可用，请重新打开。')
  const result = await materials.get(context.sourceId, version)
  current(context)
  if (result.material.versionId !== version) throw new Error('材料版本不匹配，请重新打开。')
  return result
}
export function regionLocators(
  data: VisualData,
  base: Pick<MaterialLocator, 'sourceId' | 'versionId'>,
  formula?: Pick<Formula, 'start' | 'end'>,
): Record<string, MaterialLocator> {
  return Object.fromEntries(
    data.regions.map((region) => [
      region.id,
      data.kind === 'image' && 'x' in region
        ? {
            schemaVersion: 1,
            ...base,
            kind: 'image',
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
          }
        : {
            schemaVersion: 1,
            ...base,
            kind: 'formula',
            start: formula?.start ?? 0,
            end: formula?.end ?? 0,
            latex: data.kind === 'formula' ? data.latex : '',
            leaves: 'leaves' in region ? region.leaves : [],
          },
    ]),
  )
}
export function prepareNote(
  input: Pick<NoteInput, 'deckId' | 'front' | 'back' | 'tags'>,
  data: VisualData,
  base: Pick<MaterialLocator, 'sourceId' | 'versionId'>,
  text: string,
  formula?: Formula,
) {
  const locators = regionLocators(data, base, formula),
    locator = locators[data.regions[0]?.id ?? '']
  if (!locator) throw new Error('请至少添加一个遮挡区域。')
  const start = formula?.start ?? 0,
    end = formula?.end ?? text.length
  const selection: MaterialSelection = {
    locator,
    text: text.slice(start, end),
    projection: { start, end },
  }
  return { note: visualNote(input, data, locators), selection }
}
export async function saveVisual(
  context: MaterialCommandContext,
  prepared: ReturnType<typeof prepareNote>,
  operationId: string,
) {
  const snapshot = current(context)
  if (!snapshot.decks.some((deck) => deck.id === prepared.note.deckId))
    throw new Error('请选择可用卡组。')
  const result = await materials.createNote({
    sourceId: prepared.selection.locator.sourceId,
    ...prepared,
    expectedRevision: snapshot.revision,
    operationId,
  })
  current(context)
  return result
}
