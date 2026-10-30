import type { MaterialLocator, NoteInput } from '@repeaty/plugin-api'

export const PLUGIN_ID = 'visual-occlusion'
export const MAX_REGIONS = 128
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 40_000_000
export type Rotation = 0 | 90 | 180 | 270
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface Region extends Rect {
  id: string
  label: string
}
export interface FormulaRegion {
  id: string
  label: string
  leaves: number[]
}
export interface ImageData {
  kind: 'image'
  mediaId: string
  width: number
  height: number
  rotation: Rotation
  mode: 'one' | 'all'
  regions: Region[]
  retiredRegions?: Region[]
}
export interface FormulaData {
  kind: 'formula'
  latex: string
  renderer: string
  tokens: string[]
  mode: 'one' | 'all'
  regions: FormulaRegion[]
  retiredRegions?: FormulaRegion[]
}
export type VisualData = ImageData | FormulaData
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const string = (value: unknown, maximum: number) =>
  typeof value === 'string' && value.length <= maximum
const key = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
export function validRect(value: unknown): value is Rect {
  if (!record(value)) return false
  const { x, y, width, height } = value
  return (
    finite(x) &&
    finite(y) &&
    finite(width) &&
    finite(height) &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1.0000001 &&
    y + height <= 1.0000001
  )
}
export function parseData(value: unknown): VisualData | undefined {
  if (
    !record(value) ||
    !['image', 'formula'].includes(String(value.kind)) ||
    !['one', 'all'].includes(String(value.mode))
  )
    return
  if (!Array.isArray(value.regions) || !value.regions.length || value.regions.length > MAX_REGIONS)
    return
  const ids = new Set<string>()
  if (value.retiredRegions !== undefined && !Array.isArray(value.retiredRegions)) return
  const all = [...value.regions, ...((value.retiredRegions as unknown[]) ?? [])]
  if (all.length > MAX_REGIONS) return
  for (const region of all) {
    if (!record(region) || !key(region.id) || ids.has(region.id) || !string(region.label, 160))
      return
    ids.add(region.id)
    if (value.kind === 'image') {
      if (!validRect(region)) return
    } else if (
      !Array.isArray(region.leaves) ||
      !region.leaves.length ||
      region.leaves.length > 512 ||
      region.leaves.some(
        (leaf: unknown) =>
          !Number.isInteger(leaf) ||
          Number(leaf) < 0 ||
          Number(leaf) >= (Array.isArray(value.tokens) ? value.tokens.length : 0),
      ) ||
      new Set(region.leaves).size !== region.leaves.length
    )
      return
  }
  if (value.kind === 'image') {
    if (
      !string(value.mediaId, 100) ||
      !value.mediaId ||
      !Number.isInteger(value.width) ||
      !Number.isInteger(value.height) ||
      Number(value.width) <= 0 ||
      Number(value.height) <= 0 ||
      Number(value.width) * Number(value.height) > MAX_IMAGE_PIXELS ||
      ![0, 90, 180, 270].includes(Number(value.rotation))
    )
      return
  } else if (
    !string(value.latex, 8_000) ||
    !String(value.latex).trim() ||
    !string(value.renderer, 80) ||
    !Array.isArray(value.tokens) ||
    !value.tokens.length ||
    value.tokens.length > 4096 ||
    value.tokens.some((token: unknown) => !string(token, 512))
  )
    return
  return JSON.parse(JSON.stringify(value)) as unknown as VisualData
}
export function regionKey(variant: string) {
  return variant.startsWith('plugin:') ? variant.slice(7) : undefined
}
export function activeRegion(data: VisualData, variant: string) {
  const id = regionKey(variant)
  return (
    data.regions.find((region) => region.id === id) ??
    (variant === 'forward' && data.regions.length === 1 ? data.regions[0] : undefined)
  )
}
export function masked(data: VisualData, id: string, active: string, revealed: boolean) {
  return id === active ? !revealed : data.mode === 'all'
}
export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x, b.x) - x, height: Math.max(a.y, b.y) - y }
}
const clamp = (value: number) => Math.max(0, Math.min(1, value))
export function imagePoint(x: number, y: number, rotation: Rotation) {
  x = clamp(x)
  y = clamp(y)
  if (rotation === 90) return { x: y, y: 1 - x }
  if (rotation === 180) return { x: 1 - x, y: 1 - y }
  if (rotation === 270) return { x: 1 - y, y: x }
  return { x, y }
}
export function displayRect(rect: Rect, rotation: Rotation): Rect {
  if (rotation === 90)
    return { x: 1 - rect.y - rect.height, y: rect.x, width: rect.height, height: rect.width }
  if (rotation === 180)
    return {
      x: 1 - rect.x - rect.width,
      y: 1 - rect.y - rect.height,
      width: rect.width,
      height: rect.height,
    }
  if (rotation === 270)
    return { x: rect.y, y: 1 - rect.x - rect.width, width: rect.height, height: rect.width }
  return rect
}
export function moveRect(rect: Rect, dx: number, dy: number): Rect {
  return {
    ...rect,
    x: Math.max(0, Math.min(1 - rect.width, rect.x + dx)),
    y: Math.max(0, Math.min(1 - rect.height, rect.y + dy)),
  }
}
export function visualNote(
  input: Pick<NoteInput, 'deckId' | 'front' | 'back' | 'tags'>,
  data: VisualData,
  locators?: Record<string, MaterialLocator>,
): NoteInput {
  if (!parseData(data)) throw new Error('请至少选择一个有效的遮挡区域。')
  return {
    ...input,
    type: 'plugin',
    format: 'markdown',
    frontMedia: [],
    backMedia: data.kind === 'image' ? [data.mediaId] : [],
    plugin: Object.assign(
      {
        id: PLUGIN_ID,
        version: 1,
        data: JSON.parse(JSON.stringify(data)) as unknown as Record<string, unknown>,
      },
      {
        variants: data.regions.map((region) => region.id),
        ...(locators ? { variantLocators: locators } : {}),
      },
    ),
  }
}
