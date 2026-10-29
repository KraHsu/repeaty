import { expect, type Page, type TestInfo } from '@playwright/test'
import { fixture, input, now } from '../../src/core/test-fixtures'
import { saveNote } from '../../src/core/model'
import type { Library } from '../../src/core/model'
import { seedPolish } from './polish-flow'
import { importReading, moveReading, saveReading, readingText } from './reading-flow'
import { startMixed } from './adaptive-mixed-flow'
import { modalOutsidePoint, setResponsiveViewport } from './viewport-flow'

async function undoAction(page: Page, shortcut = 'Control+z') {
  // A new question can render before the surrounding save promise has settled.
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
  await page.keyboard.press(shortcut)
}

export async function rendering027Flow(page: Page, info: TestInfo) {
  const external: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('example.invalid')) external.push(request.url())
  })
  const front =
    'First line\nSecond line\n\nNext paragraph\n\n' +
    '\\(x^2\\)\n\n\\[\n\\frac{1}{2}\n\\]\n\n' +
    '| A | B |\n| - | - |\n| 1 | 2 |\n\n' +
    '<style>.styled { color: rgb(12, 34, 56) } .topbar { display: none } ' +
    '.styled { background: url(https://example.invalid/css) }</style>\n\n' +
    '<div class="styled" style="padding:12px;border:1px solid #ccc">Styled HTML</div>\n\n' +
    '<img alt="Inline picture" style="width:80px;height:40px" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=">\n\n' +
    '<img src="https://example.invalid/image" onerror="globalThis.cardExecuted=true">' +
    '<script>globalThis.cardExecuted=true</script>'
  let library = fixture({
    ...input,
    front,
    back: 'Answer line\nSame paragraph\n\nAnother paragraph',
    format: 'markdown',
  })
  library = saveNote(
    library,
    {
      ...input,
      format: 'plain',
      front: 'Plain first\nPlain second\n\n' + 'Long prose. '.repeat(40),
      back: 'Plain answer\nNext line\n\nNew paragraph',
    },
    undefined,
    false,
    new Date(now.getTime() + 1000),
  )
  await seedPolish(page, library)
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.locator('.b-start-review').click()
  const question = page.locator('.card-question')
  await expect(question.locator('.rich-content')).toHaveCSS('text-align', 'left')
  await expect(question.locator('.styled')).toHaveCSS('color', 'rgb(12, 34, 56)')
  await expect(page.locator('.topbar')).toBeVisible()
  await expect(question.locator('.katex-display')).toHaveCount(1)
  await expect(question.locator('.katex')).toHaveCount(2)
  const layout = await question.evaluate((element) => {
    const content = element.querySelector('.rich-content')!.getBoundingClientRect()
    const paragraphs = element.querySelectorAll('p')
    const first = paragraphs[0]!,
      second = paragraphs[1]!
    const firstBounds = first.getBoundingClientRect(),
      secondBounds = second.getBoundingClientRect()
    const image = element.querySelector('img[alt="Inline picture"]')!.getBoundingClientRect()
    const table = element.querySelector('table')!.getBoundingClientRect()
    return {
      gap: secondBounds.top - firstBounds.bottom,
      lineHeight: parseFloat(getComputedStyle(first).lineHeight),
      imageCenter: Math.abs((image.left + image.right) / 2 - (content.left + content.right) / 2),
      tableCenter: Math.abs((table.left + table.right) / 2 - (content.left + content.right) / 2),
    }
  })
  expect(layout.gap).toBeGreaterThan(layout.lineHeight * 0.4)
  expect(layout.imageCenter).toBeLessThan(2)
  expect(layout.tableCenter).toBeLessThan(2)
  await page.screenshot({ path: info.outputPath('rendering-027-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.locator('.card-answer .card-content')).toHaveCSS('text-align', 'left')
  await page.getByRole('button', { name: /^良好/ }).click()
  await expect(question).toHaveClass(/long-content/)
  await expect(question.locator('.plain-content')).toHaveCSS('text-align', 'left')
  await expect(question.locator('.plain-paragraph')).toHaveCount(2)
  await expect(question.locator('.plain-paragraph').first()).toContainText(
    'Plain first\nPlain second',
  )
  expect(external).toEqual([])
  expect(
    await page.evaluate(() => (window as Window & { cardExecuted?: boolean }).cardExecuted),
  ).toBeUndefined()
  await setResponsiveViewport(page, 390, 844)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('rendering-027-mobile.png'), fullPage: true })
}

export async function modal027Flow(page: Page) {
  await seedPolish(page)
  await page.getByRole('button', { name: '学习概览', exact: true }).click()
  await page.getByRole('button', { name: '添加卡片', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '添加卡片', exact: true })
  await dialog.getByLabel('正面 · 问题', { exact: true }).fill('Keep this draft')
  const field = (await dialog.getByLabel('正面 · 问题', { exact: true }).boundingBox())!
  const inside = { x: field.x + 25, y: field.y + 25 },
    outside = await modalOutsidePoint(page)
  expect(
    await dialog.locator('.app-modal-panel').evaluate((element, point) => {
      const box = element.getBoundingClientRect()
      return point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom
    }, outside),
  ).toBe(true)
  for (const [start, end] of [
    [inside, outside],
    [outside, inside],
    [inside, inside],
  ]) {
    await page.mouse.move(start!.x, start!.y)
    await page.mouse.down()
    await page.mouse.move(end!.x, end!.y)
    await page.mouse.up()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('正面 · 问题', { exact: true })).toHaveValue('Keep this draft')
  }
  await page.mouse.click(outside.x, outside.y)
  await expect(dialog).toHaveCount(0)
}

export async function reviewActions027Flow(page: Page, read: () => Promise<Library>) {
  let library = fixture({ type: 'reversed', front: 'Original front', back: 'Original back' })
  library.decks.push({ ...library.decks[0]!, id: 'other-deck', name: 'Other deck' })
  library.notes[0]!.deckId = 'other-deck'
  library.cards.find((card) => card.variant === 'forward')!.createdAt = new Date(
    now.getTime() - 1000,
  ).toISOString()
  library = saveNote(
    library,
    { ...input, front: 'Next question' },
    undefined,
    false,
    new Date(now.getTime() + 1000),
  )
  await seedPolish(page, library)
  // This scenario spans two decks. The overview starts only its focused deck;
  // use the collection's global review entry to keep the cross-deck undo coverage.
  await page.getByRole('button', { name: '全部卡片', exact: true }).click()
  await page.getByRole('button', { name: '复习', exact: true }).click()
  const question = page.locator('.card-question')
  await expect(question).toContainText('Original front')
  await page.locator('.flashcard').click()
  await page.keyboard.press('e')
  const edit = page.getByRole('dialog', { name: '编辑卡片', exact: true })
  await edit.getByLabel('正面 · 问题', { exact: true }).fill('Edited front')
  await page.keyboard.press('Control+Enter')
  await expect(edit).toHaveCount(0)
  await expect(question).toContainText('Edited front')
  await undoAction(page)
  await expect(question).toContainText('Original front')
  expect((await read()).reviews).toEqual([])
  // Attach real stored media, then restore it through delete -> undo below.
  await page.locator('.flashcard').click()
  await page.keyboard.press('e')
  await edit
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'undo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
        'base64',
      ),
    })
  await edit.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(edit).toHaveCount(0)
  await expect(page.locator('.flashcard .media-list img')).toHaveCount(1)
  await page.locator('.flashcard').click()
  await page.keyboard.press('Space')
  await page.getByLabel('更多操作', { exact: true }).click()
  await page.getByRole('menuitem', { name: /^添加/ }).click()
  const add = page.getByRole('dialog', { name: '添加卡片', exact: true })
  const beforeAdd = await read()
  await expect(add.getByLabel('所属卡组', { exact: true })).toHaveAttribute(
    'value',
    beforeAdd.decks.find((deck) => deck.name === 'Other deck')!.id,
  )
  const front = add.getByLabel('正面 · 问题', { exact: true })
  await front.fill('Draft')
  await front.press('End')
  await page.keyboard.type('-typed')
  await front.press('Control+z')
  await expect(front).not.toHaveValue('Draft-typed')
  expect((await read()).notes).toEqual(beforeAdd.notes)
  await front.fill('Added while reviewing')
  await add.getByLabel('背面 · 答案', { exact: true }).fill('Added answer')
  await add.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(add).toHaveCount(0)
  await expect(page.locator('.card-answer')).toContainText('Original back')
  expect((await read()).notes).toHaveLength(3)
  await undoAction(page)
  await expect.poll(async () => (await read()).notes.length).toBe(2)
  expect((await read()).notes).toEqual(beforeAdd.notes)
  await expect(page.locator('.card-answer')).toContainText('Original back')
  const before = await read()
  for (const key of ['b', 's']) {
    await page.locator('.flashcard').click()
    await page.keyboard.press(key)
    await expect(question).not.toContainText('Original front')
    await undoAction(page)
    await expect(question).toContainText('Original front')
    expect((await read()).cards).toEqual(before.cards)
  }
  await page.getByLabel('更多操作', { exact: true }).click()
  await page.getByRole('menuitem', { name: /^删除/ }).click()
  const confirm = page.getByRole('dialog', { name: '删除笔记', exact: true })
  await expect(confirm).toContainText('2 张')
  await page.keyboard.press('Escape')
  await expect(confirm).toHaveCount(0)
  expect((await read()).notes).toEqual(before.notes)
  await page.keyboard.press('Control+Delete')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await expect(question).toContainText('Next question')
  expect((await read()).cards).toHaveLength(1)
  await undoAction(page)
  await expect(question).toContainText('Original front')
  expect((await read()).notes).toEqual(before.notes)
  expect((await read()).cards).toEqual(before.cards)
  await expect(page.locator('.flashcard .media-list img')).toHaveCount(1)
  await expect
    .poll(() =>
      page
        .locator('.flashcard .media-list img')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true)
  await page.locator('.flashcard').click()
  await page.keyboard.press('Space')
  await page.keyboard.press('3')
  await expect(question).toContainText('Next question')
  expect((await read()).reviews).toHaveLength(1)
  await undoAction(page, 'Meta+z')
  await expect(question).toContainText('Original front')
  expect((await read()).reviews).toEqual([])
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: '快捷键', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('/')
  await expect(page.getByLabel('搜索卡片', { exact: true })).toBeFocused()
}

export async function readingUndo027Flow(page: Page, read: () => Promise<Library>) {
  await seedPolish(page)
  await importReading(page, 'Shortcut source', 'plain', readingText)
  await moveReading(page, 0.4)
  await saveReading(page)
  const position = (await read()).sources[0]!.reading
  await page.getByRole('button', { name: '归档材料', exact: true }).click()
  await expect(page.getByRole('heading', { name: '暂无待阅读材料', exact: true })).toBeVisible()
  await undoAction(page)
  await expect(page.locator('.source-reader')).toContainText('Shortcut source')
  expect((await read()).sources[0]!.reading).toMatchObject({
    offset: position!.offset,
    fraction: position!.fraction,
    view: position!.view,
  })
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  await undoAction(page)
  await expect(page.getByRole('heading', { name: '还没有学习材料', exact: true })).toBeVisible()
  await importReading(page, 'Mixed shortcut source', 'plain', readingText)
  await importReading(page, 'Mixed shortcut source B', 'plain', readingText)
  await page.getByRole('button', { name: '开始一轮阅读', exact: true }).click()
  await expect(page.locator('.reading-round')).toContainText('第 1 篇，共 2 篇')
  const first = (await page.locator('.source-reader h2').innerText()).trim()
  await page.getByRole('button', { name: '归档材料', exact: true }).click()
  await expect(page.locator('.reading-round')).toContainText('第 2 篇，共 2 篇')
  const second = (await page.locator('.source-reader h2').innerText()).trim()
  await page.getByRole('button', { name: '归档材料', exact: true }).click()
  await expect(page.locator('.reading-round-complete')).toBeVisible()
  await undoAction(page)
  await expect(page.locator('.source-reader h2')).toHaveText(second)
  await expect(page.locator('.reading-round')).toContainText('第 2 篇，共 2 篇')
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  await undoAction(page)
  await expect(page.locator('.source-reader h2')).toHaveText(first)
  await expect(page.locator('.reading-round')).toContainText('第 1 篇，共 2 篇')
  await page.getByRole('button', { name: '结束本轮', exact: true }).click()
  await startMixed(page)
  await page.locator('.flashcard').click()
  await page.keyboard.press('Space')
  await page.keyboard.press('3')
  await expect(page.locator('.source-reader h2')).toHaveText(first)
  await page.getByRole('button', { name: '读过，安排下次', exact: true }).click()
  await page.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(page.locator('.mixed-header')).toContainText('已复习 1 次 · 已处理 1 篇')
  await expect(page.locator('.source-reader h2')).toHaveText(second)
  await page.getByRole('button', { name: '读过，安排下次', exact: true }).click()
  await page.getByRole('button', { name: '保存阅读安排', exact: true }).click()
  await expect(page.locator('.mixed-header')).toContainText('已复习 1 次 · 已处理 2 篇')
  await undoAction(page)
  await expect(page.locator('.source-reader h2')).toHaveText(second)
  await expect(page.locator('.mixed-header')).toContainText('已复习 1 次 · 已处理 1 篇')
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  await undoAction(page)
  await expect(page.locator('.source-reader h2')).toHaveText(first)
  await expect(page.locator('.mixed-header')).toContainText('已复习 1 次 · 已处理 0 篇')
  await expect(page.locator('.source-text')).toHaveAttribute('aria-busy', 'false')
  await undoAction(page)
  await expect(page.locator('.flashcard')).toBeVisible()
  await expect(page.locator('.mixed-header')).toContainText('已复习 0 次 · 已处理 0 篇')
  expect((await read()).reviews).toEqual([])
}

export async function practiceUndo027Flow(page: Page, read: () => Promise<Library>) {
  await seedPolish(page, saveNote(fixture(), { ...input, front: 'Second practice question' }))
  const original = await read()
  await page.getByRole('button', { name: /^全部卡片/ }).click()
  await page.getByRole('button', { name: '专项练习', exact: true }).click()
  await page.getByRole('button', { name: '开始专项练习', exact: true }).click()
  const question = page.locator('.card-question')
  await expect(question).toHaveText(/^(?:Question|Second practice question)$/)
  const first = (await question.innerText()).trim()
  const second = first === 'Question' ? 'Second practice question' : 'Question'
  await page.locator('.flashcard').click()
  await page.keyboard.press('Space')
  await page.keyboard.press('3')
  await expect(question).toHaveText(second)
  await page.locator('.flashcard').click()
  await page.keyboard.press('e')
  const edit = page.getByRole('dialog', { name: '编辑卡片', exact: true })
  await edit.getByLabel('正面 · 问题', { exact: true }).fill('Changed during practice')
  await page.keyboard.press('Control+Enter')
  await expect(edit).toHaveCount(0)
  await expect(question).toHaveText('Changed during practice')
  await undoAction(page)
  await expect(question).toHaveText(second)
  await undoAction(page)
  await expect(question).toHaveText(first)
  expect((await read()).cards).toEqual(original.cards)
  await page.locator('.flashcard').click()
  await page.keyboard.press('a')
  const add = page.getByRole('dialog', { name: '添加卡片', exact: true })
  await add.getByLabel('正面 · 问题', { exact: true }).fill('Added during practice')
  await add.getByLabel('背面 · 答案', { exact: true }).fill('Added answer')
  await add.getByRole('button', { name: '保存卡片', exact: true }).click()
  await expect(add).toHaveCount(0)
  await page.locator('.flashcard').click()
  await page.keyboard.press('Space')
  await page.keyboard.press('3')
  await expect(question).toHaveText(second)
  await undoAction(page)
  await expect(question).toHaveText(first)
  expect((await read()).notes).toHaveLength(original.notes.length + 1)
  await undoAction(page)
  await expect.poll(async () => (await read()).notes.length).toBe(original.notes.length)
  expect((await read()).cards).toEqual(original.cards)
  expect((await read()).reviews).toEqual([])
}
