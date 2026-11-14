// Exercise the real native entry point without starting a WebView or opening a library.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

const command = resolve(
  process.env.REPEATY_DESKTOP_BINARY ??
    `src-tauri/target/debug/repeaty-desktop${process.platform === 'win32' ? '.exe' : ''}`,
)
const directory = await mkdtemp(join(tmpdir(), 'repeaty-cli-'))
const connection = join(directory, '用户 with spaces', 'mcp.connection.json')
const env = { ...process.env }
delete env.DISPLAY
delete env.WAYLAND_DISPLAY
function run(args, input = '') {
  const result = spawnSync(command, ['--cli', ...args], {
    env,
    input,
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  })
  assert.ifError(result.error)
  assert.equal(result.stderr, '')
  assert.equal(
    result.stdout.trim().split('\n').length,
    1,
    'stdout must contain exactly one JSON result',
  )
  return { status: result.status, body: JSON.parse(result.stdout) }
}
try {
  for (const args of [[], ['help'], ['--help'], ['version'], ['--version']]) {
    const result = run(args)
    assert.equal(result.status, 0)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.data.protocolVersion, 1)
  }
  const offline = run(['status', '--connection-file', connection])
  assert.equal(offline.status, 3)
  assert.equal(offline.body.error.code, 'library-unavailable')
  for (const args of [
    ['unknown'],
    ['query', '--json', '[]'],
    ['query', '--json', '{}{}'],
    ['query', '--connection-file', 'relative.json'],
    ['query', '--request-file', join(directory, 'missing.json')],
  ]) {
    const result = run(args)
    assert.equal(result.status, 2)
    assert.equal(result.body.error.code, 'invalid-arguments')
  }
  const payload = '{"kind":"notes","text":"中文 Unicode"}'
  const path = join(directory, '请求 with spaces.json')
  await writeFile(path, payload)
  for (const args of [
    ['--json', payload],
    ['--request-file', path],
    ['--request-file', '-'],
    ['-'],
    [],
  ]) {
    const result = run(['query', '--connection-file', connection, ...args], payload)
    assert.equal(result.status, 3, 'a valid request must reach descriptor resolution')
  }
  assert.equal(run(['query', '-'], 'x'.repeat(512 * 1024 + 1)).status, 2)
  console.log(
    'Native CLI: offline help/version, JSON/file/stdin input, Unicode paths, bounded input and exit codes passed',
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
