import { test, expect, storedLibrary } from './fixture'
import type { Page } from '@playwright/test'
import { resolve } from 'node:path'
import { buildPlugin } from '../../packages/plugin-api/build.mjs'
import { openPluginManager, openPluginSettings } from '../fixtures/settings-flow'

async function savedPreferences(page: Page) {
  const value = await page.evaluate(async () => {
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
        id: 'plugin:settings-design-example:shared-controls',
      },
    })
  })
  return JSON.parse(typeof value === 'string' ? value : '{}') as Record<string, unknown>
}

test('an independently built plugin uses shared accessible controls, saves preferences and fits a small desktop', async ({
  page,
}, info) => {
  test.setTimeout(90_000)
  // This independent project imports the public SDK only. It is built after the host artifact.
  const bundle = await buildPlugin(resolve('docs/examples/settings-plugin'), {
    outdir: resolve('test-results/design-system-example'),
  })
  const before = await storedLibrary(page)
  await openPluginManager(page)
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('.plugin-actions input[type=file]').setInputFiles({
    name: 'settings-design-example.repeaty-plugin',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  })
  await expect(page.locator('.settings-example')).toHaveCount(0)
  await openPluginSettings(page)
  const panel = page.locator('.plugin-configuration').filter({
    has: page.getByRole('heading', { name: 'Settings design example', exact: true }),
  })
  const demo = panel.locator('.settings-example')
  await expect(demo).toBeVisible()
  await expect(demo.locator('.ui-setting-group')).toHaveCount(2)
  const name = demo.getByRole('textbox', { name: 'Workspace name', exact: true })
  await name.fill('A shared GUI')
  await name.press('Tab')
  const password = demo.getByLabel('Demo password', { exact: true })
  await expect(password).toHaveAttribute('type', 'password')
  await password.fill('synthetic-demo-value')
  const notes = demo.getByRole('textbox', { name: 'Notes', exact: true })
  await notes.fill('Saved independently\nWithout copying host controls.')
  await notes.press('Tab')
  const limit = demo.getByRole('spinbutton', { name: 'Daily limit', exact: true })
  await limit.fill('18')
  await limit.press('Tab')
  await expect(limit).toHaveValue('18')
  await limit.fill('51')
  await limit.press('Tab')
  await expect(limit).toHaveValue('18')
  const email = demo.getByRole('textbox', { name: 'Contact email', exact: true })
  await expect(email).toHaveAttribute('aria-invalid', 'true')
  const description = await email.getAttribute('aria-describedby')
  expect(description).toBeTruthy()
  await expect(page.locator(`[id="${description}"]`)).toHaveText(
    'Enter an email address containing @.',
  )
  await email.fill('demo@example.invalid')
  await email.press('Tab')
  await expect(email).not.toHaveAttribute('aria-invalid', 'true')
  await expect(demo.getByRole('textbox', { name: 'Managed option', exact: true })).toBeDisabled()
  await expect(
    demo.getByRole('textbox', { name: 'Reference value', exact: true }),
  ).toHaveJSProperty('readOnly', true)
  const layout = demo.getByRole('combobox', { name: 'Layout density', exact: true })
  await layout.scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  const border = await layout.evaluate((element) => getComputedStyle(element).borderColor)
  await layout.hover()
  await expect(layout).not.toHaveCSS('border-color', border)
  await layout.selectOption('compact')
  await demo.getByRole('radio', { name: 'Below the card', exact: true }).check()
  await demo.getByRole('checkbox', { name: 'Card counts', exact: true }).check()
  await expect(
    demo.getByRole('checkbox', { name: 'Unavailable detail', exact: true }),
  ).toBeDisabled()
  await demo.getByRole('switch', { name: 'Notifications', exact: true }).uncheck()
  await demo.getByRole('checkbox', { name: 'Confirm changes', exact: true }).check()
  await expect
    .poll(() => savedPreferences(page))
    .toMatchObject({
      name: 'A shared GUI',
      limit: 18,
      layout: 'compact',
      placement: 'below',
      features: ['history', 'counts'],
      notifications: false,
      confirmation: true,
      scale: 50,
    })
  const slider = demo.getByRole('slider', { name: 'Reading scale', exact: true })
  await slider.scrollIntoViewIfNeeded()
  const track = (await slider.boundingBox())!
  await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2)
  await page.mouse.down()
  await page.mouse.move(track.x + track.width * 0.8, track.y + track.height / 2, { steps: 6 })
  await expect(slider).not.toHaveValue('50')
  expect((await savedPreferences(page)).scale).toBe(50)
  const adjusted = Number(await slider.inputValue())
  await page.mouse.up()
  await expect.poll(async () => (await savedPreferences(page)).scale).toBe(adjusted)
  const nativeDraft = demo.getByRole('textbox', { name: 'Native code draft', exact: true })
  const nativeSlider = demo.getByRole('slider', { name: 'Native adjustment', exact: true })
  await expect(nativeDraft).toHaveClass(/ui-control--mono/)
  await expect(nativeSlider).toHaveClass(/ui-control--range/)
  // The raw slider intentionally does not set the optional track-progress custom property.
  expect(
    await nativeSlider.evaluate((element) => element.style.getPropertyValue('--ui-range-progress')),
  ).toBe('')
  await nativeDraft.fill('const selected = 42\nreturn selected')
  await nativeDraft.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(6, 14, 'forward')
  })
  await nativeSlider.focus()
  await nativeSlider.press('ArrowRight')
  await expect(nativeSlider).toHaveValue('5')
  expect(
    await nativeDraft.evaluate((element: HTMLTextAreaElement) => ({
      start: element.selectionStart,
      end: element.selectionEnd,
      direction: element.selectionDirection,
    })),
  ).toEqual({ start: 6, end: 14, direction: 'forward' })
  await expect(nativeDraft).toHaveValue('const selected = 42\nreturn selected')
  const clearDraft = demo.getByRole('button', { name: 'Clear native draft', exact: true })
  await expect(clearDraft).toHaveAttribute('title', 'Clear native draft')
  await expect(clearDraft).toHaveClass(/ui-button--icon/)
  const iconBox = await clearDraft.boundingBox()
  expect(iconBox).not.toBeNull()
  expect(iconBox!.width).toBeCloseTo(44, 1)
  expect(iconBox!.height).toBeCloseTo(44, 1)
  await clearDraft.click()
  await expect(nativeDraft).toHaveValue('')
  await expect(nativeDraft).toBeFocused()
  const restoreDraft = demo.getByRole('button', { name: 'Restore native draft', exact: true })
  await expect(restoreDraft).toHaveClass(/ui-button/)
  await restoreDraft.click()
  await expect(nativeDraft).toHaveValue('const result = 42\nreturn result')
  await expect(nativeDraft).toBeFocused()
  expect(await storedLibrary(page)).toEqual(before)
  await demo.locator('.settings-example__native').screenshot({
    path: info.outputPath('settings-native-controls.png'),
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await demo.screenshot({ path: info.outputPath('settings-controls-wide.png') })

  await page.reload()
  await openPluginSettings(page)
  await expect(name).toHaveValue('A shared GUI')
  await expect(notes).toHaveValue('Saved independently\nWithout copying host controls.')
  await expect(password).toHaveValue('')
  await expect(limit).toHaveValue('18')
  await expect(slider).toHaveValue(String(adjusted))
  await expect(demo.getByRole('radio', { name: 'Below the card', exact: true })).toBeChecked()
  await expect(demo.getByRole('checkbox', { name: 'Card counts', exact: true })).toBeChecked()
  await expect(demo.getByRole('switch', { name: 'Notifications', exact: true })).not.toBeChecked()
  expect(await storedLibrary(page)).toEqual(before)

  await page.setViewportSize({ width: 500, height: 700 })
  await name.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await demo.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('settings-controls-500.png') })
  const scrollbars = await page.evaluate(() => {
    const root = document.documentElement
    const before = root.scrollTop
    const thumb = getComputedStyle(root, '::-webkit-scrollbar-thumb')
    const radius = thumb.borderRadius
    const color = thumb.backgroundColor
    window.scrollTo(0, root.scrollHeight)
    return {
      radius,
      color,
      moved: root.scrollTop > before,
      supported: CSS.supports('scrollbar-color', 'auto'),
      webkit: CSS.supports('selector(::-webkit-scrollbar)'),
      scrollbarColor: getComputedStyle(root).scrollbarColor,
    }
  })
  expect(scrollbars.moved).toBe(true)
  expect(Number.parseFloat(scrollbars.radius)).toBeGreaterThan(0)
  expect(scrollbars.color).not.toBe('rgba(0, 0, 0, 0)')
  if (scrollbars.supported && !scrollbars.webkit) expect(scrollbars.scrollbarColor).not.toBe('auto')
  await page.screenshot({ path: info.outputPath('settings-controls-scrollbar.png') })
  await demo.getByRole('button', { name: 'Reset defaults', exact: true }).click()
  await expect(name).toHaveValue('Learning desk')
  await expect.poll(async () => (await savedPreferences(page)).limit).toBe(10)
})
