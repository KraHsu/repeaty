import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { startMcpClient } from './mcp-client.mjs'

const command = resolve(
  process.env.REPEATY_DESKTOP_BINARY ??
    `src-tauri/target/release/repeaty-desktop${process.platform === 'win32' ? '.exe' : ''}`,
)
const directory = await mkdtemp(join(tmpdir(), 'repeaty-stdio-'))
const connection = join(directory, 'Repeaty 用户 with spaces', 'mcp.connection.json')
// This mode must work without a graphical session, an open library, or a connection file.
const env = { ...process.env }
delete env.DISPLAY
delete env.WAYLAND_DISPLAY
let client
try {
  client = await startMcpClient(
    { command, args: ['--mcp-stdio', '--connection-file', connection] },
    { env },
  )
  assert.equal(client.info.serverInfo.name, 'repeaty')
  assert.ok(client.info.instructions.includes('a human must review'))
  const names = (await client.listTools()).tools.map((tool) => tool.name).sort()
  assert.deepEqual(names, [
    'repeaty_due_cards',
    'repeaty_practice_history',
    'repeaty_propose_cards',
    'repeaty_selected_excerpt',
    'repeaty_study_stats',
  ])
  assert.equal(
    (await client.call('repeaty_study_stats')).structuredContent.code,
    'library-unavailable',
  )
  assert.equal(
    (await client.call('repeaty_due_cards', { includeAnswers: true })).structuredContent.code,
    'invalid-arguments',
  )
  assert.equal((await client.call('unknown')).structuredContent.code, 'invalid-arguments')
  await client.close()
  client = undefined
  for (const args of [[], ['--connection-file', 'relative.json']]) {
    const invalid = spawnSync(command, ['--mcp-stdio', ...args], { env, timeout: 15000 })
    assert.equal(invalid.status, 1)
    assert.equal(invalid.stdout.length, 0)
    assert.ok(invalid.stderr.toString().includes('usage: --mcp-stdio'))
  }
  client = await startMcpClient(
    { command, args: ['--mcp-stdio', '--connection-file', connection] },
    { env },
  )
  // Oversized input must close the protocol reader rather than allocate an unbounded frame.
  client.child.stdin.end('x'.repeat(512 * 1024 + 1) + '\n')
  await client.close()
  client = undefined
  console.log(
    'MCP stdio: headless initialization, discovery, offline errors, EOF and frame limit passed',
  )
} finally {
  if (client) await client.close().catch(() => {})
  await rm(directory, { recursive: true, force: true })
}
