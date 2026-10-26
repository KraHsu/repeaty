// Real WebKit, Rust IPC, native folder picker, and actual application restart.
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rename, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const exec = promisify(execFile)
const xdotool = process.env.REPEATY_XDOTOOL || 'xdotool'
const root = await mkdtemp(join(tmpdir(), 'repeaty-workspace-ui-'))
const selected = join(root, 'workspace'),
  nonempty = join(root, 'nonempty')
await mkdir(selected)
await mkdir(nonempty)
await writeFile(join(nonempty, 'keep.txt'), 'preserve this file')
const log = []
const env = {
  ...process.env,
  XDG_DATA_HOME: join(root, 'data'),
  XDG_CONFIG_HOME: join(root, 'config'),
  WEBKIT_DISABLE_DMABUF_RENDERER: '1',
  GDK_BACKEND: 'x11',
  GTK_IM_MODULE: 'gtk-im-context-simple',
  XMODIFIERS: '@im=none',
}
const args = ['--port', '4449', '--native-port', '4450']
if (process.env.REPEATY_WEBDRIVER) args.push('--native-driver', process.env.REPEATY_WEBDRIVER)
const driver = spawn('tauri-driver', args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
driver.on('error', (error) => log.push(error.message))
for (const stream of [driver.stdout, driver.stderr])
  stream.on('data', (bytes) => log.push(bytes.toString()))
let session
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function command(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`http://127.0.0.1:4449${path}`, {
    method,
    signal: AbortSignal.timeout(30_000),
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const result = await response.json()
  if (!response.ok || result.value?.error) throw Error(JSON.stringify(result))
  return result.value
}
async function until(read, label) {
  let last
  for (let i = 0; i < 120; i++) {
    try {
      const value = await read()
      if (value) return value
    } catch (error) {
      last = error
    }
    await sleep(250)
  }
  throw Error(`Timed out: ${label}: ${last ?? ''}`)
}
const execute = (script, ...args) => command(`/session/${session}/execute/sync`, { script, args })
const click = async (text) => {
  await until(
    () =>
      execute(
        "return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()===arguments[0]&&!b.disabled&&b.getClientRects().length)",
        text,
      ),
    text,
  )
  return execute(
    "const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===arguments[0]&&!b.disabled&&b.getClientRects().length);if(!button)throw Error('Missing button '+arguments[0]);button.click()",
    text,
  )
}
const invoke = (name, args = {}) =>
  execute('return window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1])', name, args)
const enter = () =>
  execute(
    "[...document.querySelectorAll('.main-nav button')].find(b=>b.textContent.includes('工作目录')).click()",
  )
async function start() {
  session = (
    await command('/session', {
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
  ).sessionId
  await until(
    () => execute("return Boolean(document.querySelector('.workspace-welcome, .deck-title'))"),
    'workspace UI ready',
  )
  if (process.env.REPEATY_EXPECT_BUNDLED === '1')
    assert.equal(
      await execute(
        "return location.origin==='tauri://localhost'||location.origin==='http://tauri.localhost'||location.origin==='https://tauri.localhost'",
      ),
      true,
    )
  await execute(
    "const s=document.querySelector('.language-picker select');s.value='zh-CN';s.dispatchEvent(new Event('change',{bubbles:true}))",
  )
}
async function picker(button, path) {
  await click(button)
  const chooser = await until(async () => {
    const { stdout } = await exec(xdotool, ['search', '--onlyvisible', '--name', 'Select Folder'])
    return stdout.trim().split('\n').at(-1)
  }, 'native folder picker')
  await exec(xdotool, ['windowfocus', '--sync', chooser])
  if (path === null) await exec(xdotool, ['key', '--clearmodifiers', 'Escape'])
  else {
    await exec(xdotool, ['key', '--clearmodifiers', 'ctrl+l', 'ctrl+a'])
    await exec(xdotool, ['type', '--clearmodifiers', path])
    await exec(xdotool, ['key', '--clearmodifiers', 'Return'])
    await sleep(250)
    // A populated folder first completes its path; a second Enter enters that folder.
    const visible = async () => {
      try {
        return (await exec(xdotool, ['search', '--onlyvisible', '--name', 'Select Folder'])).stdout
          .split('\n')
          .includes(chooser)
      } catch {
        return false
      }
    }
    if (await visible()) {
      await exec(xdotool, ['key', '--clearmodifiers', 'Return'])
      await sleep(250)
    }
    // GTK releases use either Open or Select as the folder accept mnemonic.
    if (await visible()) {
      await exec(xdotool, ['key', '--clearmodifiers', 'alt+o'])
      await sleep(250)
    }
    if (await visible()) await exec(xdotool, ['key', '--clearmodifiers', 'alt+s'])
  }
  await until(
    () =>
      execute(
        "return document.querySelector('.workspace-manager')?.getAttribute('aria-busy')==='false'||Boolean(document.querySelector('.deck-title'))",
      ),
    'folder action settled',
  )
}
async function nativeLibrary() {
  const status = await invoke('workspace_status')
  return invoke('workspace_read', { token: status.active.token, request: { type: 'load' } })
}
const fill = (selector, value) =>
  execute(
    "const el=document.querySelector(arguments[0]);if(!el)throw Error('Missing field');el.value=arguments[1];el.dispatchEvent(new Event('input',{bubbles:true}))",
    selector,
    value,
  )
const language = () =>
  execute(
    "const s=document.querySelector('.language-picker select');s.value='zh-CN';s.dispatchEvent(new Event('change',{bubbles:true}))",
  )
async function ready() {
  await until(
    () => execute("return Boolean(document.querySelector('.deck-title'))"),
    'learning library ready',
  )
  await language()
}
async function navigate(label) {
  await execute(
    "const b=[...document.querySelectorAll('.main-nav button')].find(b=>[...b.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim()===arguments[0]);if(!b)throw Error('Missing nav');b.click()",
    label,
  )
}
try {
  await until(async () => {
    await command('/status')
    return true
  }, 'driver ready')
  await start()
  assert.equal((await invoke('workspace_status')).active, null)
  assert.deepEqual(await execute('return indexedDB.databases().then(d=>d.map(x=>x.name))'), [])
  await picker('创建学习库', selected)
  await ready()
  const first = (await invoke('workspace_status')).active
  const seeded = await nativeLibrary()
  assert.equal(seeded.library.cards.length, 27)
  assert.equal(seeded.revision, 1)
  assert.equal(
    await execute(
      "return document.body.textContent.includes('上游地址')||document.body.textContent.includes('用户名')",
    ),
    false,
  )
  await click('添加卡片')
  await until(() => execute("return Boolean(document.querySelector('#card-front'))"), 'note editor')
  await fill('#card-front', 'Native workspace question🙂')
  await fill('#card-back', 'Native answer **中文：**正文\n\n第二段')
  await click('保存卡片')
  await until(
    async () => (await nativeLibrary()).library.notes.length === seeded.library.notes.length + 1,
    'note saved',
  )
  let saved = await nativeLibrary()
  const note = saved.library.notes.find((n) => n.front === 'Native workspace question🙂')
  assert.ok(note)
  await navigate('学习概览')
  await click('开始复习')
  await click('显示答案')
  await execute(
    "const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('良好')&&!b.disabled);if(!b)throw Error('Missing grade');b.click()",
  )
  await until(async () => (await nativeLibrary()).library.reviews.length === 1, 'rating persisted')
  const rated = await nativeLibrary()
  await enter()
  await until(
    () => execute("return Boolean(document.querySelector('.workspace-active'))"),
    'active directory',
  )
  const docs = await invoke('workspace_read', {
    token: first.token,
    request: { type: 'documents', ids: [note.id] },
  })
  assert.equal(docs.length, 1)
  const doc = docs[0]
  const original = await readFile(join(selected, doc.path), 'utf8')
  const moved = 'notes/外部编辑.md'
  await rename(join(selected, doc.path), join(selected, moved))
  await writeFile(
    join(selected, moved),
    original.replace('Native workspace question🙂', '外部编辑后的题目🙂'),
  )
  await click('重新扫描')
  await until(
    () =>
      execute(
        "return [...document.querySelectorAll('.workspace-file')].some(b=>b.textContent.includes('改名并修改'))",
      ),
    'external rename detected',
  )
  await execute(
    "[...document.querySelectorAll('.workspace-file')].find(b=>b.textContent.includes('改名并修改')).click()",
  )
  await click('接受修改')
  await until(
    async () =>
      (await nativeLibrary()).library.notes.find((n) => n.id === note.id)?.front ===
      '外部编辑后的题目🙂',
    'external edit accepted',
  )
  saved = await nativeLibrary()
  assert.deepEqual(saved.library.cards, rated.library.cards)
  assert.deepEqual(saved.library.reviews, rated.library.reviews)
  // A process restart must restore the real directory, not a browser-local copy.
  await command(`/session/${session}`, undefined, 'DELETE')
  session = undefined
  await start()
  await ready()
  assert.deepEqual(await nativeLibrary(), saved)
  assert.notEqual((await invoke('workspace_status')).active.token, first.token)
  await enter()
  await until(
    () =>
      execute(
        "return document.querySelector('.workspace-manager')?.getAttribute('aria-busy')==='false'",
      ),
    'inspector ready',
  )
  await mkdir('test-results', { recursive: true })
  await writeFile(
    'test-results/workspace-active-wide.png',
    Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
  )
  await command(`/session/${session}/window/rect`, { width: 720, height: 720 })
  assert.equal(
    await execute('return document.documentElement.scrollWidth<=window.innerWidth'),
    true,
  )
  await writeFile(
    'test-results/workspace-active-narrow.png',
    Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
  )
  await command(`/session/${session}/window/rect`, { width: 1280, height: 850 })
  await picker('创建学习库', nonempty)
  assert.equal(await readFile(join(nonempty, 'keep.txt'), 'utf8'), 'preserve this file')
  assert.equal((await invoke('workspace_status')).active.id, first.id)
  await picker('打开目录', null)
  await click('关闭目录')
  await until(async () => (await invoke('workspace_status')).active === null, 'closed')
  assert.equal(await execute("return Boolean(document.querySelector('.workspace-welcome'))"), true)
  await execute("document.querySelector('.workspace-recent-entry').click()")
  await ready()
  assert.deepEqual(await nativeLibrary(), saved)
  assert.deepEqual(await execute('return indexedDB.databases().then(d=>d.map(x=>x.name))'), [])
  console.log(
    'Native workspace: create/open/cancel, automatic starter, actual card edit and rating, external Markdown rename/acceptance, stable schedules, process restart, recent reopen, no account mode and no IndexedDB passed',
  )
} catch (error) {
  await mkdir('test-results', { recursive: true })
  // Capture the native chooser as well as the webview, only on an explicitly
  // isolated test display. A WebDriver screenshot cannot include GTK windows.
  if (process.env.REPEATY_CAPTURE_NATIVE_SCREEN === '1')
    try {
      await exec('/usr/bin/python3', [
        '-c',
        "import os,sys; from PIL import ImageGrab; ImageGrab.grab(xdisplay=os.environ['DISPLAY']).save(sys.argv[1])",
        resolve('test-results/workspace-active-native-screen.png'),
      ])
    } catch (issue) {
      log.push(`Native display capture unavailable: ${issue}`)
    }
  try {
    if (session)
      await writeFile(
        'test-results/workspace-active-native.png',
        Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
      )
  } catch {}
  await writeFile(
    'test-results/workspace-active-native.log',
    [String(error), ...log].join('\n').slice(-131072),
  )
  throw error
} finally {
  if (session)
    try {
      await command(`/session/${session}`, undefined, 'DELETE')
    } catch {}
  driver.kill('SIGTERM')
  await rm(root, { recursive: true, force: true })
}
