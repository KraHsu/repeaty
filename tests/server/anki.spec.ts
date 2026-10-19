import { test, expect, headers } from './fixture'
import { createImportDeck, previewAnki, confirmAnki } from '../fixtures/anki-flow'

test('account imports Anki into SQLite, retries a failed save and retains GUIDs and media', async ({
  page,
  request,
}) => {
  await page.goto('./')
  await createImportDeck(page)
  await previewAnki(page)
  // Previews and cancelled imports have no database or media writes.
  const before = await (await request.get('api/library', { headers })).json()
  expect(before.library.notes).toEqual([])
  let reject = true
  await page.route('**/api/library/commit', (route) =>
    reject ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.continue(),
  )
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  const failed = await (await request.get('api/library', { headers })).json()
  expect(failed.library.notes).toEqual([])
  expect(failed.library.media).toEqual([])
  reject = false
  await confirmAnki(page)
  await page.reload()
  const saved = await (await request.get('api/library', { headers })).json()
  expect(saved.library.notes).toHaveLength(4)
  expect(saved.library.notes.every((note: { id: string }) => note.id.startsWith('anki:'))).toBe(
    true,
  )
  expect(saved.library.cards).toHaveLength(6)
  expect(saved.library.reviews).toHaveLength(0)
  expect(saved.library.media).toHaveLength(2)
  const image = saved.library.media.find((media: { name: string }) => media.name === 'pixel.png')
  expect((await request.get(`api/media/${image.id}`, { headers })).ok()).toBe(true)
  await previewAnki(page, 'legacy')
  await expect(page.locator('.anki-preview')).toContainText('可导入 0 条，已存在 4 条')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  const audio = saved.library.media.find((entry: { name: string }) => entry.name === 'voice.wav')
  const originalAudio = await (await request.get(`api/media/${audio.id}`, { headers })).body()
  await previewAnki(page, 'updated')
  await page
    .locator('.anki-change')
    .filter({ hasText: 'What is' })
    .getByLabel('采用文件内容')
    .check()
  reject = true
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  const unchanged = await (await request.get('api/library', { headers })).json()
  expect(unchanged.library.notes).toEqual(saved.library.notes)
  expect(await (await request.get(`api/media/${audio.id}`, { headers })).body()).toEqual(
    originalAudio,
  )
  reject = false
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  const updated = await (await request.get('api/library', { headers })).json()
  expect(updated.library.notes).toHaveLength(5)
  expect(updated.library.cards).toHaveLength(7)
  expect(
    updated.library.cards.filter((card: { id: string }) =>
      saved.library.cards.some((old: { id: string }) => old.id === card.id),
    ),
  ).toEqual(saved.library.cards)
  const updatedAudio = updated.library.media.find(
    (entry: { name: string }) => entry.name === 'voice.wav',
  )
  expect(await (await request.get(`api/media/${updatedAudio.id}`, { headers })).body()).not.toEqual(
    originalAudio,
  )
  await previewAnki(page, 'updated')
  await expect(page.locator('.anki-preview')).toContainText('3 条相同，2 条内容不同')
})
