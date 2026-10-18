import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { en } from './en'
import { detectLocale, duration, initI18n, locale, LOCALE_STORAGE_KEY, msg, setLocale, t } from '.'
import { parseNoteImport } from '../core/batch'
import { parseBackup, exportBackup } from '../core/backups'
import { insertCloze } from '../core/authoring'
import { renderMarkdown } from '../core/content'
import { fixture, now } from '../core/test-fixtures'
import { cardStatus, saveSearch, searchCards } from '../core/search'
import { intervalLabel, reviewCard, weekActivity } from '../core/scheduler'
import { sampleLibrary } from '../core/sample'
import { cardViews } from '../core/model'

// Default core fixtures use Chinese; explicit switches exercise English independently.
afterEach(() => {
  setLocale('zh-CN')
  vi.unstubAllGlobals()
})

describe('locale preferences', () => {
  it.each([
    ['en', ['zh-CN'], 'en'],
    ['zh-CN', ['en-US'], 'zh-CN'],
    [null, ['en-GB'], 'en'],
    [null, ['zh-SG'], 'zh-CN'],
    [null, ['zh-Hans-CN'], 'zh-CN'],
    [null, ['zh-TW'], 'zh-CN'],
    ['invalid', ['fr-FR', 'en-US', 'zh-CN'], 'en'],
    [null, ['ja-JP', 'zh-CN'], 'zh-CN'],
    [null, ['de-DE'], 'en'],
    [null, [], 'en'],
  ] as const)('resolves %s / %s to %s', (saved, languages, expected) => {
    expect(detectLocale(saved, languages)).toBe(expected)
  })
  it('uses browser preferences without writing a manual preference, then persists an override', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('navigator', { languages: ['en-AU'] })
    initI18n()
    expect(locale.value).toBe('en')
    expect(storage.setItem).not.toHaveBeenCalled()
    setLocale('zh-CN')
    expect(values.get(LOCALE_STORAGE_KEY)).toBe('zh-CN')
    initI18n()
    expect(locale.value).toBe('zh-CN')
  })
  it('works when browser storage is blocked or a saved preference is corrupt', () => {
    vi.stubGlobal('navigator', { languages: ['en-US'] })
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    })
    expect(() => initI18n()).not.toThrow()
    expect(locale.value).toBe('en')
    expect(() => setLocale('zh-CN')).not.toThrow()
    expect(t('保存卡片')).toBe('保存卡片')
    vi.stubGlobal('localStorage', { getItem: () => 'corrupted' })
    initI18n()
    expect(locale.value).toBe('en')
  })
})

describe('messages and data isolation', () => {
  it('retains matching interpolation parameters in every English message', () => {
    const params = (text: string) =>
      [...text.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)].map((match) => match[1]).sort()
    for (const [source, translation] of Object.entries(en)) {
      expect(translation.trim(), source).not.toBe('')
      expect(params(translation), source).toEqual(params(source))
    }
  })
  it('reactively retranslates errors and notices while preserving literal user parameters', () => {
    let error: Error
    try {
      insertCloze('test', 0, 0)
    } catch (issue) {
      error = issue as Error
    }
    const visible = computed(() => t(error))
    expect(visible.value).toContain('选中')
    setLocale('en')
    expect(visible.value).toBe('Select text on the front to turn into a cloze.')
    const name = '<img src=x> $& {count} 中文'
    expect(t(msg('打开卡组 {p0}', { p0: name }))).toBe(`Open deck ${name}`)
    expect(t('法国的首都是 {{c1::巴黎::城市}}。')).toContain('{{c1::Paris::city}}')
    expect(() => parseBackup('{')).toThrow('not valid JSON')
    setLocale('zh-CN')
    expect(visible.value).toContain('选中')
    expect(() => parseBackup('{')).toThrow('不是有效的 JSON')
  })
  it('keeps nested CSV validation errors translatable after creation', () => {
    setLocale('en')
    let error: Error | undefined
    try {
      parseNoteImport('type,front,back\ncloze,{{c1::broken,', 'deck', ',')
    } catch (issue) {
      error = issue as Error
    }
    expect(error?.message).toContain('Row 2: Use {{c1::answer}}')
    setLocale('zh-CN')
    expect(error?.message).toContain('第 2 行：挖空格式应为')
    expect(t('constructor')).toBe('constructor')
    expect(t('{__proto__}')).toBe('{__proto__}')
  })
  it('uses localized interval units, plural forms, and weekday labels', () => {
    setLocale('en')
    expect(intervalLabel(now, now)).toBe('1 minute')
    expect(duration(2, 'minute')).toBe('2 minutes')
    expect(duration(1, 'hour')).toBe('1 hour')
    expect(duration(2, 'day')).toBe('2 days')
    const english = weekActivity(fixture(), now).map((day) => day.label)
    expect(english).toContain('Sat')
    setLocale('zh-CN')
    expect(intervalLabel(now, now)).toBe('1分钟')
    expect(weekActivity(fixture(), now).map((day) => day.label)).toContain('周六')
  })
  it('keeps saved filters, review progress, and backup data identical across locale changes', async () => {
    let library = saveSearch(
      fixture({ front: '学习空间', back: '中文答案', tags: ['学习中'] }),
      { query: 'tag:学习中', state: '新卡片', deckId: 'deck' },
      '我的筛选',
    )
    const before = await exportBackup(library, async () => undefined)
    setLocale('en')
    expect(searchCards(library, library.savedSearches[0]!, now)).toHaveLength(1)
    expect(cardStatus(cardViews(library)[0]!, now)).toBe('新卡片')
    expect(t(cardStatus(cardViews(library)[0]!, now))).toBe('New')
    expect(JSON.parse(await exportBackup(library, async () => undefined)).library).toEqual(
      JSON.parse(before).library,
    )
    const englishReview = reviewCard(library, library.cards[0]!.id, 3, now)
    setLocale('zh-CN')
    library = reviewCard(library, library.cards[0]!.id, 3, now)
    expect(library.cards).toEqual(englishReview.cards)
    expect(library.notes[0]!.front).toBe('学习空间')
    expect(library.notes[0]!.tags).toEqual(['学习中'])
  })
  it('creates samples in the chosen language without translating an existing sample', () => {
    setLocale('en')
    const sample = sampleLibrary()
    expect(sample.decks[0]!.name).toBe('Learning how to learn')
    expect(sample.notes[0]!.front).toBe('What is active recall?')
    setLocale('zh-CN')
    expect(sample.decks[0]!.name).toBe('Learning how to learn')
    expect(sampleLibrary().decks[0]!.name).toBe('学习如何学习')
  })
  it('localizes media placeholders while escaping inserted content', () => {
    setLocale('en')
    const html = renderMarkdown('![<script>alert(1)</script>](https://example.org/a.png)')
    expect(html).toContain('Use an attachment')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
  })
})
