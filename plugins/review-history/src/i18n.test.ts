import { beforeEach, expect, it, vi } from 'vitest'
import { t } from './i18n'
const boundary = vi.hoisted(() => ({
  locale: { value: 'en' as 'en' | 'zh-CN' },
  fallback: vi.fn((input: string | Error) => (input instanceof Error ? input.message : input)),
}))
vi.mock('@repeaty/plugin-api', () => ({ locale: boundary.locale, t: boundary.fallback }))
beforeEach(() => {
  boundary.locale.value = 'en'
  boundary.fallback.mockClear()
})

it('uses its own English dictionary and follows the host locale without a host message entry', () => {
  expect(t('答题历史')).toBe('Review history')
  expect(t('历史显示')).toBe('History display')
  expect(t('复习时查看当前卡片的评分记录。')).toBe("View the current card's ratings during review.")
  expect(t('显示条数')).toBe('Number of ratings')
  expect(t('开启后，显示答案时再展示历史记录。')).toBe(
    'Show the history only after the answer is revealed.',
  )
  expect(boundary.fallback).not.toHaveBeenCalled()
  boundary.locale.value = 'zh-CN'
  expect(t('答题历史')).toBe('答题历史')
})

it('delegates unknown host messages and errors without replacing their meaning', () => {
  const error = new Error('host storage issue')
  expect(t(error)).toBe('host storage issue')
  expect(boundary.fallback).toHaveBeenCalledWith(error, {})
})
