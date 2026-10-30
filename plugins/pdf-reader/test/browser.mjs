import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = fileURLToPath(
  new URL('../../../docs/local-plans.local/foliole-coverage-2026-10-29/p4/pdf/', import.meta.url),
)
await mkdir(output, { recursive: true })
const server = await createServer({
  configFile: new URL('./vite.config.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
  root,
})
await server.listen()
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
})
const page = await browser.newPage({ viewport: { width: 1150, height: 900 }, deviceScaleFactor: 1 })
const errors = [],
  external = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('request', (request) => {
  if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4197/'))
    external.push(request.url())
})
try {
  await page.goto('http://127.0.0.1:4197/test/harness.html')
  await page.waitForFunction(() => !!window.pdfTest)
  const candidates = await page.evaluate(() => window.pdfTest.parse('two-column-rotated.pdf'))
  assert.equal(candidates.length, 1)
  assert.ok(candidates[0].text.includes('重复'))
  assert.deepEqual(await page.evaluate(() => window.pdfTest.active), {
    workers: 0,
    urls: 0,
    scopes: 0,
  })
  await page.evaluate(() => window.pdfTest.mount('two-column-rotated.pdf'))
  await page.waitForFunction(
    () => document.querySelectorAll('[data-pdf-page="1"] [data-pdf-start]').length >= 4,
  )
  await page.waitForFunction(() =>
    [...document.querySelectorAll('canvas')].some((canvas) => canvas.width > 100),
  )
  const geometry = await page.evaluate(() =>
    [...document.querySelectorAll('[data-pdf-page]')].map((page) => {
      const rect = page.getBoundingClientRect(),
        span = page.querySelector('[data-pdf-start]').getBoundingClientRect()
      return {
        page: page.dataset.pdfPage,
        width: rect.width,
        height: rect.height,
        span: { x: span.x - rect.x, y: span.y - rect.y, width: span.width, height: span.height },
      }
    }),
  )
  for (const item of geometry) {
    assert.ok(item.span.x >= 0 && item.span.x < item.width, JSON.stringify(item))
    assert.ok(item.span.y >= 0 && item.span.y < item.height, JSON.stringify(item))
    assert.ok(item.span.width > 1 && item.span.height > 1)
  }
  await page.evaluate(async () => {
    const canvas = document.querySelector('canvas')
    canvas.dataset.stableReader = 'retained'
    await window.pdfTest.updateMetadata()
  })
  assert.equal(await page.locator('canvas').first().getAttribute('data-stable-reader'), 'retained')
  // A delayed scroll report must never overwrite an unfinished page-number edit.
  // At this width the rotated last page is shorter than the viewport, so the
  // previous page remains partly visible even after reaching the scroll limit.
  await page.locator('#app').evaluate((element) => {
    element.style.width = '520px'
  })
  await page.waitForFunction(() => {
    const viewport = document.querySelector('[data-pdf-scroll]')
    const last = document.querySelector('[data-pdf-page="1"]')
    return (
      last.getBoundingClientRect().width < 520 &&
      last.getBoundingClientRect().height < viewport.clientHeight
    )
  })
  const pageNumber = page.getByRole('spinbutton', { name: 'PDF 页码' })
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(() => window.pdfTest.position({ projectionOffset: 0 }))
    await page.waitForFunction(
      () => document.querySelector('[aria-label="PDF 页码"]').value === '1',
    )
    await pageNumber.fill('2')
    await page.evaluate(() => {
      window.pdfTest.state.position = undefined
      document.querySelector('[data-pdf-scroll]').dispatchEvent(new Event('scroll'))
    })
    // Wait for the actual debounced callback before submitting, not an arbitrary timeout.
    await page.waitForFunction(() => window.pdfTest.state.position !== undefined)
    assert.equal(await pageNumber.inputValue(), '2', 'scroll reporting overwrote the page edit')
    await pageNumber.press('Enter')
    await page.waitForFunction(() => document.querySelector('[data-pdf-scroll]').scrollTop > 10)
    await page.evaluate(() => {
      window.pdfTest.state.position = undefined
      document.querySelector('[data-pdf-scroll]').dispatchEvent(new Event('scroll'))
    })
    await page.waitForFunction(() => window.pdfTest.state.position !== undefined)
    await pageNumber.blur()
    assert.equal(
      await pageNumber.inputValue(),
      '2',
      'the short final page was replaced by the preceding visible page',
    )
    assert.equal(
      await page.evaluate(() => window.pdfTest.state.position.locator.regions[0].page),
      1,
    )
    assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).isDisabled(), true)
  }
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await page.locator('#app').evaluate((element) => {
    element.style.width = ''
  })
  await page.waitForFunction(
    () => document.querySelector('[data-pdf-page="0"]').getBoundingClientRect().width > 600,
  )
  // The browser selection spans two columns and then two pages, including a cropped/rotated page.
  for (const crossPage of [false, true]) {
    const selected = await page.evaluate((crossPage) => {
      const pages = [...document.querySelectorAll('[data-pdf-page]')]
      const first = [...pages[0].querySelectorAll('[data-pdf-start]')].filter(
        (span) => span.textContent,
      )
      const second = [...pages[crossPage ? 1 : 0].querySelectorAll('[data-pdf-start]')].filter(
        (span) => span.textContent,
      )
      const start = crossPage ? first[first.length - 1] : first[0],
        end = crossPage ? second[0] : second[second.length - 1]
      const range = document.createRange()
      range.setStart(start.firstChild, Math.min(1, start.textContent.length - 1))
      range.setEnd(end.firstChild, end.textContent.length)
      window.getSelection().removeAllRanges()
      window.getSelection().addRange(range)
      document
        .querySelector('[data-pdf-scroll]')
        .dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      return window.pdfTest.state.selection
    }, crossPage)
    assert.ok(selected, 'native selection must reach the host')
    assert.equal(
      selected.text,
      candidates[0].text.slice(selected.projection.start, selected.projection.end),
    )
    assert.equal(
      new Set(selected.locator.regions.map((region) => region.page)).size,
      crossPage ? 2 : 1,
      JSON.stringify(selected),
    )
    for (const region of selected.locator.regions)
      assert.ok(
        region.x >= 0 &&
          region.y >= 0 &&
          region.width > 0 &&
          region.height > 0 &&
          region.x + region.width <= 1.00001 &&
          region.y + region.height <= 1.00001,
      )
  }
  const saved = await page.evaluate(() => window.pdfTest.state.selection)
  await page.getByRole('button', { name: '旋转 0°', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.pdf-text-layer').getAttribute('data-main-rotation') === '90',
  )
  assert.deepEqual(await page.evaluate(() => window.pdfTest.state.selection), saved)
  assert.ok((await page.locator('.pdf-page-highlights i').count()) >= 2)
  await page.getByRole('combobox', { name: 'PDF 缩放' }).selectOption('1.5')
  await page.getByRole('searchbox', { name: '在 PDF 章节搜索' }).fill('重复')
  await page.waitForFunction(
    () => document.querySelector('.pdf-search-count')?.textContent === '1/4',
  )
  await page.getByRole('button', { name: '下一个搜索结果' }).click()
  assert.equal(await page.locator('.pdf-search-count').textContent(), '2/4')
  await page.screenshot({ path: output + 'pdf-reader-chromium.png' })
  await page.evaluate(() => window.pdfTest.unmount())
  assert.deepEqual(await page.evaluate(() => window.pdfTest.active), {
    workers: 0,
    urls: 0,
    scopes: 0,
  })
  // A review/return-to-source mount uses persisted locators, never a string-search fallback.
  await page.evaluate((saved) => window.pdfTest.mount('two-column-rotated.pdf', 0, saved), saved)
  await page.waitForFunction(() => document.querySelectorAll('.pdf-page-highlights i').length >= 2)
  assert.equal(await page.getByRole('combobox', { name: 'PDF 缩放' }).inputValue(), '1.5')
  await page.getByRole('button', { name: '旋转 90°', exact: true }).waitFor()
  const textSelection = await page.evaluate(() => {
    const span = document.querySelector('[data-pdf-page="1"] [data-pdf-start]')
    const start = Number(span.dataset.pdfStart) + 1,
      end = start + 2
    const text = window.pdfTest.state.candidates[0].text.slice(start, end)
    const value = {
      locator: {
        schemaVersion: 1,
        kind: 'text',
        sourceId: 'source-0',
        versionId: 'version-0',
        start,
        end,
        quote: text,
      },
      text,
    }
    window.pdfTest.select(value)
    return value
  })
  await page.waitForFunction(
    () => !!document.querySelector('[data-pdf-page="1"] [data-pdf-location]'),
  )
  const located = await page
    .locator('[data-pdf-page="1"] [data-pdf-location]')
    .first()
    .boundingBox()
  const scroll = await page.locator('[data-pdf-scroll]').boundingBox()
  assert.ok(
    located.y >= scroll.y && located.y < scroll.y + scroll.height,
    JSON.stringify({ located, scroll }),
  )
  await page.evaluate(() => window.pdfTest.position({ projectionOffset: 0 }))
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="PDF 页码"]')?.value === '1',
  )
  const scrollAtStart = await page
    .locator('[data-pdf-scroll]')
    .evaluate((element) => element.scrollTop)
  await page.evaluate(
    (offset) => window.pdfTest.position({ projectionOffset: offset }),
    textSelection.locator.start,
  )
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="PDF 页码"]')?.value === '2',
  )
  assert.ok(
    (await page.locator('[data-pdf-scroll]').evaluate((element) => element.scrollTop)) >
      scrollAtStart,
  )
  const callsBeforeReadOnly = await page.evaluate(() => ({
    reads: window.pdfTest.storedViews.reads,
    writes: window.pdfTest.storedViews.writes,
  }))
  await page.evaluate(
    (selection) =>
      window.pdfTest.mount('two-column-rotated.pdf', 0, selection, undefined, { readOnly: true }),
    textSelection,
  )
  await page.waitForFunction(
    () => !!document.querySelector('[data-pdf-page="1"] [data-pdf-location]'),
  )
  assert.equal(await page.getByRole('combobox', { name: 'PDF 缩放' }).inputValue(), 'fit')
  await page.getByRole('button', { name: '旋转 0°', exact: true }).click()
  await page.getByRole('combobox', { name: 'PDF 缩放' }).selectOption('2')
  await page.waitForFunction(
    () => document.querySelector('.pdf-text-layer')?.getAttribute('data-main-rotation') === '90',
  )
  assert.deepEqual(
    await page.evaluate(() => ({
      reads: window.pdfTest.storedViews.reads,
      writes: window.pdfTest.storedViews.writes,
    })),
    callsBeforeReadOnly,
  )
  await page.evaluate(() =>
    window.pdfTest.mount('two-column-rotated.pdf', 0, undefined, undefined, {
      version: 'new-version',
    }),
  )
  await page.waitForFunction(
    () => document.querySelectorAll('[data-pdf-page="1"] [data-pdf-start]').length >= 4,
  )
  assert.equal(await page.getByRole('combobox', { name: 'PDF 缩放' }).inputValue(), 'fit')
  await page.getByRole('button', { name: '旋转 0°', exact: true }).waitFor()
  await page.evaluate(() => window.pdfTest.unload())
  assert.deepEqual(await page.evaluate(() => window.pdfTest.active), {
    workers: 0,
    urls: 0,
    scopes: 0,
  })
  await page.evaluate(() => window.pdfTest.unmount())
  for (const mode of [true, 'during']) {
    const cancelled = await page.evaluate(async (mode) => {
      try {
        await window.pdfTest.parse('two-column-rotated.pdf', mode)
        return ''
      } catch (error) {
        return error.name
      }
    }, mode)
    assert.equal(cancelled, 'AbortError')
    assert.deepEqual(await page.evaluate(() => window.pdfTest.active), {
      workers: 0,
      urls: 0,
      scopes: 0,
    })
  }
  const damaged = await page.evaluate(async () => {
    try {
      await window.pdfTest.parse('damaged.pdf')
      return ''
    } catch (error) {
      return error.message
    }
  })
  assert.ok(damaged)
  assert.deepEqual(await page.evaluate(() => window.pdfTest.active), {
    workers: 0,
    urls: 0,
    scopes: 0,
  })
  const image = await page.evaluate(() => window.pdfTest.parse('image-only.pdf'))
  assert.equal(image[0].text, '[PDF 第 1 页：无可提取文字]')
  await page.evaluate(() => window.pdfTest.mount('image-only.pdf'))
  await page.getByText('此页没有可提取文字，可阅读原图；尚未进行 OCR。').waitFor()
  await page.evaluate(() => window.pdfTest.unmount())
  const chapters = await page.evaluate(() => window.pdfTest.parse('chapters.pdf'))
  assert.equal(chapters.length, 3)
  assert.equal(chapters[0].container, true)
  assert.equal(chapters[1].documentData.pageEnd, 49)
  assert.equal(chapters[2].documentData.pageStart, 50)
  await page.evaluate(() => window.pdfTest.mount('chapters.pdf'))
  await page.getByRole('button', { name: /51–52 页/ }).click()
  assert.equal(await page.evaluate(() => window.pdfTest.state.opened), 'source-2')
  await page.evaluate(() => window.pdfTest.mount('chapters.pdf', 2))
  await page.waitForFunction(
    () => document.querySelectorAll('[data-pdf-page="51"] [data-pdf-start]').length > 0,
  )
  await page.evaluate(() => window.pdfTest.unmount())
  assert.deepEqual(await page.evaluate(() => window.pdfTest.active), {
    workers: 0,
    urls: 0,
    scopes: 0,
  })
  assert.deepEqual(external, [], 'no external network request is permitted for an offline PDF')
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'real worker import',
        'offline CMap/fonts',
        'canvas/text layer geometry',
        'page-number edits survive delayed scroll reports',
        'short last page remains current at the scroll limit',
        'cross-column selection',
        'cross-page cropped/rotated selection',
        'rotation/zoom',
        'search',
        'review locator restore',
        'exact text projection location',
        'host restart and resume offsets without a locator',
        'per-version zoom/rotation memory',
        'read-only view never reads or writes preferences',
        'unmount/unload cleanup',
        'pre-cancel and active-worker cancel',
        'damaged PDF',
        'image-only page',
        '52-page container and child reader',
      ],
      geometry,
    }),
  )
} finally {
  await browser.close()
  await server.close()
}
