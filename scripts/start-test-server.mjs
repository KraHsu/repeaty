import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const directory = await mkdtemp(join(tmpdir(), 'repeaty-server-test-'))
const env = {
  ...process.env,
  REPEATY_BIND: '127.0.0.1:4176',
  REPEATY_ORIGIN: 'http://127.0.0.1:4176',
  REPEATY_DATA_DIR: directory,
  REPEATY_REGISTRATION: 'open',
  REPEATY_WEB_DIR: resolve('dist-server'),
}
// Browser tests must never inherit a developer's real LeetCode account.
for (const key of [
  'REPEATY_DATABASE',
  'REPEATY_API_TOKEN',
  'LEETCODE_CN_SESSION',
  'LEETCODE_CN_CSRF',
  'LEETCODE_COM_SESSION',
  'LEETCODE_COM_CSRF',
])
  delete env[key]
const child = spawn('cargo', ['run', '--locked', '--manifest-path', 'server/Cargo.toml'], {
  env,
  stdio: 'inherit',
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill('SIGINT'))
child.on('exit', async (code) => {
  await rm(directory, { recursive: true, force: true })
  process.exit(code ?? 0)
})
