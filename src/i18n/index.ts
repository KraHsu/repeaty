import { readSetting, writeSetting } from '../settings-store'
import { readonly, ref } from 'vue'
import { ZodError } from 'zod'
import { en } from './en'
import {
  isLocale,
  resolveLocale,
  translateCatalog,
  type Locale,
  type LanguagePreference,
  type TranslationCatalogs,
} from './locales'
import { languagePacks, restoreLanguagePacks } from './language-packs'
import { interfaceCatalogs } from './interface-catalogs'
export {
  languageOptions,
  isLocale,
  type Locale,
  type LanguagePreference,
  type TranslationCatalogs,
} from './locales'

export type MessageKey = keyof typeof en
export type Message = {
  key: MessageKey
  params: Record<string, string | number | Message | undefined>
}
export type DisplayMessage = string | Message | Error
export const LOCALE_STORAGE_KEY = 'repeaty.locale'
const currentLocale = ref<Locale>('zh-CN')
export const locale = readonly(currentLocale)
const preference = ref<LanguagePreference>('system')
export const languagePreference = readonly(preference)

export function detectLocale(saved: string | null, languages: readonly string[]): Locale {
  if (isLocale(saved)) return saved
  for (const language of languages) {
    const match = resolveLocale(language)
    if (match) return match
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
  const custom = languagePacks.value[currentLocale.value]
  const builtin = interfaceCatalogs[currentLocale.value]
  const template =
    (custom && Object.hasOwn(custom, key) ? custom[key] : undefined) ??
    (builtin && Object.hasOwn(builtin, key) ? builtin[key] : undefined) ??
    (currentLocale.value !== 'zh-CN' && english ? english : key)
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
      currentLocale.value.startsWith('zh') ? 'manifest.webmanifest' : 'manifest.en.webmanifest',
    )
  document.title = `Repeaty · ${t('卡片与间隔复习')}`
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute(
      'content',
      t('使用 Repeaty 创建卡片，通过间隔复习学习。支持图片、音频和离线使用。'),
    )
}
export function setLocale(value: Locale) {
  setLanguagePreference(value)
}
export function setLanguagePreference(value: LanguagePreference) {
  if (value !== 'system' && !isLocale(value)) return
  preference.value = value
  currentLocale.value = detectLocale(
    value,
    typeof navigator === 'undefined' ? [] : navigator.languages,
  )
  try {
    writeSetting(LOCALE_STORAGE_KEY, value)
  } catch {
    /* Language still works without storage. */
  }
  updateDocument()
}
export function initI18n() {
  let saved: string | null = null
  try {
    saved = readSetting(LOCALE_STORAGE_KEY)
  } catch {
    /* Fall back to browser preferences. */
  }
  preference.value = isLocale(saved) ? saved : 'system'
  restoreLanguagePacks()
  currentLocale.value = detectLocale(
    saved,
    typeof navigator === 'undefined' ? [] : navigator.languages,
  )
  updateDocument()
}
export function connectSystemLanguage() {
  const update = () => {
    if (preference.value === 'system') {
      currentLocale.value = detectLocale(null, navigator.languages)
      updateDocument()
    }
  }
  window.addEventListener('languagechange', update)
  return () => window.removeEventListener('languagechange', update)
}
/** Isolated plugin catalogs never replace host text or another plugin's translations. */
export function createTranslator(catalogs: TranslationCatalogs, fallback: Locale = 'en') {
  return (key: string, params: Record<string, string | number | undefined> = {}) =>
    translateCatalog(catalogs, locale.value, key, params, fallback)
}
export function currentLanguagePack() {
  return {
    version: 1 as const,
    locale: locale.value,
    messages: Object.fromEntries(Object.keys(en).map((key) => [key, t(key)])),
  }
}
