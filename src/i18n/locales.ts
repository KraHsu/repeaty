/** BCP-47 tags are also used by Intl and the host-provided component library. */
export const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'zh-TW', label: '中文（繁體）' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'pl', label: 'Polski' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'ru', label: 'Русский' },
] as const
export type Locale = (typeof languageOptions)[number]['value']
export type LanguagePreference = Locale | 'system'
export function isLocale(value: unknown): value is Locale {
  return languageOptions.some((entry) => entry.value === value)
}
export function resolveLocale(value: string): Locale | undefined {
  if (/^zh(?:-|$)/i.test(value))
    return /^zh-(?:tw|hk|mo|hant)(?:-|$)/i.test(value) ? 'zh-TW' : 'zh-CN'
  if (/^pt(?:-|$)/i.test(value)) return 'pt-BR'
  return languageOptions.find((entry) => entry.value === value.toLowerCase().split('-')[0])?.value
}
export type TranslationCatalogs = Partial<Record<Locale, Readonly<Record<string, string>>>>
export function translateCatalog(
  catalogs: TranslationCatalogs,
  language: Locale,
  key: string,
  params: Record<string, string | number | undefined> = {},
  fallback: Locale = 'en',
) {
  const catalog = catalogs[language],
    fallbackCatalog = catalogs[fallback]
  const template =
    (catalog && Object.hasOwn(catalog, key) ? catalog[key] : undefined) ??
    (fallbackCatalog && Object.hasOwn(fallbackCatalog, key) ? fallbackCatalog[key] : undefined) ??
    key
  return template.replace(/(?<!\{)\{(\w+)\}(?!\})/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) && params[name] !== undefined ? String(params[name]) : placeholder,
  )
}
