import { ref } from 'vue'
import { en } from './en'
import { isLocale, type Locale, type TranslationCatalogs } from './locales'
import { readSetting, persistSetting } from '../settings-store'
export const LANGUAGE_PACKS_KEY = 'repeaty.language-packs.v1'
export const languagePacks = ref<TranslationCatalogs>({})
export interface LanguagePack {
  version: 1
  locale: Locale
  messages: Record<string, string>
}
function placeholders(value: string) {
  return [...value.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)]
    .map((match) => match[1])
    .sort()
    .join('|')
}
export function parseLanguagePack(text: string): LanguagePack {
  if (text.length > 2_000_000) throw new Error('语言包过大。')
  const data = JSON.parse(text)
  if (
    !data ||
    data.version !== 1 ||
    !isLocale(data.locale) ||
    !data.messages ||
    typeof data.messages !== 'object' ||
    Array.isArray(data.messages)
  )
    throw new Error('语言包格式无效。')
  const messages: Record<string, string> = Object.create(null)
  for (const [key, value] of Object.entries(data.messages)) {
    if (!Object.hasOwn(en, key)) throw new Error('语言包包含未知的消息。')
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > 20000 ||
      placeholders(value) !== placeholders(key)
    )
      throw new Error('译文为空或占位符不匹配。')
    messages[key] = value
  }
  return { version: 1, locale: data.locale, messages }
}
let generation = 0
export function restoreLanguagePacks() {
  generation++
  const next: TranslationCatalogs = {}
  try {
    const raw = JSON.parse(readSetting(LANGUAGE_PACKS_KEY) ?? '{}')
    for (const [locale, messages] of Object.entries(raw)) {
      const pack = parseLanguagePack(JSON.stringify({ version: 1, locale, messages }))
      next[pack.locale] = pack.messages
    }
  } catch {
    /* Invalid packs never prevent a library from opening. */
  }
  languagePacks.value = next
}
export async function saveLanguagePack(pack: LanguagePack) {
  const validated = parseLanguagePack(JSON.stringify(pack)),
    expected = generation
  const next = { ...languagePacks.value, [pack.locale]: validated.messages }
  await persistSetting(LANGUAGE_PACKS_KEY, JSON.stringify(next))
  if (expected === generation) languagePacks.value = next
}
export async function removeLanguagePack(locale: Locale) {
  const expected = generation,
    next = { ...languagePacks.value }
  delete next[locale]
  await persistSetting(LANGUAGE_PACKS_KEY, JSON.stringify(next))
  if (expected === generation) languagePacks.value = next
}
