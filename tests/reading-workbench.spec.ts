import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/empty-workspace'
import { storedLibrary } from './fixtures/stored-library'
import { importReading } from './fixtures/reading-flow'
import { createSourceDeck } from './fixtures/source-flow'
import { selectUiValue } from './fixtures/ui-flow'
import type { Library } from '../src/core/model'

test.setTimeout(90_000)
test.use({ actionTimeout: 15_000 })
const evidence = resolve('docs/local-plans.local/foliole-coverage-2026-10-29/p3')
async function screenshot(page: Page, name: string, fullPage = true) {
  await mkdir(evidence, { recursive: true })
  for (const close of await page
    .locator('.notification.info')
    .getByRole('button', { name: '关闭提示', exact: true })
    .all())
    await close.click()
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  })
  await page.screenshot({ path: resolve(evidence, name), fullPage, animations: 'disabled' })
}
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed())
    await screenshot(
      page,
      `reading-workbench-failed-${info.title.split(' ')[0]!.toLowerCase()}.png`,
    )
})
async function read(page: Page) {
  const rows = await storedLibrary(page)
  return Object.fromEntries(
    Object.entries(rows).map(([name, values]) => [
      name,
      (values as { value: unknown }[]).map((row) => row.value),
    ]),
  ) as unknown as Library
}
async function folders(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('repeaty')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<{ value: { id: string; name: string } }[]>((resolve, reject) => {
        const request = db.transaction('materialFolders').objectStore('materialFolders').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally {
      db.close()
    }
  })
}
async function open(page: Page, title: string) {
  await page.locator('.source-list-title').filter({ hasText: title }).first().click()
  await expect(page.locator('.source-reader h2')).toHaveText(title)
  await expect(page.locator('.source-text, .source-markdown-preview')).toHaveAttribute(
    'aria-busy',
    'false',
  )
}
async function preview(page: Page) {
  const toggle = page.getByRole('button', { name: '阅读 Markdown 预览', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  await expect(page.locator('.source-markdown-preview')).toHaveAttribute('aria-busy', 'false')
}
async function selectSecondBold(page: Page, quote: string) {
  await preview(page)
  await page
    .locator('.source-markdown-preview strong')
    .filter({ hasText: quote })
    .nth(1)
    .evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
  await expect(page.getByRole('button', { name: '保存为摘录', exact: true })).toBeEnabled()
}

test('Markdown preview selections retain exact duplicate-text offsets in excerpts, cloze cards and annotations across draft reload and version edits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await createSourceDeck(page)
  const quote = '重复中文🙂'
  const markdown = `# 精确选择\n\n第一次 **${quote}** 在这里。\n\n第二次 **${quote}** 用于摘录。\n\n- [ ] 待办事项\n\n\`\`\`ts\nconst value = 42\n\`\`\`\n`
  await importReading(page, '预览与版本', 'markdown', markdown)
  await screenshot(page, 'reading-workbench-initial-light.png')
  const source = (await read(page)).sources[0]!
  const start = markdown.lastIndexOf(quote)
  const expected = { mediaId: source.mediaId, start, end: start + quote.length }
  await selectSecondBold(page, quote)
  await page.getByRole('button', { name: '保存为摘录', exact: true }).click()
  await page.getByLabel('摘录标题').fill('第二处摘录')
  await expect(page.getByLabel('选中的原文')).toHaveValue(quote)
  await page.getByRole('button', { name: '保存摘录', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(
    (await read(page)).sources.find((item) => item.title === '第二处摘录')?.origin,
  ).toMatchObject({ sourceId: source.id, ...expected })

  await open(page, source.title)
  await selectSecondBold(page, quote)
  await page.getByRole('button', { name: '制作挖空卡', exact: true }).click()
  const editor = page.getByRole('dialog')
  await expect(editor.locator('#card-front')).toHaveValue(`{{c1::${quote}}}`)
  await editor.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(editor).toHaveCount(0)
  expect((await read(page)).notes[0]).toMatchObject({
    type: 'cloze',
    excerpt: { sourceId: source.id, quote, ...expected },
  })

  await selectSecondBold(page, quote)
  await page.getByRole('button', { name: '添加批注', exact: true }).click()
  const annotation = page.getByRole('dialog', { name: '编辑批注', exact: true })
  await annotation.getByLabel('批注内容').fill('标记第二次出现，原文改版后仍指向此处。')
  await screenshot(page, 'reading-workbench-annotation-light.png')
  await page.setViewportSize({ width: 760, height: 500 })
  const handle = annotation.getByRole('button', {
    name: '移动批注面板，方向键调整位置',
    exact: true,
  })
  const handleBox = (await handle.boundingBox())!
  await page.mouse.move(handleBox.x + 30, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(0, 0, { steps: 8 })
  await page.mouse.up()
  const moved = (await annotation.boundingBox())!
  expect(moved.x).toBeGreaterThanOrEqual(12)
  expect(moved.y).toBe(52)
  const resize = annotation.getByRole('button', {
    name: '调整批注面板大小，方向键调整尺寸',
    exact: true,
  })
  await resize.focus()
  for (let count = 0; count < 45; count++) await resize.press('ArrowRight')
  for (let count = 0; count < 15; count++) await resize.press('ArrowDown')
  const resized = (await annotation.boundingBox())!
  expect(resized.width).toBeGreaterThan(moved.width)
  expect(resized.height).toBeGreaterThan(moved.height)
  expect(resized.y).toBeGreaterThanOrEqual(52)
  expect(resized.x + resized.width).toBeLessThanOrEqual(748)
  expect(resized.y + resized.height).toBeLessThanOrEqual(488)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await screenshot(page, 'reading-workbench-annotation-760x500.png', false)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await annotation.getByRole('button', { name: '保存批注', exact: true }).click()
  await expect(annotation).toHaveCount(0)
  expect(
    (await read(page)).sources.find((item) => item.id === source.id)?.annotations?.[0],
  ).toMatchObject({ ...expected, quote })

  const before = await read(page)
  await page.getByRole('button', { name: '编辑正文', exact: true }).click()
  const contentEditor = page.locator('.source-content-editor')
  const navigationDraft = `${markdown}\n输入后立即离开，导航必须先保存草稿。`
  await contentEditor.getByRole('textbox', { name: '材料正文', exact: true }).fill(navigationDraft)
  // Leave immediately, inside the autosave debounce; the navigation guard owns this flush.
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await expect(page.getByRole('button', { name: '学习概览', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(contentEditor).toHaveCount(0)
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.getByRole('button', { name: '编辑正文', exact: true }).click()
  await expect(contentEditor.getByRole('textbox', { name: '材料正文', exact: true })).toHaveValue(
    navigationDraft,
  )
  expect((await read(page)).sources.find((item) => item.id === source.id)?.mediaId).toBe(
    source.mediaId,
  )
  const updated = `${markdown}\n新版本新增段落，草稿重载验证。`
  await contentEditor.getByRole('textbox', { name: '材料正文', exact: true }).fill(updated)
  await expect(contentEditor.getByRole('status')).toHaveText('草稿已保存')
  // Reload before committing: recover the private draft; original body/version stays intact.
  expect((await read(page)).sources.find((item) => item.id === source.id)?.mediaId).toBe(
    source.mediaId,
  )
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.getByRole('button', { name: '编辑正文', exact: true }).click()
  await expect(contentEditor.getByRole('textbox', { name: '材料正文', exact: true })).toHaveValue(
    updated,
  )
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
  await screenshot(page, 'reading-workbench-editor-dark.png')
  await contentEditor.getByRole('button', { name: '保存为新版本', exact: true }).click()
  await expect(contentEditor).toHaveCount(0)
  await expect
    .poll(async () => (await read(page)).sources.find((item) => item.id === source.id)?.mediaId)
    .not.toBe(source.mediaId)
  const after = await read(page)
  const changed = after.sources.find((item) => item.id === source.id)!
  expect(changed.versions?.some((version) => version.mediaId === source.mediaId)).toBe(true)
  expect(changed.annotations).toEqual(
    before.sources.find((item) => item.id === source.id)!.annotations,
  )
  expect(after.notes).toEqual(before.notes)
  expect(after.cards).toEqual(before.cards)
  expect(after.reviews).toEqual(before.reviews)
  expect(after.practices).toEqual(before.practices)
  await expect(page.locator('.source-annotations')).toContainText('来自历史版本')
  await page.locator('.source-annotations .annotation-quote').click()
  await expect(page.getByRole('dialog')).toContainText(quote)
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await page.setViewportSize({ width: 760, height: 1000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await screenshot(page, 'reading-workbench-narrow-dark.png')
})

test('material tree creates, moves and renames folders while preserving material and study identities', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await importReading(page, '目录材料 A', 'plain', '组织之前和之后的正文不变。')
  await importReading(page, '目录材料 B', 'plain', '第二篇材料保留原始身份。')
  const before = await read(page)
  const source = before.sources.find((item) => item.title === '目录材料 A')!
  await page.getByRole('button', { name: '目录', exact: true }).click()
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click()
  await page.getByRole('textbox', { name: '文件夹名称' }).fill('计算机科学')
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.locator('.folder-title')).toHaveText('计算机科学')
  const row = page
    .locator('.material-tree li')
    .filter({ has: page.locator('.source-list-title').filter({ hasText: source.title }) })
  await row.locator('summary').click()
  await row.getByRole('button', { name: '移动', exact: true }).click()
  await selectUiValue(page.getByRole('combobox', { name: '移动到' }), {
    label: '文件夹 · 计算机科学',
  })
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
  const folder = (await folders(page))[0]!.value
  await expect
    .poll(async () => (await read(page)).sources.find((item) => item.id === source.id)?.folderId)
    .toBe(folder.id)
  const folderRow = page.locator('.material-tree li').filter({ has: page.locator('.folder-title') })
  await folderRow.locator('summary').click()
  await folderRow.getByRole('button', { name: '重命名', exact: true }).click()
  await page.getByRole('textbox', { name: '文件夹名称' }).fill('知识材料')
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.locator('.folder-title')).toHaveText('知识材料')
  await screenshot(page, 'reading-workbench-organization-light.png')
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await page.getByRole('button', { name: '目录', exact: true }).click()
  await expect(page.locator('.folder-title')).toHaveText('知识材料')
  const after = await read(page)
  expect(after.sources.map((item) => [item.id, item.mediaId]).sort()).toEqual(
    before.sources.map((item) => [item.id, item.mediaId]).sort(),
  )
  expect(after.sources.find((item) => item.id === source.id)?.folderId).toBe(folder.id)
  expect(after.cards).toEqual(before.cards)
  expect(after.reviews).toEqual(before.reviews)
})

test('fulltext search, persisted synonyms, stable Wiki previews and backlinks share the accepted source versions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await importReading(
    page,
    '检索目标',
    'markdown',
    '# 核心\n\nUse spaced repetition to retain important knowledge.\n',
  )
  const target = (await read(page)).sources[0]!
  await importReading(page, '重名', 'markdown', '第一份重名候选。')
  await importReading(page, '重名', 'markdown', '第二份重名候选。')
  await importReading(
    page,
    '链接入口',
    'markdown',
    `# 关联材料\n\n阅读 [[source:${encodeURIComponent(target.id)}|稳定链接]] 和 [[重名]]。\n`,
  )
  const search = page.getByRole('region', { name: '材料全文搜索', exact: true })
  await search.getByRole('textbox', { name: '材料全文搜索', exact: true }).fill('retain important')
  await search.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(search.locator('.material-search-result')).toHaveCount(1)
  await search.locator('.material-search-result').click()
  await expect(page.locator('.source-reader h2')).toHaveText(target.title)
  await expect
    .poll(async () =>
      page
        .locator('.source-text')
        .evaluate((element: HTMLTextAreaElement) =>
          element.value.slice(element.selectionStart, element.selectionEnd),
        ),
    )
    .toBe('retain')

  await search.getByRole('button', { name: '同义词设置', exact: true }).click()
  await expect(page.locator('[data-category-key="general.search"]')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByLabel('同义词组', { exact: true }).fill('记忆曲线, spaced repetition')
  await page.getByRole('button', { name: '保存规则', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '同义词规则已保存。' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '学习材料', exact: true }).click()
  await search.getByRole('textbox', { name: '材料全文搜索', exact: true }).fill('记忆曲线')
  await search.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(search.locator('.material-search-result')).toHaveCount(1)
  await expect(search.locator('.material-search-result')).toContainText(target.title)
  await search.getByRole('checkbox', { name: '扩展同义词', exact: true }).uncheck()
  await search.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(search.getByRole('status')).toHaveText('没有找到材料。')
  await open(page, target.title)
  await page.locator('.source-links summary').click()
  await expect(page.locator('.source-links .wiki-result')).toContainText('链接入口')
  await page.locator('.source-links .wiki-result').click()
  await expect(page.locator('.source-reader h2')).toHaveText('链接入口')
  await preview(page)
  await page
    .locator('.source-markdown-preview')
    .getByRole('link', { name: '重名', exact: true })
    .click()
  await expect(page.locator('.wiki-preview')).toContainText('有多个同名材料')
  await expect(page.locator('.wiki-preview .wiki-result')).toHaveCount(2)
  await page
    .locator('.source-markdown-preview')
    .getByRole('link', { name: '稳定链接', exact: true })
    .click()
  await expect(page.locator('.wiki-preview .wiki-result')).toHaveCount(1)
  await expect(page.locator('.wiki-preview')).toContainText('spaced repetition')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
  await screenshot(page, 'reading-workbench-search-wiki-dark.png')
  await page.locator('.wiki-preview .wiki-result').click()
  await expect(page.locator('.source-reader h2')).toHaveText(target.title)
  await page.getByRole('button', { name: '编辑正文', exact: true }).click()
  const contentEditor = page.locator('.source-content-editor')
  await contentEditor.getByRole('button', { name: '属性与来源', exact: true }).click()
  await contentEditor.getByLabel('标题', { exact: true }).fill('已改名目标')
  await contentEditor.getByRole('button', { name: '保存为新版本', exact: true }).click()
  await expect(contentEditor).toHaveCount(0)
  await open(page, '链接入口')
  await preview(page)
  await page
    .locator('.source-markdown-preview')
    .getByRole('link', { name: '稳定链接', exact: true })
    .click()
  await expect(page.locator('.wiki-preview')).toContainText('已改名目标')
  await expect(page.locator('.wiki-preview .wiki-result')).toHaveCount(1)
})
