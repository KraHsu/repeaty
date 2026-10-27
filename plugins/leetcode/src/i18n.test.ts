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

it('translates plugin errors and interpolates values without translating saved user text', () => {
  expect(t(new Error('LeetCode 登录已过期或需要验证，请更新本机的登录信息。'))).toContain(
    'session has expired',
  )
  expect(t('尝试 {count} 次 · 用时 {time}', { count: 1234, time: '0:01' })).toBe(
    'Attempts: 1,234 · Time: 0:01',
  )
  expect(t('已读取：{title}', { title: '{{c1::中文}}' })).toContain('{{c1::中文}}')
  expect(boundary.fallback).not.toHaveBeenCalled()
})

it('responds to language switches and delegates unknown messages to the SDK', () => {
  expect(t('LeetCode 站点')).toBe('LeetCode site')
  boundary.locale.value = 'zh-CN'
  expect(t('LeetCode 站点')).toBe('LeetCode 站点')
  boundary.locale.value = 'en'
  expect(t('unknown host message')).toBe('unknown host message')
  expect(boundary.fallback).toHaveBeenLastCalledWith('unknown host message', {})
})
