import { selectUiValue } from './fixtures/ui-flow'
import { setInterfaceLanguage } from './fixtures/settings-flow'
import { expect, test } from './fixtures/empty-workspace'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Library } from '../src/core/model'

async function createCard(page: Page, front = 'What is active recall?') {
  await page.goto('./')
  await page.getByRole('button', { name: '创建卡组', exact: true }).last().click()
  await page.getByLabel('卡组名称').fill('Learning')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  await page.getByLabel('正面 · 问题').fill(front)
  await page
    .getByLabel('背面 · 答案')
    .fill('Retrieve information from memory before checking the answer.')
  await page.getByLabel('标签', { exact: false }).fill('study, learning')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('create, persist, review, edit and delete a card', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await createCard(page)
  await page.reload()
  await expect(page.getByRole('button', { name: '开始复习', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'What is active recall?' })).toBeVisible()
  await expect(
    page.getByText('Retrieve information from memory before checking the answer.', { exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '显示答案' }).click()
  await expect(
    page.getByText('Retrieve information from memory before checking the answer.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: /简单/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await page.getByRole('button', { name: '返回' }).click()
  await page.getByRole('button', { name: '全部卡片' }).click()
  await page.getByRole('button', { name: '编辑卡片 What is active recall?', exact: true }).click()
  await page.getByLabel('正面 · 问题').fill('Explain active recall')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(page.locator('tbody').getByText('复习中', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '删除卡片 Explain active recall', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Explain active recall', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '删除卡片 Explain active recall', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('heading', { name: '暂无卡片' })).toBeVisible()
  expect(errors).toEqual([])
})

test('a forgotten card returns when its learning step becomes due', async ({ page }) => {
  await page.clock.install()
  await createCard(page)
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案' }).click()
  await page.getByRole('button', { name: /重来/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await page.clock.fastForward(70_000)
  await expect(page.getByRole('heading', { name: 'What is active recall?' })).toBeVisible()
  await expect(page.getByRole('button', { name: '显示答案' })).toBeVisible()
})

test('backup export and confirmed restore retain cards, and malformed imports do not alter data', async ({
  page,
}) => {
  await createCard(page)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出旧版 JSON', exact: true }).click()
  const download = await downloadPromise
  const backup = await readFile((await download.path())!, 'utf8')
  expect(JSON.parse(backup).library.cards).toHaveLength(1)
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":99}'),
  })
  await expect(page.getByRole('alert')).toContainText('备份格式不正确')
  await expect(page.getByText('1 个卡组 · 1 张卡片 · 0 次复习', { exact: true })).toBeVisible()
  await page.getByLabel('导入备份文件').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backup),
  })
  await expect(page.getByRole('dialog')).toContainText('1 个卡组、1 张卡片')
  await page.getByRole('button', { name: '替换并恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '全部卡片' }).click()
  await page.getByRole('textbox', { name: '搜索卡片' }).fill('study')
  await expect(
    page.getByRole('button', { name: 'What is active recall?', exact: true }),
  ).toBeVisible()
  await page.getByRole('textbox', { name: '搜索卡片' }).fill('no match')
  await expect(page.getByRole('heading', { name: '没有匹配的卡片' })).toBeVisible()
})

test('mobile workspace and sample deck fit without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./')
  await page.getByRole('button', { name: '添加入门卡组', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '从这里开始：FSRS 与 Repeaty', exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: 'test-results/mobile-dashboard.png', fullPage: true })
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案' }).click()
  await expect(page.getByRole('button', { name: /良好/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('desktop sample dashboard renders cleanly', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.goto('./')
  await page.getByRole('button', { name: '添加入门卡组', exact: true }).click()
  await expect(
    page
      .locator('.dashboard')
      .getByRole('button', { name: '从这里开始：FSRS 与 Repeaty', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/desktop-dashboard.png', fullPage: true })
})

test('reverse cards share note content, preserve independent progress and support undo/suspend/bury', async ({
  page,
}) => {
  await createCard(page)
  await page.getByRole('button', { name: '编辑卡片 What is active recall?', exact: true }).click()
  await selectUiValue(page.getByLabel('笔记类型'), 'reversed')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await expect(page.locator('tbody .tag').filter({ hasText: '正面 → 背面' })).toBeVisible()
  await expect(page.locator('tbody .tag').filter({ hasText: '背面 → 正面' })).toBeVisible()
  await setInterfaceLanguage(page, 'en')
  await page.getByRole('button', { name: /^All cards/ }).click()
  await expect(page.locator('tbody .tag').filter({ hasText: 'Front → Back' })).toBeVisible()
  await expect(page.locator('tbody .tag').filter({ hasText: 'Back → Front' })).toBeVisible()
  await setInterfaceLanguage(page, 'zh-CN')
  await page.getByRole('button', { name: /^全部卡片/ }).click()
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect(page.locator('.card-question')).toHaveText('What is active recall?')
  const question = await page.locator('.card-question').innerText()
  await page.getByRole('button', { name: '显示答案' }).click()
  await page.getByRole('button', { name: /简单/ }).click()
  await page.getByRole('button', { name: '撤销上次评分' }).click()
  await expect(page.locator('.card-question')).toHaveText(question)
  await page.getByRole('button', { name: '暂停此卡' }).click()
  await page.getByRole('button', { name: '今天暂缓', exact: true }).click()
  await expect(page.getByRole('heading', { name: '暂无待复习卡片' })).toBeVisible()
  await page.getByRole('button', { name: '全部卡片' }).click()
  await expect(page.locator('tbody').getByText('已暂停', { exact: true })).toBeVisible()
  await expect(page.locator('tbody').getByText('今日暂缓', { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: '选择本页卡片' }).check()
  await page.getByRole('button', { name: '恢复所选', exact: true }).click()
  await page.getByRole('button', { name: '取消暂缓', exact: true }).click()
  await expect(page.locator('tbody').getByText('新卡片', { exact: true })).toHaveCount(2)
})

test('cloze generation and daily new-card quotas work together', async ({ page }) => {
  await createCard(page)
  await page.getByRole('button', { name: '编辑卡片 What is active recall?', exact: true }).click()
  await selectUiValue(page.getByLabel('笔记类型'), 'cloze')
  await page
    .getByLabel('正面 · 问题')
    .fill('法国的首都是 {{c1::巴黎::城市}}，日本的首都是 {{c2::东京}}。')
  await page.getByLabel('补充说明').fill('')
  await page.getByRole('checkbox', { name: /确认移除/ }).check()
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await expect(page.locator('tbody .tag').filter({ hasText: '挖空 1' })).toBeVisible()
  await expect(page.locator('tbody .tag').filter({ hasText: '挖空 2' })).toBeVisible()
  await page.getByRole('button', { name: '编辑当前卡组' }).click()
  await page.getByLabel('每日新卡上限').fill('1')
  await page.getByLabel('评分后自动暂缓同笔记的其他卡片至明天').uncheck()
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect(page.locator('.card-question')).toContainText(/\[(城市|…)\]/)
  await page.getByRole('button', { name: '显示答案' }).click()
  await expect(page.getByLabel('挖空答案')).toContainText(/巴黎|东京/)
  await expect(page.locator('.cloze-answer')).toHaveCount(1)
  await expect(page.locator('.cloze-extra')).toHaveCount(0)
  await expect(page.locator('.card-answer')).toContainText('法国的首都是 巴黎，日本的首都是 东京。')
  await page.getByRole('button', { name: /简单/ }).click()
  await expect(page.getByRole('heading', { name: '已达到今日上限' })).toBeVisible()
  await page.getByRole('button', { name: '撤销上次评分' }).click()
  await expect(page.locator('.card-question')).toBeVisible()
})

test('CSV preview, duplicate handling and batch tag editing', async ({ page }) => {
  await createCard(page)
  await page.getByRole('button', { name: '批量导入', exact: true }).click()
  await page
    .getByLabel('或粘贴表格文本')
    .fill(
      'type,front,back,tags\nreversed,hello,你好,language\ncloze,{{c1::巴黎}}是法国首都。,地理,geo',
    )
  await page.getByRole('button', { name: '检查并预览' }).click()
  await expect(page.getByRole('dialog')).toContainText('2 条笔记，将生成 3 张卡片')
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await page.getByRole('checkbox', { name: '选择本页卡片' }).check()
  await page.getByText('批量修改笔记的卡组与标签', { exact: true }).click()
  await page.getByLabel('添加标签', { exact: true }).fill('batch')
  await page.getByRole('button', { name: '应用笔记修改', exact: true }).click()
  await expect(page.locator('tbody').getByText('batch', { exact: true })).toHaveCount(4)
  await page.getByRole('textbox', { name: '搜索卡片' }).fill('batch')
  await expect(page.locator('tbody tr')).toHaveCount(4)
})

test('image/audio survive backup, deletion and automatic snapshot recovery', async ({ page }) => {
  await createCard(page)
  await page.getByRole('button', { name: '编辑卡片 What is active recall?', exact: true }).click()
  await page.getByLabel('正面图片 / 音频').setInputFiles('public/icon-192.png')
  // Minimal PCM WAV, sufficient for the browser to load local audio metadata.
  const wav = Buffer.alloc(46)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(38, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(16000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(2, 40)
  await page
    .getByLabel('背面图片 / 音频')
    .setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: wav })
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出旧版 JSON', exact: true }).click()
  const backup = JSON.parse(await readFile((await (await downloadPromise).path())!, 'utf8'))
  expect(backup.library.media).toHaveLength(2)
  expect(backup.assets).toHaveLength(2)
  await page.getByRole('button', { name: '全部卡片' }).click()
  await page.getByRole('button', { name: '删除卡片 What is active recall?', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page
    .locator('.snapshot-list li')
    .filter({ hasText: '删除笔记前' })
    .getByRole('button', { name: '恢复此快照' })
    .click()
  await page.getByRole('button', { name: '确认恢复快照' }).click()
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await expect(page.getByRole('img', { name: 'icon-192.png' })).toBeVisible()
  await page.getByRole('button', { name: '显示答案' }).click()
  await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/)
})

test('production shell reopens offline with persisted content', async ({ page, context }) => {
  await createCard(page)
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await expect(page.getByRole('heading', { name: '离线已就绪', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('button', { name: '开始复习', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案' }).click()
  await page.getByRole('button', { name: /简单/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '全部卡片' }).click()
  await expect(page.locator('tbody').getByText('复习中', { exact: true })).toBeVisible()
})

async function readWorkspace(page: Page): Promise<{ revision: number; library: Library }> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('repeaty')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const stores = [
            'decks',
            'notes',
            'cards',
            'reviews',
            'media',
            'savedSearches',
            'practices',
            'attempts',
          ] as const
          const tx = db.transaction(['meta', ...stores])
          const library = { version: 13, sources: [] } as unknown as Library
          let revision = 0
          const metadata = tx.objectStore('meta').get('main')
          metadata.onsuccess = () => {
            revision = metadata.result.revision
          }
          for (const store of stores) {
            const read = tx.objectStore(store).index('position').getAll()
            read.onsuccess = () => {
              library[store] = read.result.map((row) => row.value)
            }
          }
          tx.onabort = () => {
            db.close()
            reject(tx.error)
          }
          tx.oncomplete = () => {
            db.close()
            resolve({ revision, library })
          }
        }
      }),
  )
}

test('continuous authoring, selected cloze, Markdown, formulas and image paste persist offline', async ({
  page,
  context,
}) => {
  await createCard(page)
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  const front = page.getByLabel('正面 · 问题')
  await front.fill('Capital: Paris')
  await front.evaluate((element: HTMLTextAreaElement) => {
    element.focus()
    element.setSelectionRange(9, 14)
  })
  await page.getByRole('button', { name: /选中文字挖空/ }).click()
  await expect(front).toHaveValue('Capital: {{c1::Paris}}')
  await page.getByRole('button', { name: '保存并继续', exact: true }).click()
  await expect(front).toHaveValue('')
  await expect(page.getByLabel('笔记类型')).toHaveAttribute('value', 'cloze')
  await selectUiValue(page.getByLabel('笔记类型'), 'basic')
  await front.fill('**Formula** $x^2$')
  await page.getByLabel('背面 · 答案').fill('$$\\frac{1}{2}$$')
  const bytes = [...(await readFile('public/icon-192.png'))]
  await front.evaluate((element, imageBytes) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(imageBytes)], 'pasted.png', { type: 'image/png' }))
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  }, bytes)
  await expect(page.getByRole('img', { name: 'pasted.png' }).first()).toBeVisible()
  await page.getByText('将生成 1 张卡片 · 预览', { exact: true }).click()
  await expect(page.locator('.note-preview strong')).toHaveText('Formula')
  await expect(page.locator('.note-preview .katex')).toHaveCount(2)
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await expect(page.getByRole('heading', { name: '离线已就绪', exact: true })).toBeVisible()
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: '全部卡片' }).click()
  await page.getByRole('textbox', { name: '搜索卡片' }).fill('Formula')
  await page.getByText('高级搜索、常用筛选与专项练习', { exact: true }).click()
  await page.getByRole('button', { name: '开始专项练习' }).click()
  await expect(page.locator('.card-question strong')).toHaveText('Formula')
  await expect(page.locator('.card-question .katex')).toHaveCount(1)
  await expect(page.getByRole('img', { name: 'pasted.png' })).toBeVisible()
  await page.getByRole('button', { name: '显示答案' }).click()
  await expect(page.locator('.card-answer .katex')).toHaveCount(1)
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('16px KaTeX_Main'))).toBe(true)
})

test('saved filters persist and practice mode never changes durable progress', async ({ page }) => {
  await createCard(page)
  await page.getByRole('textbox', { name: '搜索卡片' }).fill('tag:study is:new lapses:0')
  await page.getByText('高级搜索、常用筛选与专项练习', { exact: true }).click()
  await page.getByLabel('筛选名称').fill('New study cards')
  await page.getByRole('button', { name: '另存筛选', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('常用筛选已保存')
  await page.reload()
  await page.getByRole('button', { name: '全部卡片' }).click()
  await page.getByText('高级搜索、常用筛选与专项练习', { exact: true }).click()
  await selectUiValue(page.getByLabel('常用筛选', { exact: true }), { label: 'New study cards' })
  await expect(page.getByRole('textbox', { name: '搜索卡片' })).toHaveValue(
    'tag:study is:new lapses:0',
  )
  const original = await readWorkspace(page)
  await page.getByRole('button', { name: '开始专项练习' }).click()
  await page.getByRole('button', { name: '显示答案' }).click()
  await page.getByRole('button', { name: /简单/ }).click()
  await expect(page.getByRole('heading', { name: '本轮练习结束' })).toBeVisible()
  expect(await readWorkspace(page)).toEqual(original)
  await page.getByRole('button', { name: '撤销上次评分' }).click()
  await expect(page.locator('.card-question')).toBeVisible()
  expect(await readWorkspace(page)).toEqual(original)
  await page.getByRole('button', { name: '结束专项练习' }).click()
  await page.getByText('高级搜索、常用筛选与专项练习', { exact: true }).click()
  await page.getByLabel('练习模式').click()
  // Opening a menu while its form expands must keep every option in view after
  // layout settles, including when the select has already locked body scrolling.
  await page.locator('.search-options [data-slot=content]').evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished.catch(() => {})),
    )
  })
  const gradedPractice = page.getByRole('option', { name: '评分并更新进度', exact: true })
  await page.getByRole('listbox').evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished.catch(() => {})),
    )
  })
  await expect(gradedPractice).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: test.info().outputPath('practice-mode-menu.png') })
  await gradedPractice.click()
  await page.getByRole('button', { name: '开始专项练习' }).click()
  await page.getByRole('button', { name: '显示答案' }).click()
  await page.getByRole('button', { name: /简单/ }).click()
  await expect(page.getByRole('heading', { name: '本轮练习结束' })).toBeVisible()
  expect((await readWorkspace(page)).library.reviews.at(-1)?.source).toBe('filtered')
  await page.getByRole('button', { name: '撤销上次评分' }).click()
  await expect(page.locator('.card-question')).toBeVisible()
  expect((await readWorkspace(page)).library.cards).toEqual(original.library.cards)
})

test('automatic sibling burying and deck settings survive reload and undo', async ({ page }) => {
  await createCard(page)
  await page.getByRole('button', { name: '编辑卡片 What is active recall?', exact: true }).click()
  await selectUiValue(page.getByLabel('笔记类型'), 'reversed')
  await page.getByRole('button', { name: '保存卡片', exact: true }).click()
  await page.getByRole('button', { name: '编辑当前卡组' }).click()
  await page.getByLabel('目标记忆保留率（%）', { exact: true }).fill('95')
  await page.getByLabel('顽固卡遗忘阈值').fill('3')
  await page.getByRole('button', { name: '保存卡组', exact: true }).click()
  const original = (await readWorkspace(page)).library
  expect(original.decks[0]).toMatchObject({
    desiredRetention: 0.95,
    leechThreshold: 3,
    burySiblings: true,
  })
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案' }).click()
  await page.getByRole('button', { name: /简单/ }).click()
  await expect(page.getByRole('heading', { name: '本轮复习结束' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '全部卡片' }).click()
  await expect(page.locator('tbody').getByText('今日暂缓', { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await page.getByRole('button', { name: '撤销上次评分' }).click()
  await expect(page.locator('.card-question')).toBeVisible()
  expect((await readWorkspace(page)).library.cards).toEqual(original.cards)
})
