import { reactive, readonly, ref, type DeepReadonly } from 'vue'
import { z } from 'zod'
import { readSetting, writeSetting } from './settings-store'

export const APPEARANCE_KEY = 'repeaty.appearance.v1'
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const font = z
  .string()
  .max(120)
  .regex(/^[\p{L}\p{N} ,.'_-]*$/u)
  .catch('')
export const paletteSchema = z.object({
  accent: color,
  text: color,
  canvas: color,
  surface: color,
  sidebar: color,
  selection: color,
  highlight: color,
  cloze: color,
})
export const defaultPalettes = {
  light: {
    accent: '#34674d',
    text: '#243c31',
    canvas: '#f3f5f0',
    surface: '#ffffff',
    sidebar: '#edf1e8',
    selection: '#cbdcc1',
    highlight: '#f4e7ad',
    cloze: '#34674d',
  },
  dark: {
    accent: '#a2c7a3',
    text: '#e5ece4',
    canvas: '#121b17',
    surface: '#1b2721',
    sidebar: '#18231c',
    selection: '#415e48',
    highlight: '#65542b',
    cloze: '#a2c7a3',
  },
}
export const materialIconStates = ['pending', 'scheduled', 'archived'] as const
export const materialIconShapes = [
  'document',
  'leaf',
  'hexagon',
  'diamond',
  'circle',
  'square',
  'triangle',
  'custom',
] as const
export const materialIconSchema = z.object({
  shape: z.enum(materialIconShapes),
  color: z.union([color, z.literal('')]),
  scale: z.number().min(0.5).max(2),
  lineWidth: z.number().min(0.25).max(4),
  doubleLine: z.boolean(),
  innerScale: z.number().min(0.25).max(0.95),
  innerWidth: z.number().min(0).max(4),
  opacity: z.number().min(0.2).max(1),
  textOpacity: z.number().min(0.3).max(1),
  path: z
    .string()
    .max(8192)
    .regex(/^[MmZzLlHhVvCcSsQqTtAaEe0-9+.,\s-]*$/),
})
export type MaterialIcon = z.infer<typeof materialIconSchema>
export const defaultMaterialIcons: Record<(typeof materialIconStates)[number], MaterialIcon> = {
  pending: {
    shape: 'document',
    color: '',
    scale: 1,
    lineWidth: 1.5,
    doubleLine: false,
    innerScale: 0.7,
    innerWidth: 1,
    opacity: 1,
    textOpacity: 1,
    path: '',
  },
  scheduled: {
    shape: 'leaf',
    color: '',
    scale: 1,
    lineWidth: 1.5,
    doubleLine: true,
    innerScale: 0.7,
    innerWidth: 1,
    opacity: 1,
    textOpacity: 1,
    path: '',
  },
  archived: {
    shape: 'document',
    color: '',
    scale: 1,
    lineWidth: 1.5,
    doubleLine: false,
    innerScale: 0.7,
    innerWidth: 1,
    opacity: 0.6,
    textOpacity: 0.7,
    path: '',
  },
}
export const appearanceSchema = z.object({
  font: font.default(''),
  monoFont: font.default(''),
  readingFont: font.default(''),
  interfaceScale: z.number().min(75).max(200).catch(100),
  navigationScale: z.number().min(75).max(150).catch(100),
  listScale: z.number().min(75).max(150).catch(100),
  readingSize: z.number().min(12).max(36).catch(18),
  readingWidth: z.number().min(360).max(1400).catch(800),
  readingLineHeight: z.number().min(1.3).max(2.5).catch(1.75),
  paragraphSpacing: z.number().min(0).max(2).catch(0.75),
  dividerStrength: z.number().min(0).max(100).catch(24),
  dimImages: z.boolean().catch(false),
  pdfMode: z.enum(['original', 'warm', 'inverted']).catch('original'),
  fontSmoothing: z.enum(['system', 'antialiased']).catch('antialiased'),
  reduceMotion: z.boolean().catch(false),
  strongContrast: z.boolean().catch(false),
  materialIcons: z
    .record(z.enum(materialIconStates), materialIconSchema)
    .catch(defaultMaterialIcons),
  reviewIcons: z.record(z.enum(materialIconStates), materialIconSchema).catch(defaultMaterialIcons),
  light: paletteSchema.catch(defaultPalettes.light),
  dark: paletteSchema.catch(defaultPalettes.dark),
  favorites: z
    .array(z.object({ name: z.string().min(1).max(60), light: paletteSchema, dark: paletteSchema }))
    .max(12)
    .catch([]),
})
export type Appearance = z.infer<typeof appearanceSchema>
export type Palette = Appearance['light']
const state = reactive(appearanceSchema.parse({}))
export const appearance = readonly(state)
export const appearanceError = ref('')
let generation = 0
export function restoreAppearance() {
  generation++
  try {
    Object.assign(state, appearanceSchema.parse(JSON.parse(readSetting(APPEARANCE_KEY) ?? '{}')))
  } catch {
    Object.assign(state, appearanceSchema.parse({}))
  }
  appearanceError.value = ''
}
export function setAppearance<K extends keyof Appearance>(key: K, value: Appearance[K]) {
  const result = appearanceSchema.safeParse({ ...state, [key]: value })
  if (!result.success || JSON.stringify(result.data[key]) !== JSON.stringify(value)) {
    appearanceError.value = '设置值无效，请检查颜色、字体名称或数值范围。'
    return false
  }
  Object.assign(state, result.data)
  appearanceError.value = ''
  const current = generation
  try {
    writeSetting(APPEARANCE_KEY, JSON.stringify(state), () => {
      if (current !== generation) return
      appearanceError.value = '设置已生效，但未能保存；下次打开时可能恢复默认设置。'
    })
  } catch {
    appearanceError.value = '设置已生效，但未能保存；下次打开时可能恢复默认设置。'
  }
  return true
}
export function resetAppearance() {
  Object.assign(state, appearanceSchema.parse({}))
  setAppearance('readingSize', state.readingSize)
}
export function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722
  }
  const x = luminance(a),
    y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
export function readableInk(background: string) {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#14271f')
    ? '#ffffff'
    : '#14271f'
}
/** Only controlled values enter CSS; custom fonts are installed font names, never CSS/URLs. */
export function appearanceVariables(
  value: DeepReadonly<Appearance>,
  dark: boolean,
): Record<string, string> {
  const palette = dark ? value.dark : value.light
  const vars: Record<string, string> = {
    '--reading-font': value.readingFont ? `${value.readingFont}, var(--font-ui)` : 'var(--font-ui)',
    '--font-size-reading': `${value.readingSize / 16}rem`,
    '--reading-width': `${value.readingWidth / 16}rem`,
    '--line-height-reading': String(value.readingLineHeight),
    '--reading-paragraph-spacing': `${value.paragraphSpacing}em`,
    '--navigation-scale': String(value.navigationScale / 100),
    '--list-scale': String(value.listScale / 100),
    '--ui-primary': palette.accent,
    '--ui-text': palette.text,
    '--ui-text-highlighted': palette.text,
    '--ui-text-muted': value.strongContrast
      ? palette.text
      : `color-mix(in srgb, ${palette.text} 78%, ${palette.surface})`,
    '--ui-text-toned': `color-mix(in srgb, ${palette.text} 88%, ${palette.surface})`,
    '--ui-text-dimmed': value.strongContrast
      ? palette.text
      : `color-mix(in srgb, ${palette.text} 70%, ${palette.surface})`,
    '--ui-text-inverted': readableInk(palette.accent),
    '--ui-bg': palette.surface,
    '--ui-bg-muted': palette.canvas,
    '--ui-bg-elevated': palette.sidebar,
    '--ui-bg-accented': `color-mix(in srgb, ${palette.accent} 20%, ${palette.surface})`,
    '--app-canvas': palette.canvas,
    '--app-rail': palette.sidebar,
    '--app-surface-subtle': `color-mix(in srgb, ${palette.canvas} 60%, ${palette.surface})`,
    '--app-nav-ink': palette.text,
    '--app-nav-active': `color-mix(in srgb, ${palette.accent} 20%, ${palette.sidebar})`,
    '--app-nav-hover': `color-mix(in srgb, ${palette.accent} 10%, ${palette.sidebar})`,
    '--app-selected': `color-mix(in srgb, ${palette.accent} 18%, ${palette.surface})`,
    '--app-soft-line': 'var(--ui-border-muted)',
    '--app-table-heading': palette.sidebar,
    '--app-stack-near': `color-mix(in srgb, ${palette.accent} 8%, ${palette.surface})`,
    '--app-stack-far': `color-mix(in srgb, ${palette.accent} 14%, ${palette.surface})`,
    '--app-code-bg': palette.canvas,
    '--scrollbar-track': palette.canvas,
    '--scrollbar-thumb': `color-mix(in srgb, ${palette.text} 35%, ${palette.canvas})`,
    '--scrollbar-thumb-hover': `color-mix(in srgb, ${palette.text} 50%, ${palette.canvas})`,
    '--scrollbar-thumb-active': palette.accent,
    '--ui-border': `color-mix(in srgb, ${palette.text} ${value.strongContrast ? 65 : value.dividerStrength}%, ${palette.surface})`,
    '--ui-border-muted': `color-mix(in srgb, ${palette.text} ${value.strongContrast ? 55 : value.dividerStrength / 2}%, ${palette.surface})`,
    '--app-selection': palette.selection,
    '--reading-highlight': palette.highlight,
    '--reading-cloze': palette.cloze,
  }
  if (value.font) vars['--font-ui'] = `${value.font}, sans-serif`
  if (value.monoFont) vars['--font-mono'] = `${value.monoFont}, monospace`
  return vars
}
