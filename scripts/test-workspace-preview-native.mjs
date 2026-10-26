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
const click = (text) =>
  execute(
    "const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===arguments[0]);if(!button)throw Error('Missing button '+arguments[0]);button.click()",
    text,
  )
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
    () => execute("return Boolean(document.querySelector('.deck-title'))"),
    'local library ready',
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
        "return document.querySelector('.workspace-preview')?.getAttribute('aria-busy')==='false'",
      ),
    'folder action settled',
  )
}
async function library() {
  return execute(
    `return new Promise((resolve,reject)=>{const r=indexedDB.open('repeaty');r.onerror=()=>reject(r.error);r.onsuccess=async()=>{const db=r.result;try{const result={};for(const name of ['decks','notes','cards','reviews','media','savedSearches','practices','attempts','sources','cardDrafts'])result[name]=await new Promise((ok,fail)=>{const q=db.transaction(name).objectStore(name).getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>fail(q.error)});resolve(result)}catch(e){reject(e)}finally{db.close()}}})`,
  )
}
const seed = String.raw`import sys,json,sqlite3,hashlib,pathlib
p=pathlib.Path(sys.argv[1]);raw=sys.argv[2];state=sys.argv[3];data=raw.encode('utf-8');digest=hashlib.sha256(data).hexdigest()
obj=p/'.repeaty/objects/sha256'/digest[:2];obj.mkdir(exist_ok=True);(obj/digest).write_bytes(data);(p/'notes/original.md').write_bytes(data)
db=sqlite3.connect(p/'state.prototype.sqlite3');db.execute('INSERT INTO decks VALUES(?)',('preview-deck',));db.execute('INSERT INTO notes(id,path,path_key,accepted_hash) VALUES(?,?,?,?)',('preview-note','notes/original.md','notes/original.md',digest));db.execute('INSERT INTO cards(id,note_id,variant,state_json) VALUES(?,?,?,?)',('preview-card','preview-note','forward',state));db.commit();db.close()`
try {
  await until(async () => {
    await command('/status')
    return true
  }, 'driver ready')
  await start()
  const before = await library()
  await enter()
  await until(
    () =>
      execute(
        "const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='创建预览目录');return Boolean(b&&!b.disabled)",
      ),
    'preview ready',
  )
  assert.equal((await invoke('workspace_preview_status')).active, null)
  await picker('创建预览目录', selected)
  const first = (await invoke('workspace_preview_status')).active
  assert.ok(first?.id)
  assert.equal(first.path, selected)
  await click('关闭目录')
  await until(
    async () => (await invoke('workspace_preview_status')).active === null,
    'directory closed',
  )
  const revoked = await execute(
    "return window.__TAURI_INTERNALS__.invoke('workspace_preview_scan',{token:arguments[0]}).then(()=>false,()=>true)",
    first.token,
  )
  assert.equal(revoked, true)
  const original =
    '\uFEFF---\r\nrepeaty: {version: 1, kind: note, id: preview-note, type: basic, format: markdown, deckId: preview-deck}\r\n# preserved comment\r\n---\r\n已接受的正文🙂\r\n<!-- repeaty:answer -->\r\n原答案\r\n'
  const state = JSON.stringify({
    id: 'preview-card',
    noteId: 'preview-note',
    variant: 'forward',
    schedule: { due: '2026-10-26T00:00:00Z', reps: 13 },
  })
  await exec('python3', ['-c', seed, selected, original, state])
  await picker('打开目录', selected)
  await until(
    () =>
      execute("return document.querySelector('.workspace-file-status')?.textContent==='未变化'"),
    'accepted file opened',
  )
  await mkdir(join(selected, 'notes', '中文'))
  const moved = join(selected, 'notes', '中文', '移动.md')
  await rename(join(selected, 'notes/original.md'), moved)
  const changed = original.replace(
    '已接受的正文🙂',
    '外部修改<script>window.previewExecuted=true</script>',
  )
  await writeFile(moved, changed)
  await click('重新扫描')
  await until(
    () =>
      execute(
        "return document.querySelector('.workspace-file-status')?.textContent==='改名并修改'",
      ),
    'renamed external change',
  )
  assert.equal(await execute('return Boolean(window.previewExecuted)'), false)
  assert.equal(
    await execute(
      "return document.querySelector('.workspace-raw').textContent.includes('<script>')",
    ),
    true,
  )
  assert.equal(
    await execute("return Boolean(document.querySelector('.workspace-raw script'))"),
    false,
  )
  await click('已接受版本')
  assert.equal(
    await execute(
      "return document.querySelector('.workspace-raw').textContent.includes('已接受的正文🙂')",
    ),
    true,
  )
  await execute(
    "const s=document.querySelector('.language-picker select');s.value='en';s.dispatchEvent(new Event('change',{bubbles:true}))",
  )
  await until(
    () => execute("return document.body.textContent.includes('Accepted version')"),
    'English workspace',
  )
  await mkdir('test-results', { recursive: true })
  await writeFile(
    'test-results/workspace-preview-wide.png',
    Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
  )
  await command(`/session/${session}/window/rect`, { width: 720, height: 720 })
  assert.equal(
    await execute(
      'return document.documentElement.scrollWidth<=document.documentElement.clientWidth+1',
    ),
    true,
  )
  await writeFile(
    'test-results/workspace-preview-narrow.png',
    Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
  )
  await command(`/session/${session}/window/rect`, { width: 1280, height: 850 })
  await execute(
    "const s=document.querySelector('.language-picker select');s.value='zh-CN';s.dispatchEvent(new Event('change',{bubbles:true}))",
  )
  const duplicate = join(selected, 'notes', 'copy.md')
  await copyFile(moved, duplicate)
  await click('重新扫描')
  await until(
    () =>
      execute(
        "return [...document.querySelectorAll('.workspace-file-status')].filter(e=>e.textContent==='存在冲突').length===2",
      ),
    'duplicate identities',
  )
  await rm(duplicate)
  await rm(moved)
  await click('重新扫描')
  await until(
    () =>
      execute("return document.querySelector('.workspace-file-status')?.textContent==='文件缺失'"),
    'missing working file',
  )
  assert.equal(
    await execute(
      "return document.querySelector('.workspace-raw').textContent.includes('已接受的正文🙂')",
    ),
    true,
  )
  await click('关闭目录')
  await until(
    async () => (await invoke('workspace_preview_status')).active === null,
    'closed before recent open',
  )
  await execute("document.querySelector('.workspace-recent-entry').click()")
  await until(
    () =>
      execute("return document.querySelector('.workspace-file-status')?.textContent==='文件缺失'"),
    'recent workspace reopened',
  )
  const current = (await invoke('workspace_preview_status')).active
  await picker('创建预览目录', nonempty)
  assert.equal((await invoke('workspace_preview_status')).active.token, current.token)
  assert.equal(await readFile(join(nonempty, 'keep.txt'), 'utf8'), 'preserve this file')
  await picker('打开目录', null)
  assert.equal((await invoke('workspace_preview_status')).active.token, current.token)
  await command(`/session/${session}`, undefined, 'DELETE')
  session = undefined
  const offline = join(root, 'offline')
  await rename(selected, offline)
  await start()
  await enter()
  await until(
    () =>
      execute(
        "return document.querySelector('.workspace-preview [role=alert]')?.textContent.includes('找不到目录')",
      ),
    'missing remembered directory',
  )
  assert.equal((await invoke('workspace_preview_status')).active, null)
  await rename(offline, selected)
  await click('重试')
  await until(
    () =>
      execute("return document.querySelector('.workspace-file-status')?.textContent==='文件缺失'"),
    'restored preview after application restart',
  )
  const restored = (await invoke('workspace_preview_status')).active
  assert.equal(restored.id, first.id)
  assert.notEqual(restored.token, current.token)
  await command(`/session/${session}/window/rect`, { width: 1280, height: 560 })
  await execute(
    "document.querySelector('.sidebar-section-title button').scrollIntoView({block:'nearest'})",
  )
  assert.equal(
    await execute(
      "const b=document.querySelector('.sidebar-section-title button');const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))",
    ),
    true,
  )
  await execute("document.querySelector('.sidebar-section-title button').click()")
  await until(
    () => execute("return Boolean(document.querySelector('dialog[open]'))"),
    'deck editor in short desktop window',
  )
  await execute("document.querySelector('dialog .modal-header button').click()")
  assert.deepEqual(await library(), before)
  await click('关闭目录')
  await until(
    async () => (await invoke('workspace_preview_status')).active === null,
    'closed restored preview',
  )
  const { stdout } = await exec('python3', [
    '-c',
    "import sqlite3,sys,json; db=sqlite3.connect(sys.argv[1]); print(json.dumps([db.execute('SELECT state_json FROM cards').fetchone()[0],db.execute('SELECT count(*) FROM operations').fetchone()[0],db.execute('SELECT count(*) FROM changes').fetchone()[0]]))",
    join(selected, 'state.prototype.sqlite3'),
  ])
  assert.deepEqual(JSON.parse(stdout), [state, 0, 0])
  console.log(
    'Native workspace preview: picker create/open/cancel, recent sessions, external rename/change/conflict/missing files, retained versions, actual restart, missing directory reconnect, revoked tokens, unchanged study library and scheduling passed',
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
        resolve('test-results/workspace-preview-native-screen.png'),
      ])
    } catch (issue) {
      log.push(`Native display capture unavailable: ${issue}`)
    }
  try {
    if (session)
      await writeFile(
        'test-results/workspace-preview-native.png',
        Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
      )
  } catch {}
  await writeFile(
    'test-results/workspace-preview-native.log',
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
