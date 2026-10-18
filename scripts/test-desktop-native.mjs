import { promisify } from 'node:util'
import { spawn, execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
const exec = promisify(execFile)
const xdotool = process.env.REPEATY_XDOTOOL || 'xdotool'
const directory = await mkdtemp(join(tmpdir(), 'repeaty-native-test-'))
await mkdir(join(directory, 'config'), { recursive: true })
await mkdir(join(directory, 'downloads'), { recursive: true })
await writeFile(
  join(directory, 'config', 'user-dirs.dirs'),
  `XDG_DOWNLOAD_DIR="${join(directory, 'downloads')}"\n`,
)
const driverPort = 4447
const servicePort = 4186
const origin = `http://127.0.0.1:${driverPort}`
const log = []
const env = {
  ...process.env,
  XDG_DATA_HOME: join(directory, 'data'),
  XDG_CONFIG_HOME: join(directory, 'config'),
  WEBKIT_DISABLE_DMABUF_RENDERER: '1',
}
const serverEnv = {
  ...env,
  REPEATY_BIND: `127.0.0.1:${servicePort}`,
  REPEATY_ORIGIN: `http://127.0.0.1:${servicePort}`,
  REPEATY_DATA_DIR: join(directory, 'server'),
  REPEATY_WEB_DIR: resolve('dist-server'),
  REPEATY_REGISTRATION: 'open',
}
for (const name of ['REPEATY_DATABASE', 'REPEATY_API_TOKEN']) delete serverEnv[name]
const service = spawn(resolve('server/target/debug/repeaty-server'), {
  env: serverEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
})
const args = ['--port', String(driverPort), '--native-port', '4448']
if (process.env.REPEATY_WEBDRIVER) args.push('--native-driver', process.env.REPEATY_WEBDRIVER)
const driver = spawn('tauri-driver', args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
for (const child of [driver, service]) {
  child.on('error', (error) => log.push(error.message))
  child.stdout.on('data', (bytes) => log.push(bytes.toString()))
  child.stderr.on('data', (bytes) => log.push(bytes.toString()))
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(operation, label) {
  let last
  for (let i = 0; i < 120; i++) {
    try {
      const result = await operation()
      if (result) return result
    } catch (error) {
      last = error
    }
    await sleep(250)
  }
  throw new Error(`Timed out: ${label}: ${last ?? ''}`)
}
let session
async function command(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${origin}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const result = await response.json()
  if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result))
  return result.value
}
const execute = (script, ...args) => command(`/session/${session}/execute/sync`, { script, args })
const click = (text) =>
  execute(
    `const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===arguments[0]);if(!button)throw Error('Missing button '+arguments[0]);button.click();`,
    text,
  )
const fill = (selector, value) =>
  execute(
    `const el=document.querySelector(arguments[0]);if(!el)throw Error('Missing field');el.value=arguments[1];el.dispatchEvent(new Event('input',{bubbles:true}));`,
    selector,
    value,
  )
const invoke = (name, args = {}) =>
  execute('return window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]);', name, args)
try {
  await until(async () => {
    const r = await fetch(`http://127.0.0.1:${servicePort}/api/status`, {
      headers: { 'X-Repeaty-Client': '1' },
    })
    return r.ok
  }, 'backend ready')
  await until(async () => {
    await command('/status')
    return true
  }, 'driver ready')
  const created = await command('/session', {
    capabilities: {
      alwaysMatch: {
        'tauri:options': {
          application: resolve(
            process.env.REPEATY_DESKTOP_BINARY ?? 'src-tauri/target/debug/repeaty-desktop',
          ),
        },
      },
    },
  })
  session = created.sessionId
  await until(
    () => execute("return document.querySelectorAll('.deck-title').length===1"),
    'starter deck',
  )
  await execute(
    "const select=document.querySelector('.language-picker select');select.value='zh-CN';select.dispatchEvent(new Event('change',{bubbles:true}));",
  )
  assert.deepEqual(await invoke('desktop_config'), { endpoint: '' })
  assert.equal(await execute("return document.body.textContent.includes('桌面版')"), true)
  // Real Rust IPC writes a fake local credential. No LeetCode network call is made.
  await invoke('local_plugin', {
    id: 'leetcode',
    operation: 'credentials',
    payload: {
      action: 'save',
      site: 'leetcode.cn',
      session: 'native-test-session',
      csrf: 'native-test-csrf',
    },
  })
  assert.deepEqual(
    (
      await invoke('local_plugin', {
        id: 'leetcode',
        operation: 'request',
        payload: { action: 'ping' },
      })
    ).configured,
    ['leetcode.cn'],
  )
  await mkdir('test-results', { recursive: true })
  await writeFile(
    'test-results/native-desktop.png',
    Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
  )
  await click('数据与备份')
  await click('导出 .repeaty')
  const chooser = await until(async () => {
    const { stdout } = await exec(xdotool, ['search', '--onlyvisible', '--name', 'Save'])
    return stdout.trim().split('\n').at(-1)
  }, 'system save dialog')
  await exec(xdotool, ['windowfocus', chooser])
  await exec(xdotool, ['key', '--clearmodifiers', 'ctrl+l'])
  await exec(xdotool, ['type', '--clearmodifiers', join(directory, 'downloads', 'native.repeaty')])
  await exec(xdotool, ['key', '--clearmodifiers', 'Return'])
  const backup = await until(
    async () =>
      (await readdir(join(directory, 'downloads'))).find((name) => name.endsWith('.repeaty')),
    'native backup download',
  )
  const bytes = await readFile(join(directory, 'downloads', backup))
  assert.equal(bytes.subarray(0, 2).toString(), 'PK')
  assert.ok(bytes.length > 1000)
  await click('学习概览')
  await execute("document.querySelector('.deck-title').click()")
  await until(
    () => execute('return !!document.querySelector(\'[aria-label="删除当前卡组"]\')'),
    'deck selection',
  )
  await execute('document.querySelector(\'[aria-label="删除当前卡组"]\').click()')
  await click('确认删除')
  await until(
    () => execute("return document.querySelectorAll('dialog').length===0"),
    'delete saved',
  )
  await command(`/session/${session}/refresh`, {})
  await until(
    () => execute("return document.body.textContent.includes('还没有卡组')"),
    'deleted starter remains deleted',
  )
  await click('设置')
  await until(
    () => execute("return !!document.querySelector('#upstream-endpoint')"),
    'settings dialog',
  )
  await fill('#upstream-endpoint', `http://127.0.0.1:${servicePort}`)
  await click('保存并重新打开')
  await until(
    () => execute("return !!document.querySelector('#account-username')"),
    'upstream login',
  )
  await click('创建账户')
  await fill('#account-username', 'native-user')
  await fill('#account-password', 'native-test-password')
  await click('创建账户')
  await until(
    () => execute("return document.querySelectorAll('.deck-title').length===1"),
    'new account starter',
  )
  assert.equal(
    await execute(
      "return JSON.stringify([localStorage,sessionStorage,document.cookie]).includes('native-test-session')",
    ),
    false,
  )
  assert.deepEqual(
    (
      await invoke('local_plugin', {
        id: 'leetcode',
        operation: 'request',
        payload: { action: 'ping' },
      })
    ).configured,
    ['leetcode.cn'],
  )
  await click('设置')
  await fill('#upstream-endpoint', '')
  await click('保存并重新打开')
  await until(
    () => execute("return document.body.textContent.includes('还没有卡组')"),
    'original local library preserved',
  )
  await invoke('local_plugin', {
    id: 'leetcode',
    operation: 'credentials',
    payload: { action: 'clear', site: 'leetcode.cn' },
  })
  assert.deepEqual(
    (
      await invoke('local_plugin', {
        id: 'leetcode',
        operation: 'request',
        payload: { action: 'ping' },
      })
    ).configured,
    [],
  )
  console.log(
    'Native WebKit/Tauri: starter lifecycle, account registration, upstream switching, local credential persistence and clearing passed.',
  )
} catch (error) {
  console.error(log.slice(-20).join(''))
  if (session) {
    await mkdir('test-results', { recursive: true })
    await writeFile(
      'test-results/native-failure.png',
      Buffer.from(await command(`/session/${session}/screenshot`).catch(() => ''), 'base64'),
    )
  }
  throw error
} finally {
  if (session) await command(`/session/${session}`, undefined, 'DELETE').catch(() => {})
  driver.kill('SIGTERM')
  service.kill('SIGTERM')
  await sleep(500)
  await rm(directory, { recursive: true, force: true })
}
