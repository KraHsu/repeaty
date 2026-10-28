import { test, expect, storedLibrary } from './fixture'
import type { BrowserContext, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { practiceHistoryFixture } from '../fixtures/practice-history'
import { importReading, readingText } from '../fixtures/reading-flow'
import { startMixed } from '../fixtures/adaptive-mixed-flow'
import {
  openPluginManager,
  openPluginSettings,
  setInterfaceLanguage,
} from '../fixtures/settings-flow'
import { setResponsiveViewport } from '../fixtures/viewport-flow'

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
    recoveryError?: string
    checkError?: string
  } = {},
) {
  const site = options.site ?? 'leetcode.cn'
  let submissions = 0
  let checkFails = options.checkFails ?? false
  const sent: unknown[] = []
  const recovered: unknown[] = []
  let recoveryError = options.recoveryError
  await context.route('**/__native/leetcode', async (route) => {
    const request = route.request().postDataJSON()
    if (request.action !== 'ping') expect(request.site).toBe(site)
    if (request.action === 'ping') await route.fulfill({ json: { version: 1, configured: [site] } })
    else if (request.action === 'account')
      await route.fulfill({ json: { site, state: 'authenticated', username: 'test-learner' } })
    else if (request.action === 'question') {
      expect(request.slug).toBe('test-problem')
      await route.fulfill({ json: { data: { question } } })
    } else if (request.action === 'submit') {
      submissions++
      sent.push(request)
      if (options.submitFails)
        await route.fulfill({ status: 502, json: { error: 'submission-unknown' } })
      else await route.fulfill({ json: { submission_id: 1000 + submissions } })
    } else if (request.action === 'recover') {
      recovered.push(request)
      if (recoveryError) await route.fulfill({ status: 502, json: { error: recoveryError } })
      else await route.fulfill({ json: { submissionId: request.submissionId } })
    } else if (request.action === 'check') {
      if (options.checkError)
        await route.fulfill({ status: 401, json: { error: options.checkError } })
      else if (checkFails) await route.fulfill({ status: 502, json: { error: 'request-failed' } })
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
    recovered,
    submissions: () => submissions,
    allowChecks: () => {
      checkFails = false
      options.checkError = undefined
    },
    failChecks: () => {
      checkFails = true
    },
    allowSubmissions: () => {
      options.submitFails = false
    },
    allowRecovery: () => {
      recoveryError = undefined
    },
  }
}
async function create(page: Page, site = 'leetcode.cn', language: 'zh-CN' | 'en' = 'zh-CN') {
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
  if (language === 'en') {
    // Settings navigation ends review sessions, so select the language before entering one.
    await setInterfaceLanguage(page, language)
    await page.getByRole('button', { name: 'All cards', exact: true }).click()
  }
  await page
    .getByRole('button', { name: language === 'en' ? 'Review' : '复习', exact: true })
    .click()
  await expect(page.getByLabel(language === 'en' ? 'Code' : '代码', { exact: true })).toBeEnabled()
}

test('local transport loads, judges, restores drafts, and saves an automatic rating', async ({
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
  expect(backup.library.practices).toHaveLength(1)
  expect(backup.library.practices[0]).toMatchObject({
    completion: 'review',
    rating: 3,
    reviewId: backup.library.reviews[0].id,
  })
  expect(backup.library.reviews[0].practiceId).toBe(backup.library.practices[0].id)
  expect(backup.library.attempts).toMatchObject([
    {
      code: 'def solve(value):\n    return 0',
      submissionId: '1001',
      status: 'completed',
      result: { outcome: 'rejected' },
    },
    {
      code: 'def solve(value):\n    return value',
      submissionId: '1002',
      status: 'completed',
      result: { outcome: 'accepted' },
    },
  ])
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
  await create(page, 'leetcode.com', 'en')
  await expect(page.getByRole('heading', { name: '1. Test problem' })).toBeVisible()
  await page.getByLabel('Programming language').selectOption('javascript')
  await page.getByLabel('Code', { exact: true }).fill('function solve(value) { return value; }')
  await page.getByRole('button', { name: 'Submit to LeetCode' }).click()
  await expect(page.locator('.leetcode-question > [role="alert"]')).toContainText(
    'Cannot connect to LeetCode',
  )
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
  expect(
    await page.evaluate(async () => {
      const invoke = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
          }
        }
      ).__TAURI_INTERNALS__.invoke
      const { active } = (await invoke('workspace_status')) as { active: { token: string } }
      return invoke('workspace_read', {
        token: active.token,
        request: {
          type: 'value',
          namespace: 'settings',
          id: 'plugin:leetcode:repeaty.leetcode.site',
        },
      })
    }),
  ).toBe('leetcode.com')
})

test('an expired session during judging retains code and the official submission for credential renewal', async ({
  context,
  page,
}) => {
  const remote = await connect(context, { checkError: 'login-required' })
  await create(page)
  const before = await storedLibrary(page)
  const code = 'def solve(value): return value'
  await page.getByLabel('代码', { exact: true }).fill(code)
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  const cn = page.getByRole('region', { name: '中国站 · leetcode.cn', exact: true })
  await expect(cn.getByRole('status')).toContainText('登录已失效')
  await expect(cn.locator('.connection-account')).toHaveCount(0)
  await expect(page.getByLabel('代码', { exact: true })).toHaveValue(code)
  await expect(page.getByRole('button', { name: '继续查询结果', exact: true })).toBeEnabled()
  const pending = await storedLibrary(page)
  expect(pending.attempts).toMatchObject([
    { value: { status: 'pending', submissionId: '1001', code } },
  ])
  await cn.getByLabel('LEETCODE_SESSION', { exact: true }).fill('replacement-session')
  await cn.getByLabel('csrftoken', { exact: true }).fill('replacement-csrf')
  await cn.getByRole('button', { name: '保存登录信息', exact: true }).click()
  await expect(cn.getByRole('status')).toContainText('登录有效')
  remote.allowChecks()
  await page.getByRole('button', { name: '继续查询结果', exact: true }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  const after = await storedLibrary(page)
  expect(after.cards).toEqual(before.cards)
  expect(after.reviews).toEqual(before.reviews)
  expect(after.attempts).toMatchObject([
    {
      id: (pending.attempts as { id: string }[])[0]!.id,
      value: { status: 'completed', submissionId: '1001', code },
    },
  ])
  expect(remote.submissions()).toBe(1)
})

test('an unavailable judge service is reported without creating a placeholder question', async ({
  page,
}) => {
  await page.route('**/__native/leetcode', (route) =>
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
  await expect(page.getByRole('alert').filter({ hasText: '无法连接 LeetCode' })).toBeVisible()
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
  expect((await storedLibrary(page)).attempts).toMatchObject([
    { value: { status: 'unknown', code: 'def solve(value): return value' } },
  ])
})

test('an unknown submission recovers the original code once and re-enables automatic ratings', async ({
  context,
  page,
}) => {
  const remote = await connect(context, { submitFails: true })
  await create(page)
  const original = 'def solve(value): return value'
  await page.getByLabel('代码', { exact: true }).fill(original)
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.getByRole('heading', { name: '恢复未确认的提交' })).toBeVisible()
  const before = await storedLibrary(page)
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return 999')
  await page
    .getByLabel('提交编号或详情链接')
    .fill('https://leetcode.cn/problems/test-problem/submissions/1001/')
  await page.getByRole('button', { name: '关联并查询' }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  await expect(page.getByRole('heading', { name: '恢复未确认的提交' })).toHaveCount(0)
  await expect(page.getByText(/有一次提交未取得编号/)).toHaveCount(0)
  await expect(page.getByText(/尝试 1 次/)).toBeVisible()
  await expect(page.locator('#leetcode-rating option[value="automatic"]')).toBeEnabled()
  expect(remote.submissions()).toBe(1)
  expect(remote.recovered).toMatchObject([
    { code: original, lang: 'python3', questionId: '1', submissionId: '1001' },
  ])
  await expect(page.getByLabel('代码', { exact: true })).toHaveValue(original)
  const after = await storedLibrary(page)
  expect(after.attempts).toMatchObject([
    { value: { status: 'completed', code: original, submissionId: '1001' } },
  ])
  expect(after.cards).toEqual(before.cards)
  expect(after.reviews).toEqual(before.reviews)
  await page.getByLabel('复习评分').selectOption('automatic')
  await page.getByRole('button', { name: '结束作答并查看答案' }).click()
  await expect(page.getByRole('button', { name: '保存评分：简单' })).toBeEnabled()
})

test('recovery rejects wrong sites and mismatched remote submissions without altering history', async ({
  context,
  page,
}) => {
  const remote = await connect(context, { submitFails: true, recoveryError: 'submission-mismatch' })
  await create(page)
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.getByLabel('提交编号或详情链接')).toBeVisible()
  const before = await storedLibrary(page)
  await page.getByLabel('提交编号或详情链接').fill('https://leetcode.com/submissions/detail/1001/')
  await page.getByRole('button', { name: '关联并查询' }).click()
  await expect(page.locator('.leetcode-question > [role="alert"]')).toContainText(
    '请填写当前站点的提交编号',
  )
  expect(remote.recovered).toHaveLength(0)
  await page.getByLabel('提交编号或详情链接').fill('1001')
  await page.getByRole('button', { name: '关联并查询' }).click()
  await expect(page.locator('.leetcode-question > [role="alert"]')).toContainText(
    '该提交的题目、语言、代码或时间与本次记录不符',
  )
  expect((await storedLibrary(page)).attempts).toEqual(before.attempts)
  expect(remote.submissions()).toBe(1)
  await expect(page.locator('#leetcode-rating option[value="automatic"]')).toBeDisabled()
})

test('a recovered international submission survives another disconnect and resumes without resubmitting', async ({
  context,
  page,
}) => {
  const remote = await connect(context, {
    site: 'leetcode.com',
    submitFails: true,
    checkFails: true,
  })
  await create(page, 'leetcode.com', 'en')
  await page.getByLabel('Code', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: 'Submit to LeetCode' }).click()
  await page.getByLabel('Submission ID or detail link').fill('1001')
  await page.getByRole('button', { name: 'Link and check' }).click()
  await expect(page.locator('.leetcode-question > [role="alert"]')).toContainText(
    'Cannot connect to LeetCode',
  )
  expect((await storedLibrary(page)).attempts).toMatchObject([
    { value: { status: 'pending', submissionId: '1001' } },
  ])
  remote.allowChecks()
  await page.reload()
  await page.getByRole('button', { name: 'Start review', exact: true }).click()
  await expect(page.locator('.judge-result')).toContainText('Accepted')
  await expect(page.getByText(/Attempts: 1/)).toBeVisible()
  expect(remote.submissions()).toBe(1)
  expect(remote.recovered).toHaveLength(1)
})

test('recovering an earlier unknown attempt preserves a newer accepted attempt', async ({
  context,
  page,
}) => {
  const remote = await connect(context, { submitFails: true })
  await create(page)
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.getByLabel('提交编号或详情链接')).toBeVisible()
  remote.allowSubmissions()
  const latest = 'def solve(value): return value + 0'
  await page.getByLabel('代码', { exact: true }).fill(latest)
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  await page.getByLabel('提交编号或详情链接').fill('1001')
  await page.getByRole('button', { name: '关联并查询' }).click()
  await expect(page.getByLabel('提交编号或详情链接')).toHaveCount(0)
  await expect(page.getByLabel('代码', { exact: true })).toHaveValue(latest)
  await expect(page.getByText(/尝试 2 次/)).toBeVisible()
  await expect(page.locator('.judge-result a')).toHaveAttribute('href', /1002/)
  await expect(page.locator('#leetcode-rating option[value="automatic"]')).toBeEnabled()
  expect(remote.submissions()).toBe(2)
  const attempts = (await storedLibrary(page)).attempts as { value: { submissionId: string } }[]
  expect(attempts).toHaveLength(2)
  expect(
    [...attempts].sort((a, b) => a.value.submissionId.localeCompare(b.value.submissionId)),
  ).toMatchObject([
    { value: { status: 'completed', submissionId: '1001' } },
    { value: { status: 'completed', submissionId: '1002' } },
  ])
})

test('independent history filters, paginates, opens from cards, and stays readable with the plugin disabled', async ({
  context,
  page,
}) => {
  const remote = await connect(context)
  const library = practiceHistoryFixture()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'history.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(library)),
  })
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const before = await storedLibrary(page)
  await page.getByRole('button', { name: '练习历史', exact: true }).click()
  await expect(page.getByRole('heading', { name: '练习历史' })).toBeVisible()
  await expect(page.locator('.practice-history')).toHaveCount(20)
  await page.getByLabel('筛选卡组').selectOption(library.decks[0]!.id)
  await expect(page.locator('.practice-history')).toHaveCount(20)
  await page.getByLabel('筛选卡组').selectOption('')
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.locator('.practice-history')).toHaveCount(5)
  await page.getByLabel('判题结果', { exact: true }).selectOption('accepted')
  await expect(page.locator('.practice-history')).toHaveCount(9)
  await page.getByLabel('判题结果', { exact: true }).selectOption('unconfirmed')
  await expect(page.locator('.practice-history')).toHaveCount(8)
  await page.getByLabel('判题结果', { exact: true }).selectOption('all')
  await page.getByLabel('搜索练习历史').fill('Second problem')
  await expect(page.locator('.practice-history')).toHaveCount(12)
  await page.getByLabel('搜索练习历史').fill('no matches')
  await expect(page.getByText('没有符合筛选条件的练习。')).toBeVisible()
  await page.getByRole('button', { name: '全部卡片' }).click()
  await page.getByRole('button', { name: '查看 First problem 的练习历史' }).click()
  await expect(page.getByLabel('筛选题目')).toHaveValue(library.cards[0]!.id)
  await expect(page.locator('.practice-history')).toHaveCount(13)
  await page.getByText('当时的题目', { exact: true }).first().click()
  await expect(page.locator('.leetcode-statement')).toContainText('原始题面。')
  await page.locator('.attempt-history > summary').first().click()
  await expect(page.locator('.attempt-code code').first()).toContainText(
    '<script>stored text</script>',
  )
  await expect(page.locator('.attempt-code script')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/independent-history-mobile.png', fullPage: true })
  await page.screenshot({ path: 'test-results/independent-history-viewport-zh.png' })
  expect(await storedLibrary(page)).toEqual(before)
  await openPluginManager(page)
  await page.getByRole('switch', { name: '启用 LeetCode' }).click()
  await page.getByRole('button', { name: '练习历史', exact: true }).click()
  await expect(page.locator('.practice-history')).toHaveCount(20)
  await expect(page.locator('.leetcode-history')).toHaveCount(0)
  await page.locator('.attempt-history > summary').first().click()
  await expect(page.locator('.attempt-code code').first()).toBeVisible()
  expect(remote.submissions()).toBe(0)
  await setInterfaceLanguage(page, 'en')
  await page.getByRole('button', { name: 'Practice history', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Practice history' })).toBeVisible()
  await expect(page.getByLabel('Judge result')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/independent-history-viewport-en.png' })
})

test('undoing a rating preserves submission history and reviewing old code reveals the answer', async ({
  page,
  context,
}) => {
  await connect(context)
  await create(page)
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  await page.getByRole('button', { name: '结束作答并查看答案' }).click()
  await page.getByRole('button', { name: /^良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await page.getByRole('button', { name: '撤销上次评分' }).click()
  await expect(page.getByLabel('代码', { exact: true })).toBeEnabled()
  const saved = await storedLibrary(page)
  expect(saved.reviews).toHaveLength(0)
  expect(saved.attempts).toHaveLength(1)
  expect(saved.practices).toMatchObject([{ value: { ratingUndoneAt: expect.any(String) } }])
  await page.locator('.leetcode-history > summary').click()
  await expect(page.getByText('评分已撤销', { exact: true })).toBeVisible()
  await page.locator('.attempt-history > summary').click()
  await expect(page.locator('.attempt-code code')).toHaveText('def solve(value): return value')
  await setResponsiveViewport(page, 390, 844)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/leetcode-history-mobile.png', fullPage: true })
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  await page.getByRole('button', { name: '结束作答并查看答案' }).click()
  await expect(page.getByRole('button', { name: /^良好/ })).toBeDisabled()
})

test('practice-only sessions keep code without changing review progress', async ({
  page,
  context,
}) => {
  const remote = await connect(context)
  await create(page)
  await page.getByRole('button', { name: '结束复习' }).click()
  await page.getByRole('button', { name: '全部卡片' }).click()
  const before = await storedLibrary(page)
  await page.getByText('高级搜索、常用筛选与专项练习', { exact: true }).click()
  await page.getByRole('button', { name: '开始专项练习' }).click()
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  await page.getByRole('button', { name: '结束作答并查看答案' }).click()
  await page.getByRole('button', { name: /^良好/ }).click()
  await expect(page.getByRole('heading', { name: '本轮练习结束' })).toBeVisible()
  const after = await storedLibrary(page)
  expect(after.cards).toEqual(before.cards)
  expect(after.reviews).toEqual(before.reviews)
  expect(after.practices).toMatchObject([{ value: { completion: 'practice' } }])
  expect(after.attempts).toHaveLength(1)
  expect(remote.submissions()).toBe(1)
})

test('viewing past code on the history page marks a pending practice as having seen the answer', async ({
  context,
  page,
}) => {
  const remote = await connect(context)
  await create(page)
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  await page.getByRole('button', { name: '结束作答并查看答案' }).click()
  await page.getByRole('button', { name: /^良好/ }).click()
  await page.getByRole('button', { name: '撤销上次评分' }).click()
  remote.failChecks()
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.leetcode-question > [role="alert"]')).toContainText(
    '无法连接 LeetCode',
  )
  await page.getByRole('button', { name: '练习历史', exact: true }).click()
  await expect(page.locator('.practice-history')).toHaveCount(2)
  await page.locator('.attempt-history > summary').last().click()
  await expect
    .poll(async () => {
      const stored = await storedLibrary(page)
      return (stored.practices as { value: { completedAt?: string; answerSeen?: boolean } }[]).find(
        (row) => !row.value.completedAt,
      )?.value.answerSeen
    })
    .toBe(true)
  remote.allowChecks()
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  await page.getByRole('button', { name: '结束作答并查看答案' }).click()
  await expect(page.getByRole('button', { name: /^良好/ })).toBeDisabled()
  expect(remote.submissions()).toBe(2)
})

test('failed history storage prevents submitting code and keeps the editor intact', async ({
  page,
  context,
}) => {
  const remote = await connect(context)
  await create(page)
  const other = await context.newPage()
  await other.goto('./')
  await other.getByRole('button', { name: '创建卡组', exact: true }).last().click()
  await other.getByLabel('卡组名称').fill('Another tab changed the library')
  await other.getByRole('button', { name: '保存卡组', exact: true }).click()
  await expect(other.getByRole('dialog')).toHaveCount(0)
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.getByRole('alert')).toContainText('学习库内容已变化')
  expect(remote.submissions()).toBe(0)
  expect((await storedLibrary(page)).attempts).toHaveLength(0)
  await expect(page.getByLabel('代码', { exact: true })).toHaveValue(
    'def solve(value): return value',
  )
})

test('pending official submissions recover from library records when the temporary draft is lost', async ({
  page,
  context,
}) => {
  const remote = await connect(context, { checkFails: true })
  await create(page)
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.leetcode-question > [role="alert"]')).toContainText(
    '无法连接 LeetCode',
  )
  await page.evaluate(async () => {
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
        }
      }
    ).__TAURI_INTERNALS__.invoke
    const { active } = (await invoke('workspace_status')) as { active: { token: string } }
    const { library } = (await invoke('workspace_read', {
      token: active.token,
      request: { type: 'load' },
    })) as { library: { cards: { id: string }[] } }
    for (const card of library.cards)
      await invoke('workspace_write', {
        token: active.token,
        request: { type: 'value', namespace: 'plugin:leetcode', id: card.id, value: null },
      })
  })
  remote.allowChecks()
  await page.reload()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  await expect(page.getByLabel('代码', { exact: true })).toHaveValue(
    'def solve(value): return value',
  )
  expect(remote.submissions()).toBe(1)
  expect((await storedLibrary(page)).attempts).toMatchObject([{ value: { status: 'completed' } }])
})

test('revealing an answer remains recorded when the temporary draft is lost', async ({
  page,
  context,
}) => {
  const remote = await connect(context, { checkFails: true })
  await create(page)
  await page.getByLabel('代码', { exact: true }).fill('def solve(value): return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.leetcode-question > [role="alert"]')).toContainText(
    '无法连接 LeetCode',
  )
  await page.getByRole('button', { name: '结束作答并查看答案' }).click()
  await expect
    .poll(
      async () =>
        ((await storedLibrary(page)).practices as { value: { answerSeen: boolean } }[])[0]!.value
          .answerSeen,
    )
    .toBe(true)
  await page.evaluate(async () => {
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
        }
      }
    ).__TAURI_INTERNALS__.invoke
    const { active } = (await invoke('workspace_status')) as { active: { token: string } }
    const { library } = (await invoke('workspace_read', {
      token: active.token,
      request: { type: 'load' },
    })) as { library: { cards: { id: string }[] } }
    for (const card of library.cards)
      await invoke('workspace_write', {
        token: active.token,
        request: { type: 'value', namespace: 'plugin:leetcode', id: card.id, value: null },
      })
  })
  remote.allowChecks()
  await page.reload()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  await page.getByRole('button', { name: '结束作答并查看答案' }).click()
  await expect(page.getByRole('button', { name: /^良好/ })).toBeDisabled()
  expect(remote.submissions()).toBe(1)
})

test('plugin switches persist in the workspace without changing questions or progress', async ({
  page,
  context,
}) => {
  await connect(context)
  await create(page)
  const before = await storedLibrary(page)
  await openPluginManager(page)
  await expect(page.getByRole('switch', { name: '启用 LeetCode' })).toBeChecked()
  await page.getByRole('switch', { name: '启用 LeetCode' }).click()
  await page.reload()
  await openPluginManager(page)
  await expect(page.getByRole('switch', { name: '启用 LeetCode' })).not.toBeChecked()
  await page.getByRole('button', { name: '全部卡片' }).click()
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect(page.getByLabel('代码', { exact: true })).toHaveCount(0)
  expect(await storedLibrary(page)).toEqual(before)
  await openPluginManager(page)
  await page.getByRole('switch', { name: '启用 LeetCode' }).click()
  await page.getByRole('button', { name: '全部卡片' }).click()
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect(page.getByLabel('代码', { exact: true })).toBeVisible()
})

test('plugin settings distinguish website login from per-site judge credentials and refresh failures', async ({
  page,
  context,
}) => {
  let configured: string[] = []
  let fail = false
  await context.route('**/__native/leetcode', (route) => {
    const request = route.request().postDataJSON()
    return fail
      ? route.fulfill({ status: 503, json: { error: 'request-failed' } })
      : route.fulfill({
          json:
            request.action === 'account'
              ? { site: request.site, state: 'authenticated', username: 'settings-learner' }
              : { version: 1, configured },
        })
  })
  await context.route('https://leetcode.cn/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>LeetCode website</title>' }),
  )
  await page.goto('./')
  await openPluginSettings(page)
  const cn = page.getByRole('region', { name: '中国站 · leetcode.cn', exact: true })
  const com = page.getByRole('region', { name: '国际站 · leetcode.com', exact: true })
  await expect(cn.getByRole('status')).toContainText('未配置登录信息')
  await expect(com.getByRole('status')).toContainText('未配置登录信息')
  await expect(cn).toContainText('打开力扣网站并登录，不会自动连接 Repeaty')
  const popup = page.waitForEvent('popup')
  await cn.getByRole('link', { name: '打开力扣网站', exact: false }).click()
  const website = await popup
  await website.waitForLoadState('load')
  await expect(website).toHaveURL('https://leetcode.cn/')
  await expect(website).toHaveTitle('LeetCode website')
  // Return to Repeaty after the popup has committed. The context owns cleanup;
  // closing a newly attached Chromium target here can stall until test teardown.
  await page.bringToFront()
  await expect(cn.getByRole('status')).toContainText('未配置登录信息')
  await cn.getByText('在哪里找到这两个值？', { exact: true }).click()
  await expect(cn.getByLabel('LEETCODE_SESSION', { exact: true })).toBeVisible()
  await expect(cn.getByLabel('csrftoken', { exact: true })).toBeVisible()
  configured = ['leetcode.cn']
  await cn.getByRole('button', { name: '刷新状态' }).click()
  await expect(cn.getByRole('status')).toContainText('登录有效')
  await expect(cn.getByText('当前账号：settings-learner', { exact: true })).toBeVisible()
  await expect(com.getByRole('status')).toContainText('未配置登录信息')
  fail = true
  await cn.getByRole('button', { name: '刷新状态' }).click()
  await expect(cn.getByRole('status')).toContainText('状态读取失败')
  await expect(cn.getByRole('alert')).toBeVisible()
  fail = false
  await cn.getByRole('button', { name: '刷新状态' }).click()
  await expect(cn.getByRole('status')).toContainText('登录有效')
  await setInterfaceLanguage(page, 'en')
  await openPluginSettings(page)
  await expect(cn.getByRole('status')).toHaveCount(0)
  await expect(
    page.getByRole('region', { name: 'China · leetcode.cn', exact: true }).getByRole('status'),
  ).toContainText('Signed in')
})

test('credentials can be saved, replaced and cleared per site without exposing stored values', async ({
  page,
}, info) => {
  await page.goto('./')
  await openPluginSettings(page)
  const cn = page.getByRole('region', { name: '中国站 · leetcode.cn', exact: true })
  const com = page.getByRole('region', { name: '国际站 · leetcode.com', exact: true })
  await expect(cn.getByRole('status')).toContainText('未配置登录信息')
  await expect(cn.getByRole('button', { name: '保存登录信息', exact: true })).toBeDisabled()
  await cn.getByLabel('LEETCODE_SESSION', { exact: true }).fill('browser-session-cn')
  await cn.getByLabel('csrftoken', { exact: true }).fill('browser-csrf-cn')
  await expect(cn.getByLabel('LEETCODE_SESSION', { exact: true })).toHaveAttribute(
    'type',
    'password',
  )
  const saving = page.waitForResponse('**/__native/leetcode/credentials')
  await cn.getByRole('button', { name: '保存登录信息', exact: true }).click()
  expect(await (await saving).json()).toEqual({ configured: ['leetcode.cn'] })
  await expect(cn.getByRole('status')).toContainText('登录有效')
  await expect(cn.getByText('当前账号：tester-cn', { exact: true })).toBeVisible()
  await expect(cn.getByLabel('LEETCODE_SESSION', { exact: true })).toHaveValue('')
  await expect(cn.getByLabel('csrftoken', { exact: true })).toHaveValue('')
  await expect(com.getByRole('status')).toContainText('未配置登录信息')
  await com.getByLabel('LEETCODE_SESSION', { exact: true }).fill('browser-session-com')
  await com.getByLabel('csrftoken', { exact: true }).fill('browser-csrf-com')
  await com.getByRole('button', { name: '保存登录信息', exact: true }).click()
  await expect(com.getByRole('status')).toContainText('登录有效')
  await expect(com.getByText('当前账号：tester-com', { exact: true })).toBeVisible()
  await page.reload()
  await openPluginSettings(page)
  await expect(cn.getByRole('status')).toContainText('登录有效')
  await expect(com.getByRole('status')).toContainText('登录有效')
  await expect(cn.getByLabel('LEETCODE_SESSION', { exact: true })).toHaveValue('')
  expect(JSON.stringify(await storedLibrary(page))).not.toContain('browser-session-')
  expect(JSON.stringify(await storedLibrary(page))).not.toContain('tester-cn')
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(
    'browser-session-',
  )
  await cn.getByLabel('LEETCODE_SESSION', { exact: true }).fill('replacement-session')
  await cn.getByLabel('csrftoken', { exact: true }).fill('replacement-csrf')
  await cn.getByRole('button', { name: '保存登录信息', exact: true }).click()
  await expect(cn.getByText('登录信息已保存在本机。')).toBeVisible()
  await page.screenshot({ path: 'test-results/credentials-desktop.png', fullPage: true })
  await cn.getByRole('button', { name: '清除登录信息', exact: true }).click()
  await cn.getByRole('button', { name: '取消', exact: true }).click()
  await expect(cn.getByRole('status')).toContainText('登录有效')
  await cn.getByRole('button', { name: '清除登录信息', exact: true }).click()
  await cn.getByRole('button', { name: '确认清除', exact: true }).click()
  await expect(cn.getByRole('status')).toContainText('未配置登录信息')
  await expect(com.getByRole('status')).toContainText('登录有效')
  await page.setViewportSize({ width: 390, height: 844 })
  await setInterfaceLanguage(page, 'en')
  await openPluginSettings(page)
  const english = page.getByRole('region', { name: 'China · leetcode.cn', exact: true })
  await expect(english.getByRole('button', { name: 'Save credentials', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/credentials-mobile-en.png', fullPage: true })
  const international = page.getByRole('region', {
    name: 'International · leetcode.com',
    exact: true,
  })
  await international.getByRole('button', { name: 'Clear credentials', exact: true }).click()
  const confirmation = international.locator('.credential-confirmation')
  await expect(confirmation).toBeVisible()
  const text = (await confirmation.locator('.ui-notice__content').boundingBox())!
  const actions = (await confirmation.locator('.ui-notice__actions').boundingBox())!
  expect(actions.y).toBeGreaterThanOrEqual(text.y + text.height)
  expect(await confirmation.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await confirmation.screenshot({
    path: info.outputPath('credentials-confirmation-390-en.png'),
    style: '.desktop-titlebar { visibility: hidden !important; }',
  })
  await international.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(international.getByRole('status')).toContainText('Signed in')
})

test('credential errors preserve drafts and changing the editor site clears sensitive inputs', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: '创建卡组', exact: true }).last().click()
  await page.getByLabel('卡组名称').fill('Credentials test')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  await page.getByLabel('笔记类型').selectOption('plugin')
  const cn = page.getByRole('region', { name: '中国站 · leetcode.cn', exact: true })
  await cn.getByLabel('LEETCODE_SESSION', { exact: true }).fill('invalid;value')
  await cn.getByLabel('csrftoken', { exact: true }).fill('test-csrf')
  await cn.getByRole('button', { name: '保存登录信息', exact: true }).click()
  await expect(cn.getByRole('alert')).toContainText('请填写两个 Cookie 的值')
  await page.route('**/__native/leetcode/credentials', (route) =>
    route.fulfill({ status: 500, json: { error: 'storage-error' } }),
  )
  await cn.getByLabel('LEETCODE_SESSION', { exact: true }).fill('not-yet-saved')
  await cn.getByLabel('csrftoken', { exact: true }).press('Enter')
  await expect(cn.getByRole('alert')).toContainText('操作未确认成功')
  await expect(cn.getByLabel('LEETCODE_SESSION', { exact: true })).toHaveValue('not-yet-saved')
  await expect(cn.getByRole('status')).toContainText('未配置登录信息')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.unroute('**/__native/leetcode/credentials')
  await cn.getByLabel('csrftoken', { exact: true }).press('Enter')
  await expect(cn.getByRole('status')).toContainText('登录有效')
  await expect(page.getByRole('dialog')).toBeVisible()
  await cn.getByLabel('LEETCODE_SESSION', { exact: true }).fill('unsaved-private-value')
  await page.getByLabel('LeetCode 站点').selectOption('leetcode.com')
  const com = page.getByRole('region', { name: '国际站 · leetcode.com', exact: true })
  await expect(com.getByRole('status')).toContainText('未配置登录信息')
  await expect(com.getByLabel('LEETCODE_SESSION', { exact: true })).toHaveValue('')
  await expect(com.getByLabel('csrftoken', { exact: true })).toHaveValue('')
})

test('mixed study judges LeetCode locally and preserves attempts when a reading-side undo restores its rating', async ({
  context,
}) => {
  const remote = await connect(context, { rejectFirst: true })
  const page = await context.newPage()
  await create(page)
  await page.getByRole('button', { name: '结束复习', exact: true }).click()
  await importReading(page, 'LeetCode mixed context', 'plain', readingText)
  await startMixed(page)
  await expect(page.getByLabel('代码', { exact: true })).toBeEnabled()
  await page.getByLabel('代码', { exact: true }).fill('def solve(value):\n    return 0')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.judge-result')).toContainText('答案错误')
  await page.getByLabel('代码', { exact: true }).fill('def solve(value):\n    return value')
  await page.getByRole('button', { name: '提交到 LeetCode' }).click()
  await expect(page.locator('.judge-result')).toContainText('通过')
  await page.getByLabel('复习评分').selectOption('automatic')
  await page.getByRole('button', { name: '结束作答并查看答案' }).click()
  await page.getByRole('button', { name: '保存评分：良好' }).click()
  await expect(
    page.getByRole('heading', { name: 'LeetCode mixed context', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  let records = await storedLibrary(page)
  expect(records.reviews).toHaveLength(1)
  expect(records.attempts).toHaveLength(2)
  await page.getByRole('button', { name: '撤销上次评分', exact: true }).click()
  await expect(page.getByLabel('代码', { exact: true })).toBeVisible()
  records = await storedLibrary(page)
  expect(records.reviews).toHaveLength(0)
  expect(records.attempts).toHaveLength(2)
  expect(remote.submissions()).toBe(2)
})
