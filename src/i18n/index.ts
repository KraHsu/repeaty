import { readonly, ref } from 'vue'
import { ZodError } from 'zod'
import { en } from './en'

export type Locale = 'en' | 'zh-CN'
export type MessageKey = keyof typeof en
export type Message = {
  key: MessageKey
  params: Record<string, string | number | Message | undefined>
}
export type DisplayMessage = string | Message | Error
export const LOCALE_STORAGE_KEY = 'repeaty.locale'
const currentLocale = ref<Locale>('zh-CN')
export const locale = readonly(currentLocale)

export function detectLocale(saved: string | null, languages: readonly string[]): Locale {
  if (saved === 'en' || saved === 'zh-CN') return saved
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return 'zh-CN'
    if (/^en(?:-|$)/i.test(language)) return 'en'
  }
  return 'en'
}

export function msg(key: MessageKey, params: Message['params'] = {}): Message {
  return { key, params }
}

/** Source messages double as the Chinese catalog; unknown legacy labels stay readable. */
export function t(input: DisplayMessage, params: Message['params'] = {}): string {
  if (input instanceof LocalizedError) return t(input.detail)
  if (input instanceof ZodError) return t(validationMessage(input))
  if (input instanceof Error) return t(input.message)
  const key = typeof input === 'string' ? input : input.key
  if (typeof input !== 'string') params = input.params
  const english = Object.hasOwn(en, key) ? en[key as MessageKey] : undefined
  const template = currentLocale.value === 'en' && english ? english : key
  // Only named placeholders are interpolated. Cloze braces and inserted user text stay literal.
  return template.replace(/(?<!\{)\{(\w+)\}(?!\})/g, (placeholder, name: string) => {
    const value = Object.hasOwn(params, name) ? params[name] : undefined
    if (value === undefined) return placeholder
    return typeof value === 'object' ? t(value) : typeof value === 'number' ? number(value) : value
  })
}

export function number(value: number): string {
  return new Intl.NumberFormat(currentLocale.value).format(value)
}
export function duration(value: number, unit: 'minute' | 'hour' | 'day'): string {
  return new Intl.NumberFormat(currentLocale.value, {
    style: 'unit',
    unit,
    unitDisplay: 'long',
  }).format(value)
}

export class LocalizedError extends Error {
  constructor(readonly detail: Message) {
    super()
    this.name = 'LocalizedError'
    Object.defineProperty(this, 'message', { configurable: true, get: () => t(this.detail) })
  }
}

export function validationMessage(error: ZodError): Message {
  const issue = error.issues[0]
  if (issue?.code === 'custom' && issue.params?.i18n) return issue.params.i18n as Message
  if (issue?.code === 'custom' && Object.hasOwn(en, issue.message))
    return msg(issue.message as MessageKey)
  return msg('字段「{field}」格式不正确，请检查必填内容和取值范围。', {
    field: issue?.path.join('.') || msg('内容'),
  })
}

function updateDocument() {
  if (typeof document === 'undefined') return
  document.documentElement.lang = currentLocale.value
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (manifest)
    manifest.href = manifest.href.replace(
      /manifest(?:\.en)?\.webmanifest$/,
      currentLocale.value === 'en' ? 'manifest.en.webmanifest' : 'manifest.webmanifest',
    )
  document.title = `repeaty · ${t('每一次回想，都算数')}`
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', t('Repeaty，专注卡片与间隔复习的个人学习空间。'))
}
export function setLocale(value: Locale) {
  currentLocale.value = value
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, value)
  } catch {
    /* Language still works without storage. */
  }
  updateDocument()
}
export function initI18n() {
  let saved: string | null = null
  try {
    saved = localStorage.getItem(LOCALE_STORAGE_KEY)
  } catch {
    /* Fall back to browser preferences. */
  }
  currentLocale.value = detectLocale(
    saved,
    typeof navigator === 'undefined' ? [] : navigator.languages,
  )
  updateDocument()
}
