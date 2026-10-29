import { expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import {
  buildSettingsCategories,
  collectSettingsCategoryEntries,
  validateSettingsCategoryPath,
} from './categories'
import type { SettingsCategory, SettingsContribution, SettingsEntry } from './types'

const category = (id: string, title = id): SettingsCategory => ({ id, title })
function entry(ownerId: string, path?: readonly SettingsCategory[], id = ownerId): SettingsEntry {
  return {
    ownerId,
    contribution: { id, title: ownerId, category: path, component: {} },
    scope: 'workspace-one',
    isCurrent: vi.fn(() => true),
  }
}

it('merges application and plugin contributions by subject rather than owner', () => {
  const app = entry('application', [category('reading', '阅读')])
  const plugin = {
    ...entry('reading-plugin', [category('reading', 'Plugin reading')]),
    pluginId: 'reading-plugin',
  }
  const nodes = buildSettingsCategories([app, plugin])
  expect(nodes).toHaveLength(1)
  expect(nodes[0]!.key).toBe('reading')
  expect(nodes[0]!.title).toBe('阅读')
  expect(nodes[0]!.entries).toEqual([app, plugin])
  expect(nodes[0]!.entries[0]).toBe(app)
  expect(nodes[0]!.entries[1]!.contribution).toBe(plugin.contribution)
  expect(app.isCurrent).not.toHaveBeenCalled()
})

it('builds subcategories with stable first-seen ordering and keeps direct entries separate', () => {
  const article = entry('article-plugin', [category('reading'), category('articles')])
  const general = entry('appearance', [category('general')])
  const rootReading = entry('reading', [category('reading')])
  const books = entry('books', [category('reading'), category('books')])
  const laterArticle = entry('annotations', [category('reading'), category('articles')])
  const nodes = buildSettingsCategories([article, general, rootReading, books, laterArticle])
  expect(nodes.map(({ key }) => key)).toEqual(['reading', 'general'])
  expect(nodes[0]!.entries).toEqual([rootReading])
  expect(nodes[0]!.children.map(({ key }) => key)).toEqual(['reading.articles', 'reading.books'])
  expect(nodes[0]!.children[0]!.entries).toEqual([article, laterArticle])
  expect(collectSettingsCategoryEntries(nodes[0]!)).toEqual([
    rootReading,
    article,
    laterArticle,
    books,
  ])
})

it('places contributions without category metadata in general, including legacy custom views', () => {
  const legacy = entry('legacy')
  const explicit = entry('app', [category('general', 'General')])
  const nodes = buildSettingsCategories([legacy, explicit], [category('general', '通用')])
  expect(nodes.map(({ key }) => key)).toEqual(['general'])
  expect(nodes[0]!.title).toBe('通用')
  expect(nodes[0]!.entries).toEqual([legacy, explicit])
  expect(buildSettingsCategories([legacy])[0]!.key).toBe('general')
})

it('uses canonical full-path labels without overriding unrelated subcategory titles', () => {
  const contribution = entry('plugin', [
    category('reading', 'Plugin root'),
    category('sources', 'Plugin sources'),
  ])
  const nodes = buildSettingsCategories([contribution], undefined, {
    reading: '阅读',
    'reading.sources': '学习材料',
  })
  expect(nodes[0]!.title).toBe('阅读')
  expect(nodes[0]!.children[0]!.title).toBe('学习材料')
  const inheritedName = buildSettingsCategories([
    entry('constructor-plugin', [category('constructor', 'Construction')]),
  ])
  expect(inheritedName[0]!.title).toBe('Construction')
})

it('rebuilds after contribution removal without retaining empty categories or mutating inputs', () => {
  const removed = entry('one', [category('reading'), category('articles')])
  const kept = entry('two', [category('general')])
  const before = buildSettingsCategories([removed, kept])
  const after = buildSettingsCategories([kept])
  expect(before.map(({ key }) => key)).toEqual(['reading', 'general'])
  expect(after.map(({ key }) => key)).toEqual(['general'])
  expect(buildSettingsCategories([])).toEqual([])
  expect(removed.contribution.category?.map(({ id }) => id)).toEqual(['reading', 'articles'])
  expect(kept.isCurrent).not.toHaveBeenCalled()
})

it('preserves category and contribution getter receivers and reactive values', () => {
  const label = ref('Reading')
  const value = ref(7)
  class Category implements SettingsCategory {
    readonly id = 'reading'
    #label = label
    get title() {
      return this.#label.value
    }
  }
  const contribution: SettingsContribution = {
    id: 'display',
    get title() {
      return `${label.value} options`
    },
    category: [new Category()],
    fields: [
      {
        key: 'count',
        label: 'Count',
        type: 'number',
        get modelValue() {
          return value.value
        },
        onChange: vi.fn(),
      },
    ],
  }
  const source: SettingsEntry = {
    ownerId: 'plugin',
    contribution,
    scope: 'workspace-one',
    isCurrent: () => true,
  }
  const nodes = buildSettingsCategories([source])
  const visible = computed(() => [
    nodes[0]!.title,
    nodes[0]!.entries[0]!.contribution.title,
    nodes[0]!.entries[0]!.contribution.fields![0]!.modelValue,
  ])
  expect(visible.value).toEqual(['Reading', 'Reading options', 7])
  label.value = '阅读'
  value.value = 12
  expect(visible.value).toEqual(['阅读', '阅读 options', 12])
  expect(nodes[0]!.entries[0]).toBe(source)
})

it('rejects empty, repeating, overly deep or malformed category paths', () => {
  for (const invalid of [
    [],
    [category('reading'), category('reading')],
    ['one', 'two', 'three', 'four', 'five'].map((id) => category(id)),
    [category('reading.sources')],
    [category('Reading')],
    [category('general', ' ')],
    [{ title: 'Missing id' }],
    [null],
  ]) {
    const path = invalid as unknown as readonly SettingsCategory[]
    expect(() => validateSettingsCategoryPath(path)).toThrow('设置分类路径无效')
    expect(() => buildSettingsCategories([entry('invalid', path)])).toThrow('设置分类路径无效')
  }
})
