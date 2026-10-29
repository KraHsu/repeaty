import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseStudyDocument } from '../src/format.ts'

function context(controller = new AbortController()) {
  const progress = []
  return {
    signal: controller.signal,
    progress(value) {
      progress.push(value)
    },
    onCleanup() {},
    async yield() {
      controller.signal.throwIfAborted()
    },
    progressEvents: progress,
  }
}
const chapter = { id: 'one', title: '正文一', body: '重复文字。\r\n中文 emoji 🧩\r\n重复文字。' }
const file = (chapters, version = 1) =>
  new File([JSON.stringify({ version, chapters })], 'example.study.json', {
    type: 'application/json',
  })

test('parses two stable chapter candidates without changing original bytes', async () => {
  const source = file([chapter, { id: 'two', title: '正文二', body: '<script>text only</script>' }])
  const bytes = await source.text()
  const task = context()
  const result = await parseStudyDocument(source, task)
  assert.equal(result.length, 2)
  assert.equal(result[0].key, 'one')
  assert.equal(result[0].text, '重复文字。\n中文 emoji 🧩\n重复文字。')
  assert.equal(result[1].text, '<script>text only</script>')
  assert.equal(result[0].format, 'plain')
  assert.equal(result[0].documentFormat, 'study-json')
  assert.equal(await source.text(), bytes)
  assert.deepEqual(task.progressEvents, [
    { completed: 1, total: 2 },
    { completed: 2, total: 2 },
  ])
})

test('rejects ambiguous versions, duplicate keys and a malformed later chapter as one parse', async () => {
  for (const source of [
    file([chapter], 2),
    file([chapter, chapter]),
    file([chapter, { id: 'two' }]),
  ])
    await assert.rejects(parseStudyDocument(source, context()))
})

test('cancel between candidates never returns a partial import', async () => {
  const controller = new AbortController()
  const task = context(controller)
  task.yield = async () => controller.abort()
  await assert.rejects(parseStudyDocument(file([chapter, { ...chapter, id: 'two' }]), task), {
    name: 'AbortError',
  })
})

test('rejects oversized and invalid UTF-8 documents before providing candidates', async () => {
  await assert.rejects(
    parseStudyDocument(new File([new Uint8Array(1024 * 1024 + 1)], 'huge.study.json'), context()),
    /at most 1 MiB/,
  )
  await assert.rejects(
    parseStudyDocument(new File([new Uint8Array([0xff])], 'bad.study.json'), context()),
  )
})
