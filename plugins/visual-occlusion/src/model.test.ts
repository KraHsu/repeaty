import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
import { imageData } from '../test/fixtures'
import {
  activeRegion,
  displayRect,
  imagePoint,
  masked,
  moveRect,
  parseData,
  rectFromPoints,
  visualNote,
} from './model'
import { regionLocators } from './workflow'
describe('portable occlusion variants', () => {
  it('preserves region identity through geometry, order, retirement and restoration', () => {
    const data = imageData(),
      input = { deckId: 'deck', front: 'question', back: 'answer', tags: [] }
    const original = visualNote(input, reactive(data))
    expect(original.plugin?.variants).toEqual(['region-a', 'region-b'])
    const a = data.regions.shift()!
    data.regions[0]!.x = 0.6
    data.retiredRegions = [a]
    expect(visualNote(input, data).plugin?.variants).toEqual(['region-b'])
    data.regions.push(data.retiredRegions.pop()!)
    const restored = visualNote(
      input,
      data,
      regionLocators(data, { sourceId: 'source', versionId: 'old' }),
    )
    expect(restored.plugin?.variants).toEqual(['region-b', 'region-a'])
    expect(restored.plugin?.variantLocators?.['region-a']).toMatchObject({
      kind: 'image',
      sourceId: 'source',
      versionId: 'old',
      x: 0.1,
    })
    expect(restored.frontMedia).toEqual([])
    expect(restored.backMedia).toEqual(['original.png'])
    expect(activeRegion(data, 'plugin:region-a')?.label).toBe('细胞核')
    expect(activeRegion(data, 'plugin:missing')).toBeUndefined()
  })
  it('rejects corrupted data before the editor can overwrite it', () => {
    const data = imageData()
    expect(parseData({ ...data, regions: [data.regions[0], data.regions[0]] })).toBeUndefined()
    expect(parseData({ ...data, retiredRegions: [data.regions[0]] })).toBeUndefined()
    expect(parseData({ ...data, regions: [{ ...data.regions[0], x: NaN }] })).toBeUndefined()
    expect(parseData({ ...data, width: 100000, height: 100000 })).toBeUndefined()
    expect(parseData({ ...data, regions: [] })).toBeUndefined()
    expect(parseData({ ...data, rotation: 45 })).toBeUndefined()
  })
  it('reveals only the current region and retains the other-region mode', () => {
    const data = imageData()
    expect(masked(data, 'region-a', 'region-a', false)).toBe(true)
    expect(masked(data, 'region-b', 'region-a', false)).toBe(false)
    data.mode = 'all'
    expect(masked(data, 'region-b', 'region-a', true)).toBe(true)
    expect(masked(data, 'region-a', 'region-a', true)).toBe(false)
  })
})
describe('canonical image geometry', () => {
  it.each([0, 90, 180, 270] as const)('round trips region corners at %i degrees', (rotation) => {
    const original = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      displayed = displayRect(original, rotation)
    const a = imagePoint(displayed.x, displayed.y, rotation),
      b = imagePoint(displayed.x + displayed.width, displayed.y + displayed.height, rotation)
    const restored = rectFromPoints(a, b)
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(restored[key]).toBeCloseTo(original[key])
  })
  it('clamps movement to original bounds', () => {
    expect(moveRect({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, 20, -20)).toEqual({
      x: 0.7,
      y: 0,
      width: 0.3,
      height: 0.4,
    })
  })
})
