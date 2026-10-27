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
  expect(t('显示最近几次评分')).toBe('Number of recent ratings')
  expect(boundary.fallback).not.toHaveBeenCalled()
  boundary.locale.value = 'zh-CN'
  expect(t('答题历史')).toBe('答题历史')
})

it('delegates unknown host messages and errors without replacing their meaning', () => {
  const error = new Error('host storage issue')
  expect(t(error)).toBe('host storage issue')
  expect(boundary.fallback).toHaveBeenCalledWith(error, {})
})
