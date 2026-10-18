import { test, expect } from './fixture'
import type { BrowserContext, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const question = {
  questionId: '1',
  questionFrontendId: '1',
  title: 'Test problem',
  titleSlug: 'test-problem',
  translatedTitle: '测试题目',
  difficulty: 'Easy',
  isPaidOnly: false,
  content: '<p>Return the input value.</p>',
  translatedContent:
    '<p>返回输入值。</p><pre>输入：1\n输出：1</pre><p>' +
    '长题面示例。'.repeat(80) +
    '</p><script>throw Error("unsafe statement")</script>',
  codeSnippets: [
    { lang: 'Python3', langSlug: 'python3', code: 'def solve(value):\n    pass' },
    { lang: 'JavaScript', langSlug: 'javascript', code: 'function solve(value) {\n}' },
  ],
}
async function connect(
  context: BrowserContext,
  options: {
    site?: string
    rejectFirst?: boolean
    checkFails?: boolean
    submitFails?: boolean
  } = {},
) {
  const site = options.site ?? 'leetcode.cn'
  let submissions = 0
  let checkFails = options.checkFails ?? false
  const sent: unknown[] = []
  await context.route('**/api/plugins/leetcode', async (route) => {
    const request = route.request().postDataJSON()
    if (request.action !== 'ping') expect(request.site).toBe(site)
    if (request.action === 'ping') await route.fulfill({ json: { version: 1 } })
    else if (request.action === 'question') {
      expect(request.slug).toBe('test-problem')
      await route.fulfill({ json: { data: { question } } })
    } else if (request.action === 'submit') {
      submissions++
      sent.push(request)
      if (options.submitFails)
        await route.fulfill({ status: 502, json: { error: 'submission-unknown' } })
      else await route.fulfill({ json: { submission_id: 1000 + submissions } })
    } else if (request.action === 'check') {
      if (checkFails) await route.fulfill({ status: 502, json: { error: 'request-failed' } })
      else
        await route.fulfill({
          json: {
            state: 'SUCCESS',
            status_code: options.rejectFirst && submissions === 1 ? 11 : 10,
            status_runtime: '1 ms',
            status_memory: '10 MB',
          },
        })
    } else throw new Error('Unexpected LeetCode operation')
  })
  return {
    sent,
    submissions: () => submissions,
    allowChecks: () => {
      checkFails = false
    },
  }
}
async function create(page: Page, site = 'leetcode.cn') {
  await page.goto('./')
  await page.getByRole('button', { name: '创建卡组', exact: true }).last().click()
  await page.getByLabel('卡组名称').fill('Algorithms')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  await page.getByLabel('笔记类型').selectOption('plugin')
  await expect(page.getByLabel('LeetCode 站点')).toHaveValue('leetcode.cn')
  await page.getByLabel('LeetCode 站点').selectOption(site)
  await page.getByLabel('题目链接或英文标识').fill('test-problem')
  await page.getByRole('button', { name: '读取题目', exact: true }).click()
  await expect(page.getByText(/已读取：1\./)).toBeVisible()
  await page.getByLabel('解题笔记').fill('Return the value unchanged.')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect(page.getByLabel('代码', { exact: true })).toBeEnabled()
}

test('backend transport loads, judges, restores drafts, and saves an automatic rating', async ({
  context,
}) => {
  const remote = await connect(context, { rejectFirst: true })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await create(page)
  await page.getByLabel('代码', { exact: true }).fill('def solve(value):\n    return 0')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.judge-result')).toContainText('答案错误')
  await expect(page.getByText('自动评分：重来', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await expect(page.getByLabel('代码', { exact: true })).toHaveValue(
    'def solve(value):\n    return 0',
  )
  await expect(page.getByText(/尝试 1 次/)).toBeVisible()
  await page.getByLabel('代码', { exact: true }).fill('def solve(value):\n    return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  await page.getByLabel('复习评分').selectOption('automatic')
  await page.getByRole('button', { name: '结束作答并查看答案' }).click()
  await expect(page.getByText('Return the value unchanged.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存评分：良好' })).toBeEnabled()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/leetcode-mobile.png', fullPage: true })
  await page.getByRole('button', { name: '保存评分：良好' }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出旧版 JSON' }).click()
  const backup = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'))
  expect(backup.library.reviews[0]).toMatchObject({
    rating: 3,
    assessment: {
      attempts: 2,
      pluginId: 'leetcode',
      mode: 'automatic',
      outcome: 'accepted',
      submissionId: '1002',
      suggestedGrade: 3,
    },
  })
  expect(backup.library.notes[0].plugin.data.site).toBe('leetcode.cn')
  expect(JSON.stringify(backup)).not.toContain('test-csrf')
  expect(remote.submissions()).toBe(2)
  expect(remote.sent[1]).toMatchObject({
    action: 'submit',
    site: 'leetcode.cn',
    lang: 'python3',
    questionId: '1',
    code: 'def solve(value):\n    return value',
  })
  expect(errors).toEqual([])
})

test('international site, English, manual rating, and pending judge recovery do not resubmit', async ({
  context,
}) => {
  const remote = await connect(context, { site: 'leetcode.com', checkFails: true })
  const page = await context.newPage()
  await create(page, 'leetcode.com')
  await page.getByLabel('界面语言').selectOption('en')
  await expect(page.getByRole('heading', { name: '1. Test problem' })).toBeVisible()
  await page.getByLabel('Programming language').selectOption('javascript')
  await page.getByLabel('Code', { exact: true }).fill('function solve(value) { return value; }')
  await page.getByRole('button', { name: 'Submit to LeetCode' }).click()
  await expect(page.getByRole('alert')).toContainText('The service cannot connect to LeetCode')
  await expect(page.getByRole('button', { name: 'Submit to LeetCode' })).toBeDisabled()
  await page.reload()
  remote.allowChecks()
  await page.getByRole('button', { name: 'Start review', exact: true }).click()
  await expect(page.locator('.judge-result')).toContainText('Accepted')
  await expect(page.getByText(/Attempts: 1/)).toBeVisible()
  await page.getByRole('button', { name: 'Finish attempt and show answer' }).click()
  await page.screenshot({ path: 'test-results/leetcode-desktop-en.png', fullPage: true })
  await page.getByRole('button', { name: /^Hard/ }).click()
  await expect(page.getByRole('heading', { name: 'Review session finished' })).toBeVisible()
  expect(remote.submissions()).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('repeaty.leetcode.site'))).toBe(
    'leetcode.com',
  )
})

test('an unavailable judge service is reported without creating a placeholder question', async ({
  page,
}) => {
  await page.route('**/api/plugins/leetcode', (route) =>
    route.fulfill({ status: 502, json: { error: 'request-failed' } }),
  )
  await page.goto('./')
  await page.getByRole('button', { name: '创建卡组', exact: true }).last().click()
  await page.getByLabel('卡组名称').fill('Algorithms')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  await page.getByLabel('笔记类型').selectOption('plugin')
  await page.getByLabel('题目链接或英文标识').fill('test-problem')
  await page.getByRole('button', { name: '读取题目', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('服务无法连接 LeetCode')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('active solving time affects automatic ratings and supports pausing', async ({ context }) => {
  await connect(context)
  const page = await context.newPage()
  await page.clock.install()
  await create(page)
  await page.clock.fastForward(11 * 60000)
  await expect(page.getByText(/用时 11:00/)).toBeVisible()
  await page.getByRole('button', { name: '暂停计时' }).click()
  await page.clock.fastForward(5 * 60000)
  await expect(page.getByText(/用时 11:00/)).toBeVisible()
  await page.getByRole('button', { name: '继续计时' }).click()
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  await expect(page.getByText('自动评分：良好', { exact: true })).toBeVisible()
})

test('viewing the answer before acceptance prevents a passing review rating', async ({
  context,
}) => {
  await connect(context)
  const page = await context.newPage()
  await create(page)
  await page.getByRole('button', { name: '结束作答并查看答案' }).click()
  await expect(page.getByRole('button', { name: /^良好/ })).toBeDisabled()
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  await expect(page.getByRole('button', { name: /^良好/ })).toBeDisabled()
  await page.getByLabel('复习评分').selectOption('automatic')
  await expect(page.getByRole('button', { name: '保存评分：重来' })).toBeEnabled()
})

test('a lost submission response disables automatic ratings and survives reload', async ({
  context,
}) => {
  const remote = await connect(context, { submitFails: true })
  const page = await context.newPage()
  await create(page)
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.getByText(/有一次提交未取得编号/)).toBeVisible()
  await expect(page.getByText(/尝试 0 次/)).toBeVisible()
  expect(remote.submissions()).toBe(1)
  await page.reload()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await expect(page.getByText(/有一次提交未取得编号/)).toBeVisible()
  await expect(page.locator('#leetcode-rating option[value="automatic"]')).toBeDisabled()
  expect(remote.submissions()).toBe(1)
})

test('plugin switches persist across tabs without changing questions or progress', async ({
  page,
  context,
  request,
}) => {
  await connect(context)
  await create(page)
  const { headers } = await import('./fixture')
  const before = await (await request.get('api/library', { headers })).json()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  const other = await context.newPage()
  await other.goto('./')
  await other.getByRole('button', { name: '插件', exact: true }).click()
  await expect(other.getByRole('switch', { name: '启用 LeetCode' })).toBeChecked()
  await page.getByRole('switch', { name: '启用 LeetCode' }).click()
  await expect(other.getByRole('switch', { name: '启用 LeetCode' })).not.toBeChecked()
  await page.reload()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await expect(page.getByRole('switch', { name: '启用 LeetCode' })).not.toBeChecked()
  await page.getByRole('button', { name: '全部卡片' }).click()
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect(page.getByLabel('代码', { exact: true })).toHaveCount(0)
  expect(await (await request.get('api/library', { headers })).json()).toEqual(before)
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByRole('switch', { name: '启用 LeetCode' }).click()
  await page.getByRole('button', { name: '全部卡片' }).click()
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect(page.getByLabel('代码', { exact: true })).toBeVisible()
})
