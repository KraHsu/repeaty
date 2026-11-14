import { expect, it } from 'vitest'
import { en } from './en'
import { interfaceCatalogs, interfaceLocales, interfaceMessageKeys } from './interface-catalogs'
import { translateCatalog } from './locales'

it('has the same nonempty core labels for every additional supported language', () => {
  expect(interfaceLocales).toHaveLength(10)
  expect(interfaceMessageKeys.length).toBeGreaterThanOrEqual(140)
  expect(new Set(interfaceMessageKeys).size).toBe(interfaceMessageKeys.length)
  for (const language of interfaceLocales) {
    const entries = interfaceCatalogs[language]!
    expect(Object.keys(entries)).toEqual(interfaceMessageKeys)
    for (const [key, value] of Object.entries(entries)) {
      expect(Object.hasOwn(en, key), `Unknown source: ${key}`).toBe(true)
      expect(typeof value, `${language}: ${key}`).toBe('string')
      expect(value?.trim().length, `${language}: ${key}`).toBeGreaterThan(0)
      expect(value).not.toMatch(/[<>\u0000-\u0008]/)
    }
  }
})
it('preserves all named parameters and uses the language catalogue before English fallback', () => {
  const placeholders = (value: string) =>
    [...value.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)].map((match) => match[1]).sort()
  for (const language of interfaceLocales) {
    for (const [key, value] of Object.entries(interfaceCatalogs[language]!))
      expect(placeholders(value)).toEqual(placeholders(key))
    expect(
      translateCatalog({ ...interfaceCatalogs, en }, language, '今日已复习 {count} 次', {
        count: 12,
      }),
    ).toContain('12')
    expect(translateCatalog({ ...interfaceCatalogs, en }, language, '插件材料搜索提供方')).toBe(
      '插件材料搜索提供方',
    )
    expect(translateCatalog({ ...interfaceCatalogs, en }, language, '材料搜索提供方')).toBe(
      en.材料搜索提供方,
    )
  }
  expect(translateCatalog(interfaceCatalogs, 'ja', '设置')).toBe('設定')
  expect(translateCatalog(interfaceCatalogs, 'de', '显示答案')).toBe('Antwort anzeigen')
  expect(translateCatalog(interfaceCatalogs, 'fr', '取消')).toBe('Annuler')
  expect(translateCatalog(interfaceCatalogs, 'zh-TW', '数据与备份')).toBe('資料與備份')
})
