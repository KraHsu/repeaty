import { locale, t as hostText } from '@repeaty/plugin-api'
import english from './locales/en.json'

export { locale }
const messages: Readonly<Record<string, string>> = english
export function t(
  input: string | Error,
  params: Record<string, string | number | undefined> = {},
): string {
  const key = input instanceof Error ? input.message : input
  const translated = Object.hasOwn(messages, key) ? messages[key] : undefined
  if (locale.value !== 'en' || !translated) return hostText(input, params)
  return translated.replace(/(?<!\{)\{(\w+)\}(?!\})/g, (placeholder, name: string) => {
    const value = Object.hasOwn(params, name) ? params[name] : undefined
    return value === undefined
      ? placeholder
      : typeof value === 'number'
        ? new Intl.NumberFormat(locale.value).format(value)
        : value
  })
}
