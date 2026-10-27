import { test, expect, storedLibrary } from './fixture'
import type { Locator } from '@playwright/test'
import { openPluginSettings, setInterfaceLanguage } from '../fixtures/settings-flow'

async function save(region: Locator) {
  await region.getByLabel('LEETCODE_SESSION', { exact: true }).fill('account-test-session')
  await region.getByLabel('csrftoken', { exact: true }).fill('account-test-csrf')
  await region.getByRole('button', { name: '保存登录信息', exact: true }).click()
  await expect(region.getByText('登录信息已保存在本机。', { exact: true })).toBeVisible()
}

test('verification distinguishes expired sessions, website checks, network failures and malformed replies', async ({
  page,
  context,
}) => {
  let mode = 'expired'
  await context.route('**/__native/leetcode', async (route) => {
    const request = route.request().postDataJSON()
    if (request.action !== 'account' || request.site !== 'leetcode.cn') return route.fallback()
    if (['verification-required', 'request-failed', 'rate-limit'].includes(mode))
      return route.fulfill({ status: 503, json: { error: mode } })
    return route.fulfill({
      json: {
        site: mode === 'wrong-site' ? 'leetcode.com' : request.site,
        state: mode === 'expired' ? 'expired' : 'authenticated',
        ...(mode === 'malformed' ? {} : { username: '<img src=x onerror=alert(1)>' }),
      },
    })
  })
  await openPluginSettings(page)
  const cn = page.getByRole('region', { name: '中国站 · leetcode.cn', exact: true })
  const com = page.getByRole('region', { name: '国际站 · leetcode.com', exact: true })
  const before = await storedLibrary(page)
  await save(cn)
  await expect(cn.getByRole('status')).toContainText('登录已失效')
  await expect(cn.getByRole('alert')).toContainText('登录信息无效或已过期')
  await expect(cn.getByLabel('LEETCODE_SESSION', { exact: true })).toHaveValue('')
  await expect(cn.getByRole('button', { name: '清除登录信息', exact: true })).toBeVisible()
  for (const [state, label, message] of [
    ['verification-required', '需要网页验证', '力扣要求额外验证'],
    ['request-failed', '网络连接异常', '已保存的登录信息仍然保留'],
    ['rate-limit', '验证暂时受限', '限制验证请求'],
    ['malformed', '尚未确认登录状态', '无法识别力扣返回的验证结果'],
    ['wrong-site', '尚未确认登录状态', '无法识别力扣返回的验证结果'],
  ]) {
    mode = state!
    await cn.getByRole('button', { name: '刷新状态' }).click()
    await expect(cn.getByRole('status')).toContainText(label!)
    await expect(cn.getByRole('alert')).toContainText(message!)
    await expect(cn.locator('.connection-account')).toHaveCount(0)
    await expect(cn.getByRole('button', { name: '清除登录信息', exact: true })).toBeVisible()
    await expect(com.getByRole('status')).toContainText('未配置登录信息')
  }
  // Saving succeeded even though verification failed; retry requires no cookie re-entry.
  mode = 'authenticated'
  await cn.getByRole('button', { name: '刷新状态' }).click()
  await expect(cn.getByRole('status')).toContainText('登录有效')
  await expect(cn.locator('.connection-account')).toHaveText(
    '当前账号：<img src=x onerror=alert(1)>',
  )
  await expect(cn.locator('.connection-account img')).toHaveCount(0)
  expect(await storedLibrary(page)).toEqual(before)
  await setInterfaceLanguage(page, 'en')
  await openPluginSettings(page)
  const english = page.getByRole('region', { name: 'China · leetcode.cn', exact: true })
  mode = 'verification-required'
  await english.getByRole('button', { name: 'Refresh status' }).click()
  await expect(english.getByRole('status')).toContainText('Website verification required')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/account-status-mobile-en.png', fullPage: true })
})

test('clearing credentials while verification is pending discards the late account result', async ({
  page,
  context,
}) => {
  await openPluginSettings(page)
  const cn = page.getByRole('region', { name: '中国站 · leetcode.cn', exact: true })
  await save(cn)
  await expect(cn.getByRole('status')).toContainText('登录有效')
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started!: () => void
  const arrived = new Promise<void>((resolve) => {
    started = resolve
  })
  await context.route('**/__native/leetcode', async (route) => {
    const request = route.request().postDataJSON()
    if (request.action !== 'account' || request.site !== 'leetcode.cn') return route.fallback()
    started()
    await gate
    await route.fulfill({
      json: { site: 'leetcode.cn', state: 'authenticated', username: 'late-old-account' },
    })
  })
  const response = page.waitForResponse(
    (reply) =>
      reply.url().endsWith('/__native/leetcode') &&
      reply.request().postDataJSON().action === 'account',
  )
  try {
    await cn.getByRole('button', { name: '刷新状态' }).click()
    await arrived
    await expect(cn.getByRole('status')).toContainText('正在验证登录')
    await expect(cn.locator('.connection-account')).toHaveCount(0)
    await cn.getByRole('button', { name: '清除登录信息', exact: true }).click()
    await cn.getByRole('button', { name: '确认清除', exact: true }).click()
    await expect(cn.getByRole('status')).toContainText('未配置登录信息')
  } finally {
    release()
  }
  await response
  await expect(cn.getByRole('status')).toContainText('未配置登录信息')
  await expect(page.getByText('late-old-account', { exact: false })).toHaveCount(0)
})

test('changing sites during verification clears cookie drafts and ignores the previous site account', async ({
  page,
  context,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: '创建卡组', exact: true }).last().click()
  await page.getByLabel('卡组名称').fill('Account checks')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  await page.getByLabel('笔记类型').selectOption('plugin')
  const cn = page.getByRole('region', { name: '中国站 · leetcode.cn', exact: true })
  const com = page.getByRole('region', { name: '国际站 · leetcode.com', exact: true })
  await save(cn)
  await expect(cn.getByRole('status')).toContainText('登录有效')
  await page.getByLabel('LeetCode 站点').selectOption('leetcode.com')
  await save(com)
  await expect(com.getByRole('status')).toContainText('登录有效')
  await page.getByLabel('LeetCode 站点').selectOption('leetcode.cn')
  await expect(cn.getByRole('status')).toContainText('登录有效')
  let release!: () => void, started!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const arrived = new Promise<void>((resolve) => {
    started = resolve
  })
  await context.route('**/__native/leetcode', async (route) => {
    const request = route.request().postDataJSON()
    if (request.action !== 'account' || request.site !== 'leetcode.cn') return route.fallback()
    started()
    await gate
    await route.fulfill({
      json: { site: request.site, state: 'authenticated', username: 'stale-cn-account' },
    })
  })
  const response = page.waitForResponse(
    (reply) =>
      reply.url().endsWith('/__native/leetcode') &&
      reply.request().postDataJSON().action === 'account' &&
      reply.request().postDataJSON().site === 'leetcode.cn',
  )
  try {
    await cn.getByRole('button', { name: '刷新状态' }).click()
    await arrived
    await cn.getByLabel('LEETCODE_SESSION', { exact: true }).fill('unsaved-private-cookie')
    await page.getByLabel('LeetCode 站点').selectOption('leetcode.com')
    await expect(com.getByRole('status')).toContainText('登录有效')
    await expect(com.locator('.connection-account')).toHaveText('当前账号：tester-com')
    await expect(com.getByLabel('LEETCODE_SESSION', { exact: true })).toHaveValue('')
    await expect(com.getByLabel('csrftoken', { exact: true })).toHaveValue('')
  } finally {
    release()
  }
  await response
  await expect(com.locator('.connection-account')).toHaveText('当前账号：tester-com')
  await expect(page.getByText('stale-cn-account', { exact: false })).toHaveCount(0)
})
