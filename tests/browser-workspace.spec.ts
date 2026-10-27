import { setInterfaceLanguage } from './fixtures/settings-flow'
import { test, expect, type Page } from '@playwright/test'
import { openAsBlob } from 'node:fs'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { browserWorkspaceFixture, directoryDigest } from './fixtures/browser-workspace'
import { storedLibrary } from './fixtures/stored-library'
import { parseArchive } from '../src/core/archive'

test.use({ serviceWorkers: 'block' })
async function folderFallback(page: Page) {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }),
  )
}
async function open(page: Page, path: string) {
  await page.getByRole('button', { name: '工作目录', exact: true }).first().click()
  await page.getByLabel('选择工作目录文件夹', { exact: true }).setInputFiles(path)
  await expect(page.getByRole('region', { name: '工作目录预览' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '开始试用', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '工作目录试用' })).toBeVisible()
}

test('a real directory supports trial review, editing, source versions and a complete export without changing either original library', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const env = await browserWorkspaceFixture()
  try {
    const before = await directoryDigest(env.path),
      errors: string[] = [],
      posts: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      if (request.method() !== 'GET') posts.push(request.url())
    })
    await folderFallback(page)
    await page.clock.setSystemTime(new Date('2026-12-01T12:00:00Z'))
    await page.goto('./')
    await expect(page.locator('.deck-title').first()).toBeVisible()
    const original = await storedLibrary(page)
    await open(page, env.path)
    expect(await storedLibrary(page)).toEqual(original)
    await page.getByRole('button', { name: '学习概览', exact: true }).click()
    await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
    await expect(page.locator('.card-question')).toHaveText('目录里的问题')
    await expect
      .poll(() =>
        page
          .getByRole('img', { name: 'pixel.png' })
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(1)
    await page.getByRole('button', { name: '显示答案', exact: true }).click()
    await expect(page.locator('.card-answer')).toContainText('目录里的答案')
    await expect
      .poll(() =>
        page
          .locator('audio')
          .first()
          .evaluate((audio: HTMLAudioElement) => audio.duration),
      )
      .toBeGreaterThan(500)
    await page.getByRole('button', { name: /^重来/ }).click()
    await page.keyboard.press('Control+z')
    await expect(page.locator('.card-question')).toHaveText('目录里的问题')
    await page.getByRole('button', { name: /^全部卡片/ }).click()
    await page.getByRole('button', { name: '编辑卡片 目录里的问题', exact: true }).click()
    await page.getByLabel('正面 · 问题', { exact: true }).fill('只修改网页副本')
    await page.getByRole('button', { name: '保存卡片', exact: true }).click()
    await expect(
      page.getByRole('button', { name: '编辑卡片 只修改网页副本', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '学习材料', exact: true }).click()
    await page.locator('.source-list-title').filter({ hasText: '目录里的长材料' }).click()
    await expect(page.getByRole('textbox', { name: '材料正文', exact: true })).toHaveValue(env.text)
    await page.getByRole('button', { name: '历史版本', exact: true }).click()
    await page
      .getByRole('dialog', { name: '历史版本', exact: true })
      .getByRole('button', { name: /版本 1/ })
      .click()
    const originalText = page.getByRole('dialog').locator('.source-original')
    await expect(originalText).toBeVisible()
    expect(await originalText.textContent()).toBe(env.oldText)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '练习历史', exact: true }).click()
    await page.locator('.attempt-history summary').first().click()
    await expect(page.locator('.attempt-body')).toContainText('attempt')
    await page.getByRole('button', { name: '数据与备份', exact: true }).click()
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出 .repeaty', exact: true }).click()
    const download = await downloaded
    const restored = await parseArchive(await openAsBlob((await download.path())!))
    expect(restored.library.notes.find((note) => note.id === env.note.id)!.front).toBe(
      '只修改网页副本',
    )
    expect(restored.library.reviews).toEqual(env.library.reviews)
    expect(restored.library.attempts).toHaveLength(3)
    expect(restored.library.attempts[0]!.code).toContain('attempt 0')
    expect(restored.assets).toHaveLength(env.assets.length)
    await page.getByRole('button', { name: '工作目录', exact: true }).first().click()
    await page.screenshot({ path: testInfo.outputPath('workspace-trial.png'), fullPage: true })
    await page.getByRole('button', { name: '返回浏览器学习库', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '结束当前试用' })).toBeVisible()
    await page.getByRole('button', { name: '继续试用', exact: true }).click()
    await expect(page.getByRole('complementary', { name: '工作目录试用' })).toBeVisible()
    await page.getByRole('button', { name: '返回浏览器学习库', exact: true }).click()
    await page.getByRole('button', { name: '结束试用', exact: true }).click()
    await expect(page.getByRole('complementary', { name: '工作目录试用' })).toHaveCount(0)
    expect(await storedLibrary(page)).toEqual(original)
    expect(await directoryDigest(env.path)).toEqual(before)
    expect(errors).toEqual([])
    expect(posts).toEqual([])
  } finally {
    await env.close()
  }
})

test('unfinished and incomplete directories and cancelled reads leave the browser library intact', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000)
  const env = await browserWorkspaceFixture()
  try {
    await folderFallback(page)
    await page.goto('./')
    await expect(page.locator('.deck-title').first()).toBeVisible()
    const original = await storedLibrary(page)
    await page.getByRole('button', { name: '工作目录', exact: true }).click()
    const input = page.getByLabel('选择工作目录文件夹', { exact: true })
    await writeFile(join(env.path, '.repeaty/state.sqlite3-wal'), 'not-checkpointed')
    await input.setInputFiles(env.path)
    await expect(page.getByRole('alert')).toContainText('还有未完成的保存')
    await rm(join(env.path, '.repeaty/state.sqlite3-wal'))
    let release!: () => void
    const delayed = new Promise<void>((resolve) => {
      release = resolve
    })
    await context.route('**/*sql-wasm*.wasm', async (route) => {
      await delayed
      await route.continue().catch(() => {})
    })
    await input.setInputFiles(env.path)
    await expect(page.getByRole('status')).toContainText('正在读取工作目录')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    release()
    await context.unroute('**/*sql-wasm*.wasm')
    await expect(page.getByRole('button', { name: '开始试用', exact: true })).toHaveCount(0)
    expect(await storedLibrary(page)).toEqual(original)
    await open(page, env.path)
    await page.getByRole('button', { name: '工作目录', exact: true }).first().click()
    await page.getByRole('button', { name: '返回浏览器学习库', exact: true }).click()
    await expect(page.getByRole('complementary', { name: '工作目录试用' })).toHaveCount(0)
    const missing = join(env.root, 'without-private-files')
    await mkdir(missing)
    await writeFile(
      join(missing, 'workspace.json'),
      await readFile(join(env.path, 'workspace.json')),
    )
    await input.setInputFiles(missing)
    await expect(page.getByRole('alert')).toContainText('包括隐藏的 .repeaty 文件夹')
    expect(await storedLibrary(page)).toEqual(original)
  } finally {
    await env.close()
  }
})

test('the read-only directory picker runs in a real Worker and the English narrow layout remains usable', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const env = await browserWorkspaceFixture()
  try {
    const before = await directoryDigest(env.path)
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: async (options: unknown) => {
          const state = window as unknown as {
            __directory?: FileSystemDirectoryHandle
            __options?: unknown
          }
          state.__options = options
          return state.__directory
        },
      })
    })
    await page.goto('./')
    const entries = await Promise.all(
      Object.keys(before).map(async (path) => ({
        path,
        bytes: (await readFile(join(env.path, path))).toString('base64'),
      })),
    )
    await page.evaluate(async (entries) => {
      const root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('picker-workspace', { create: true })
      for (const entry of entries) {
        const parts = entry.path.split('/'),
          leaf = parts.pop()!
        let directory = root
        for (const part of parts)
          directory = await directory.getDirectoryHandle(part, { create: true })
        const stream = await (
          await directory.getFileHandle(leaf, { create: true })
        ).createWritable()
        await stream.write(Uint8Array.from(atob(entry.bytes), (char) => char.charCodeAt(0)))
        await stream.close()
      }
      const state = window as unknown as { __directory: FileSystemDirectoryHandle }
      state.__directory = root
    }, entries)
    await setInterfaceLanguage(page, 'en')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Workspace', exact: true }).click()
    await page.getByRole('button', { name: 'Open local workspace', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Workspace preview' })).toBeVisible({
      timeout: 30_000,
    })
    expect(
      await page.evaluate(() => (window as unknown as { __options: unknown }).__options),
    ).toEqual({ mode: 'read' })
    await page.getByRole('button', { name: 'Start trial', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Workspace trial' })).toContainText(
      'original folder is unchanged',
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('workspace-trial-en-narrow.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Workspace', exact: true }).first().click()
    await page.getByRole('button', { name: 'Return to browser library', exact: true }).click()
    expect(await directoryDigest(env.path)).toEqual(before)
  } finally {
    await env.close()
  }
})

test('a thousand-card workspace stays usable through consecutive ratings', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const env = await browserWorkspaceFixture(1000)
  try {
    const before = await directoryDigest(env.path)
    await folderFallback(page)
    await page.clock.setSystemTime(new Date('2026-12-01T12:00:00Z'))
    await page.goto('./')
    await open(page, env.path)
    await page.getByRole('button', { name: /^全部卡片/ }).click()
    await expect(page.locator('tbody tr')).toHaveCount(50)
    await page.getByRole('button', { name: '学习概览', exact: true }).click()
    await page.getByRole('button', { name: '开始复习', exact: true }).first().click()
    await page.evaluate(() => {
      const state = window as unknown as { __ratingFrames: number[] }
      state.__ratingFrames = []
      let previous = performance.now()
      const tick = (now: number) => {
        state.__ratingFrames.push(now - previous)
        previous = now
        if (state.__ratingFrames.length < 2000) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const durations: number[] = []
    for (let index = 0; index < 3; index++) {
      const question = page.locator('.card-question'),
        text = await question.textContent()
      await page.getByRole('button', { name: '显示答案', exact: true }).click()
      const begin = Date.now()
      await page.getByRole('button', { name: /^良好/ }).click()
      await expect(question).not.toHaveText(text!)
      durations.push(Date.now() - begin)
    }
    const frames = await page.evaluate(
      () => (window as unknown as { __ratingFrames: number[] }).__ratingFrames,
    )
    const timingPath = testInfo.outputPath('rating-responsiveness.json')
    await writeFile(
      timingPath,
      JSON.stringify(
        {
          cards: env.library.cards.length,
          ratingsMs: durations,
          maxFrameGapMs: Math.max(...frames),
        },
        null,
        2,
      ),
    )
    await testInfo.attach('rating-responsiveness', {
      path: timingPath,
      contentType: 'application/json',
    })
    expect(await directoryDigest(env.path)).toEqual(before)
  } finally {
    await env.close()
  }
})

test.describe('offline workspace trial', () => {
  test.use({ serviceWorkers: 'allow' })
  test('opens a local directory offline after the static app is cached', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000)
    const env = await browserWorkspaceFixture()
    try {
      await folderFallback(page)
      await page.goto('./')
      await expect(page.locator('.deck-title').first()).toBeVisible()
      await expect
        .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
        .toBe(true)
      await context.setOffline(true)
      await page.reload()
      await open(page, env.path)
      await page.getByRole('button', { name: '学习材料', exact: true }).click()
      await page.locator('.source-list-title').filter({ hasText: '目录里的长材料' }).click()
      await expect(page.getByRole('textbox', { name: '材料正文', exact: true })).toHaveValue(
        env.text,
      )
    } finally {
      await context.setOffline(false)
      await env.close()
    }
  })
})
