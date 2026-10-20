import { ZipReader, Uint8ArrayReader, TextWriter, Uint8ArrayWriter } from '@zip.js/zip.js'
import { promisify } from 'node:util'
import { spawn, execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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
  GDK_BACKEND: 'x11',
  GTK_IM_MODULE: 'gtk-im-context-simple',
  XMODIFIERS: '@im=none',
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
    signal: AbortSignal.timeout(path === '/session' ? 60000 : 20000),
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
const waitButton = (text) =>
  until(
    () =>
      execute(
        "return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()===arguments[0]&&!b.disabled)",
        text,
      ),
    text,
  )
const invoke = async (name, args = {}) => {
  const result = await execute(
    'return window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>({ok:true,value}),error=>({ok:false,error:String(error)}));',
    name,
    args,
  )
  if (!result.ok) throw new Error(`${name}: ${result.error}`)
  return result.value
}
let mcpRequestId = 0
async function mcpRpc(configuration, method, params) {
  const response = await fetch(configuration.url, {
    method: 'POST',
    headers: {
      ...configuration.headers,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++mcpRequestId, method, params }),
    signal: AbortSignal.timeout(10_000),
  })
  assert.equal(response.status, 200)
  return response.json()
}
async function revokedMcp(configuration) {
  try {
    const response = await fetch(configuration.url, {
      method: 'POST',
      headers: configuration.headers,
      signal: AbortSignal.timeout(3000),
    })
    return response.status === 401
  } catch {
    return true // A closed listener also revokes the old connection.
  }
}
const libraryRecords = () =>
  execute(`return new Promise((resolve,reject)=>{
  const request=indexedDB.open('repeaty');
  request.onerror=()=>reject(request.error);
  request.onsuccess=async()=>{
    const db=request.result;
    try {
      const records={};
      for(const name of ['notes','cards','reviews','practices','attempts'])
        records[name]=await new Promise((ok,fail)=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error)});
      resolve(records);
    }catch(error){reject(error)}finally{db.close()}
  };
});`)
async function createSession() {
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
}
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
  console.log('Starting native browser session')
  await createSession()
  console.log('Native window created')
  await until(
    () => execute("return document.querySelectorAll('.deck-title').length===1"),
    'starter deck',
  )
  await execute(
    "const select=document.querySelector('.language-picker select');select.value='zh-CN';select.dispatchEvent(new Event('change',{bubbles:true}));",
  )
  console.log('Starter deck loaded')
  assert.deepEqual(await invoke('desktop_config'), { endpoint: '' })
  assert.equal(await execute("return document.body.textContent.includes('桌面版')"), true)
  // A real external HTTP client -> Rust -> IPC Channel -> WebView IndexedDB
  // projection -> Rust response. This is not the Chromium IPC fixture.
  await until(async () => (await invoke('mcp_status')).available, 'local MCP reader ready')
  assert.equal((await invoke('mcp_status')).enabled, false)
  const beforeMcp = await libraryRecords()
  await click('设置')
  await waitButton('开启 MCP')
  await click('开启 MCP')
  await until(async () => (await invoke('mcp_status')).enabled, 'MCP enabled')
  await waitButton('显示连接配置')
  await click('显示连接配置')
  await until(
    () => execute("return !!document.querySelector('#mcp-configuration')"),
    'MCP configuration',
  )
  const mcp = JSON.parse(await execute("return document.querySelector('#mcp-configuration').value"))
    .mcpServers.repeaty
  assert.equal((await fetch(mcp.url, { method: 'POST' })).status, 401)
  assert.equal(
    (
      await fetch(mcp.url, {
        method: 'POST',
        headers: { ...mcp.headers, Origin: 'https://untrusted.example' },
      })
    ).status,
    403,
  )
  const initialized = await mcpRpc(mcp, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'repeaty-native-test', version: '1' },
  })
  assert.equal(initialized.result.serverInfo.name, 'repeaty')
  assert.equal(
    initialized.result.serverInfo.version,
    JSON.parse(await readFile('package.json', 'utf8')).version,
  )
  const mcpTools = await mcpRpc(mcp, 'tools/list', {})
  assert.equal(mcpTools.result.tools.length, 5)
  assert.ok(
    mcpTools.result.tools.every(
      (tool) => tool.annotations.readOnlyHint === (tool.name !== 'repeaty_propose_cards'),
    ),
  )
  const stats = (await mcpRpc(mcp, 'tools/call', { name: 'repeaty_study_stats', arguments: {} }))
    .result.structuredContent
  assert.equal(stats.totals.cards, beforeMcp.cards.length)
  const questions = (
    await mcpRpc(mcp, 'tools/call', {
      name: 'repeaty_due_cards',
      arguments: { limit: 1, revision: stats.revision },
    })
  ).result.structuredContent
  assert.equal(questions.items.length, 1)
  assert.equal(typeof questions.items[0].question, 'string')
  assert.ok(!Object.hasOwn(questions.items[0], 'back'))
  assert.ok(!Object.hasOwn(questions.items[0], 'cloze'))
  const history = (
    await mcpRpc(mcp, 'tools/call', { name: 'repeaty_practice_history', arguments: {} })
  ).result.structuredContent
  assert.equal(history.total, 0)
  const unshared = await mcpRpc(mcp, 'tools/call', {
    name: 'repeaty_selected_excerpt',
    arguments: {},
  })
  assert.equal(unshared.result.structuredContent.code, 'selection-unavailable')
  const stale = await mcpRpc(mcp, 'tools/call', {
    name: 'repeaty_due_cards',
    arguments: { revision: stats.revision + 1 },
  })
  assert.equal(stale.result.isError, true)
  assert.equal(stale.result.structuredContent.code, 'library-changed')
  assert.deepEqual(await libraryRecords(), beforeMcp)
  await click('隐藏连接配置')
  await mkdir('test-results', { recursive: true })
  await command(`/session/${session}/screenshot`).then((png) =>
    writeFile('test-results/native-mcp-settings.png', Buffer.from(png, 'base64')),
  )
  await click('关闭 MCP')
  await until(async () => !(await invoke('mcp_status')).enabled, 'MCP disabled')
  assert.equal(await revokedMcp(mcp), true)
  await waitButton('开启 MCP')
  await click('开启 MCP')
  await until(async () => (await invoke('mcp_status')).enabled, 'MCP re-enabled')
  const restartedMcp = (await invoke('mcp_configuration')).mcpServers.repeaty
  assert.notEqual(restartedMcp.headers.Authorization, mcp.headers.Authorization)
  await command(`/session/${session}/refresh`, {})
  await until(async () => (await invoke('mcp_status')).available, 'MCP reader after reload')
  assert.equal((await invoke('mcp_status')).enabled, false)
  assert.equal(await revokedMcp(restartedMcp), true)
  assert.deepEqual(await libraryRecords(), beforeMcp)
  console.log('Native MCP protocol, read projections, token revocation and reload passed')
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
  console.log('Local credentials verified')
  await click('数据与备份')
  const exporting = click('导出 .repeaty')
  console.log('Opening save dialog')
  const chooser = await until(async () => {
    const { stdout } = await exec(xdotool, ['search', '--onlyvisible', '--name', 'Save'])
    return stdout.trim().split('\n').at(-1)
  }, 'system save dialog')
  await exec(xdotool, ['windowfocus', chooser])
  await exec(xdotool, ['key', '--clearmodifiers', 'ctrl+l', 'ctrl+a'])
  await exec(xdotool, ['type', '--clearmodifiers', join(directory, 'downloads', 'native.repeaty')])
  await exec(xdotool, ['key', '--clearmodifiers', 'Return'])
  await sleep(300)
  await exec(xdotool, ['key', '--clearmodifiers', 'alt+s'])
  await exporting
  const backup = await until(
    async () =>
      (await readdir(join(directory, 'downloads'))).find((name) => name.endsWith('.repeaty')),
    'native backup download',
  )
  const bytes = await readFile(join(directory, 'downloads', backup))
  assert.equal(bytes.subarray(0, 2).toString(), 'PK')
  const archive = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false })
  const entries = await archive.getEntries()
  const manifest = JSON.parse(
    await entries.find((entry) => entry.filename === 'manifest.json').getData(new TextWriter()),
  )
  assert.equal(manifest.counts.cards, 27)
  assert.equal(manifest.counts.media, 2)
  const media = entries.filter((entry) => entry.filename.startsWith('media/'))
  assert.equal(media.length, 2)
  const contents = await Promise.all(
    media.map((entry) => entry.getData(new Uint8ArrayWriter(), { checkSignature: true })),
  )
  assert.ok(contents.some((data) => Buffer.from(data.subarray(0, 4)).toString() === 'RIFF'))
  assert.ok(contents.some((data) => data[0] === 137 && data[1] === 80))
  const template = {}
  for (const kind of ['decks', 'notes', 'cards']) {
    const text = await entries
      .find((entry) => entry.filename === `data/${kind}/0.ndjson`)
      .getData(new TextWriter())
    template[kind] = JSON.parse(text.trim().split('\n')[0])
  }
  await archive.close()
  console.log('Native archive contains 27 cards, PNG and audio')
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
  await waitButton('开启 MCP')
  await click('开启 MCP')
  await until(async () => (await invoke('mcp_status')).enabled, 'MCP before upstream switch')
  const beforeUpstreamMcp = (await invoke('mcp_configuration')).mcpServers.repeaty
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
  assert.equal((await invoke('mcp_status')).enabled, false)
  assert.equal((await invoke('mcp_status')).available, false)
  assert.equal(await revokedMcp(beforeUpstreamMcp), true)
  await assert.rejects(invoke('mcp_start'))
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
  // Exercise the real account IPC without sending fake credentials to LeetCode.
  assert.deepEqual(
    await invoke('local_plugin', {
      id: 'leetcode',
      operation: 'request',
      payload: { action: 'account', site: 'leetcode.cn' },
    }),
    { site: 'leetcode.cn', state: 'unconfigured' },
  )
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
  // Seed a controlled completed result: this exercises native WebKit recovery and
  // history without sending code or credentials to the real LeetCode website.
  const problem = {
    site: 'leetcode.cn',
    slug: 'native-history',
    questionId: '1',
    frontendId: '1',
    title: 'Native history',
    difficulty: 'Easy',
    content: '<p>Return the input.</p>',
    snippets: [{ lang: 'Python3', langSlug: 'python3', code: 'def solve(value): pass' }],
  }
  const note = {
    ...template.notes,
    type: 'plugin',
    front: 'Native history',
    back: '',
    frontMedia: [],
    backMedia: [],
    format: 'plain',
    plugin: { id: 'leetcode', version: 1, data: problem },
  }
  const card = { ...template.cards, noteId: note.id, variant: 'forward' }
  const practice = {
    id: 'native-practice',
    cardId: card.id,
    contentRevision: createHash('sha256')
      .update(
        JSON.stringify([note.front, note.back, note.plugin], (_key, value) =>
          value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(
                Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
              )
            : value,
        ),
      )
      .digest('hex'),
    question: { front: note.front, back: note.back, format: note.format, plugin: note.plugin },
    startedAt: new Date().toISOString(),
  }
  const attempt = {
    id: 'native-attempt',
    practiceId: practice.id,
    language: 'python3',
    code: 'def solve(value): return value',
    elapsedMs: 1000,
    status: 'completed',
    submittedAt: practice.startedAt,
    updatedAt: practice.startedAt,
    submissionId: '123',
    result: { outcome: 'accepted', status: '通过', runtime: '1 ms', memory: '10 MB', detail: '' },
  }
  await execute(
    `return (async () => {
    const values = arguments[0];
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('repeaty'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction(['meta', ...Object.keys(values), 'attemptSummaries'], 'readwrite');
    const read = tx.objectStore('meta').get('main');
    read.onsuccess = () => { const meta = read.result; meta.revision++; for (const [kind, rows] of Object.entries(values)) {
      meta.counts[kind] = rows.length;
      rows.forEach((value, position) => tx.objectStore(kind).put({ id: value.id, value, position, deckId: kind === 'cards' ? values.decks[0].id : undefined }, value.id));
    }
    values.attempts.forEach((value, position) => {
      const { code, result, ...summary } = value;
      if (result) { const { detail, ...judge } = result; summary.result = judge; }
      tx.objectStore('attemptSummaries').put({ id: value.id, value: summary, position }, value.id);
    });
    tx.objectStore('meta').put(meta, 'main'); };
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    db.close();
  })();`,
    {
      decks: [template.decks],
      notes: [note],
      cards: [card],
      practices: [practice],
      attempts: [attempt],
    },
  )
  await command(`/session/${session}/refresh`, {})
  await until(
    () => execute("return document.querySelectorAll('.deck-title').length===1"),
    'history library',
  )
  await click('开始复习')
  await until(
    () =>
      execute(
        "return document.querySelector('#leetcode-code')?.value==='def solve(value): return value'",
      ),
    'native attempt recovery',
  )
  await until(
    () => execute("return document.querySelector('.judge-result')?.textContent.includes('通过')"),
    'native recovered judge result',
  )
  await execute("document.querySelector('.leetcode-history > summary').click()")
  await execute("document.querySelector('.attempt-history > summary').click()")
  await until(
    async () =>
      (await execute("return document.querySelector('.attempt-code code')?.textContent")) ===
      attempt.code,
    'native history code',
  )
  await click('结束作答并查看答案')
  await execute("document.querySelector('.grade-button.good').click()")
  await until(
    () => execute("return document.body.textContent.includes('本轮复习结束')"),
    'native practice rating',
  )
  await click('返回')
  await click('练习历史')
  await until(
    () =>
      execute(
        "return document.querySelectorAll('.practice-history-page .practice-history').length===1",
      ),
    'native independent history',
  )
  await execute(
    "document.querySelector('.practice-history-page .attempt-history > summary').click()",
  )
  await until(
    async () =>
      (await execute("return document.querySelector('.attempt-code code')?.textContent")) ===
      attempt.code,
    'native independent history code',
  )
  // Production CSP and WebKit must allow the bundled worker and SQLite wasm.
  // The generated File contains only the committed synthetic Anki fixture.
  await execute("document.querySelectorAll('.main-nav button')[1].click()")
  await click('批量导入')
  await execute(
    "const select=document.querySelector('#import-format');select.value='anki';select.dispatchEvent(new Event('change',{bubbles:true}));",
  )
  await until(
    () => execute("return !!document.querySelector('#anki-file')"),
    'native Anki file input',
  )
  await execute(
    `const bytes=Uint8Array.from(atob(arguments[0]), c=>c.charCodeAt(0));
    const transfer=new DataTransfer();transfer.items.add(new File([bytes],'modern.apkg',{type:'application/zip'}));
    const input=document.querySelector('#anki-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));`,
    (await readFile('tests/fixtures/anki/modern.apkg')).toString('base64'),
  )
  await until(
    () =>
      execute(
        "return document.querySelector('.anki-preview')?.textContent.includes('可导入 4 条')",
      ),
    'native Anki worker preview',
  )
  await writeFile(
    'test-results/native-anki-preview.png',
    Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
  )
  await click('确认导入')
  await until(
    () =>
      execute(
        "return !document.querySelector('dialog') && document.querySelectorAll('tbody tr').length===7",
      ),
    'native Anki import saved',
  )
  await command(`/session/${session}/refresh`, {})
  await until(
    () => execute("return document.querySelectorAll('.deck-title').length===1"),
    'native Anki restart',
  )
  assert.equal(
    await execute(`return (async()=>{ const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('repeaty');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    try{return await new Promise((resolve,reject)=>{const r=db.transaction('notes').objectStore('notes').getAll();r.onsuccess=()=>resolve(r.result.filter(n=>n.id.startsWith('anki:')).length);r.onerror=()=>reject(r.error)})}finally{db.close()}})();`),
    4,
  )
  await execute("document.querySelectorAll('.main-nav button')[1].click()")
  await click('批量导入')
  await execute(
    "const select=document.querySelector('#import-format');select.value='anki';select.dispatchEvent(new Event('change',{bubbles:true}));",
  )
  await until(
    () => execute("return !!document.querySelector('#anki-file')"),
    'native repeated import input',
  )
  await execute(
    `const bytes=Uint8Array.from(atob(arguments[0]), c=>c.charCodeAt(0));
    const transfer=new DataTransfer();transfer.items.add(new File([bytes],'updated.apkg',{type:'application/zip'}));
    const input=document.querySelector('#anki-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));`,
    (await readFile('tests/fixtures/anki/updated.apkg')).toString('base64'),
  )
  await until(
    () =>
      execute(
        "return document.querySelector('.anki-preview')?.textContent.includes('3 条内容不同')",
      ),
    'native SHA-256 attachment comparison',
  )
  await execute("document.querySelector('.anki-detail-toggle').click()")
  await until(
    () => execute("return document.querySelectorAll('.anki-compare-side audio').length===2"),
    'native comparison media',
  )
  await writeFile(
    'test-results/native-anki-comparison.png',
    Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
  )
  await click('选择所有内容不同的笔记')
  assert.equal(
    await execute(
      "return [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='确认导入').disabled",
    ),
    true,
  )
  await execute("document.querySelector('.anki-card-impact input').click()")
  await click('确认导入')
  await until(
    () => execute("return !document.querySelector('dialog')"),
    'native repeated import saved',
  )
  await command(`/session/${session}/refresh`, {})
  await until(
    () => execute("return document.querySelectorAll('.deck-title').length===1"),
    'native updated library restart',
  )
  const updatedCounts =
    await execute(`return (async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('repeaty');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    try { const result={};for(const key of ['notes','cards','reviews','attempts'])result[key]=await new Promise((resolve,reject)=>{const r=db.transaction(key).objectStore(key).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return {notes:result.notes.filter(n=>n.id.startsWith('anki:')).length,cards:result.cards.length,reviews:result.reviews.length,attempts:result.attempts.length}}finally{db.close()}})();`)
  assert.deepEqual(updatedCounts, { notes: 5, cards: 7, reviews: 1, attempts: 1 })
  await click('学习材料')
  await until(
    () => execute("return !!document.querySelector('.sources-page')"),
    'native sources page',
  )
  await click('导入材料')
  await until(
    () => execute("return !!document.querySelector('#source-file')"),
    'native source file input',
  )
  const sourceQuote = '原生摘录🙂'
  const sourceText = '# Native source\n\n' + 'Context 中文\n'.repeat(3000) + sourceQuote + '\n'
  await execute(
    `const bytes=Uint8Array.from(atob(arguments[0]),c=>c.charCodeAt(0));
    const transfer=new DataTransfer();transfer.items.add(new File([bytes],'Native source.md',{type:'text/markdown'}));
    const input=document.querySelector('#source-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));`,
    Buffer.from(sourceText).toString('base64'),
  )
  await until(
    () => execute("return document.querySelector('#source-content')?.value.includes('原生摘录')"),
    'native UTF-8 source file',
  )
  await click('保存材料')
  await until(
    () =>
      execute(
        "return !document.querySelector('dialog') && document.querySelector('.source-text')?.value.includes('原生摘录')",
      ),
    'native source snapshot saved',
  )
  const exportingSource = click('导出原文')
  const sourceChooser = await until(async () => {
    const { stdout } = await exec(xdotool, ['search', '--onlyvisible', '--name', 'Save'])
    return stdout.trim().split('\n').at(-1)
  }, 'source save dialog')
  await exec(xdotool, ['windowfocus', sourceChooser])
  await exec(xdotool, ['key', '--clearmodifiers', 'ctrl+l', 'ctrl+a'])
  await exec(xdotool, [
    'type',
    '--clearmodifiers',
    join(directory, 'downloads', 'native-source.md'),
  ])
  await exec(xdotool, ['key', '--clearmodifiers', 'Return'])
  await sleep(300)
  await exec(xdotool, ['key', '--clearmodifiers', 'alt+s'])
  await exportingSource
  await until(async () => {
    try {
      return (
        (await readFile(join(directory, 'downloads', 'native-source.md'), 'utf8')) === sourceText
      )
    } catch {
      return false
    }
  }, 'native original text export')
  await execute(
    "const el=document.querySelector('.source-text');el.focus();el.setSelectionRange(arguments[0],arguments[1]);el.dispatchEvent(new Event('select',{bubbles:true}));",
    sourceText.lastIndexOf(sourceQuote),
    sourceText.lastIndexOf(sourceQuote) + sourceQuote.length,
  )
  await click('用摘录制卡')
  await until(
    () => execute("return !!document.querySelector('#card-front')"),
    'native excerpt editor',
  )
  await fill('#card-front', 'Native source question')
  assert.equal(await execute("return document.querySelector('#card-back').value"), sourceQuote)
  await click('保存卡片')
  await until(
    () => execute("return !document.querySelector('dialog')"),
    'native excerpt note saved',
  )
  await execute("document.querySelectorAll('.main-nav button')[1].click()")
  await fill('.search-field input', 'Native source question')
  await until(
    () =>
      execute(
        "return document.querySelectorAll('tbody tr').length===1 && document.querySelector('tbody tr').textContent.includes('Native source question')",
      ),
    'native excerpt filter',
  )
  await execute(
    "document.querySelector('.search-options').open=true;const select=document.querySelector('.study-form select');select.value='true';select.dispatchEvent(new Event('change',{bubbles:true}));",
  )
  await until(
    () => execute("return document.querySelector('.study-form button')?.disabled === false"),
    'native source practice ready',
  )
  await click('开始专项练习')
  await until(
    () =>
      execute(
        "return document.querySelector('.card-question')?.textContent.includes('Native source question')",
      ),
    'native source review',
  )
  assert.equal(await execute("return !!document.querySelector('.review-source')"), false)
  await click('显示答案')
  await execute("document.querySelector('.review-source button').click()")
  await until(
    async () =>
      (await execute("return document.querySelector('.source-original mark')?.textContent")) ===
      sourceQuote,
    'native excerpt anchor',
  )
  await writeFile(
    'test-results/native-source-context.png',
    Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
  )
  await execute("document.querySelector('dialog .form-actions button').click()")
  await execute("document.querySelector('.grade-button.good').click()")
  await until(
    () => execute("return document.body.textContent.includes('本轮练习结束')"),
    'native source rating saved',
  )
  await command(`/session/${session}/refresh`, {})
  await until(
    () => execute("return document.querySelectorAll('.deck-title').length===1"),
    'native source restart',
  )
  await click('学习材料')
  await until(
    async () =>
      (await execute("return document.querySelector('.source-text')?.value")) === sourceText,
    'native snapshot after restart',
  )
  const selectDraftExcerpt = () =>
    execute(
      `const el=document.querySelector('.source-text');
    const start=el.value.lastIndexOf(arguments[0]);el.focus();el.setSelectionRange(start,start+arguments[0].length);el.dispatchEvent(new Event('select',{bubbles:true}));`,
      sourceQuote,
    )
  await selectDraftExcerpt()
  await click('通过 MCP 制卡')
  await waitButton('开启 MCP')
  await click('开启 MCP')
  await waitButton('分享这段摘录')
  await writeFile(
    'test-results/native-draft-sharing.png',
    Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
  )
  const draftMcp = (await invoke('mcp_configuration')).mcpServers.repeaty
  await click('分享这段摘录')
  await until(
    () => execute("return !!document.querySelector('.draft-queue')"),
    'native draft queue',
  )
  const selection = (
    await mcpRpc(draftMcp, 'tools/call', { name: 'repeaty_selected_excerpt', arguments: {} })
  ).result.structuredContent
  assert.equal(selection.text, sourceQuote)
  assert.equal(Object.hasOwn(selection, 'url'), false)
  assert.equal(JSON.stringify(selection).includes('Context 中文'), false)
  const beforeDrafts = await libraryRecords()
  const draftArguments = {
    selectionId: selection.selectionId,
    requestId: 'native-draft-batch',
    cards: [
      {
        type: 'basic',
        front: 'Native MCP long question ' + '字'.repeat(9000),
        back: 'Native MCP answer',
        tags: ['native-draft'],
      },
      { type: 'reversed', front: 'forward', back: 'reverse' },
      { type: 'cloze', front: 'Native {{c1::answer}} text' },
    ],
  }
  const receipt = await mcpRpc(draftMcp, 'tools/call', {
    name: 'repeaty_propose_cards',
    arguments: draftArguments,
  })
  assert.equal(receipt.result.isError, false)
  await until(
    () => execute("return document.querySelectorAll('.draft-list li').length===3"),
    'native received drafts',
  )
  const retry = await mcpRpc(draftMcp, 'tools/call', {
    name: 'repeaty_propose_cards',
    arguments: draftArguments,
  })
  assert.deepEqual(retry.result.structuredContent, receipt.result.structuredContent)
  assert.deepEqual(await libraryRecords(), beforeDrafts)
  await click('停止分享')
  assert.equal(
    (await mcpRpc(draftMcp, 'tools/call', { name: 'repeaty_selected_excerpt', arguments: {} }))
      .result.structuredContent.code,
    'selection-unavailable',
  )
  for (let remaining = 3; remaining > 0; remaining--) {
    await click('检查并编辑')
    await until(
      () => execute("return !!document.querySelector('#card-front')"),
      'native draft editor',
    )
    if (remaining === 3) {
      await fill('#card-front', 'Native MCP edited question')
      await fill('#card-back', 'Native MCP edited answer')
    }
    await waitButton('确认并保存卡片')
    await click('确认并保存卡片')
    await until(
      () =>
        execute(
          "return !!document.querySelector('.draft-queue') && document.querySelectorAll('.draft-list li').length===arguments[0]",
          remaining - 1,
        ),
      'native confirmed draft',
    )
  }
  const afterDrafts = await libraryRecords()
  assert.equal(afterDrafts.notes.length, beforeDrafts.notes.length + 3)
  assert.equal(afterDrafts.cards.length, beforeDrafts.cards.length + 4)
  assert.deepEqual(afterDrafts.reviews, beforeDrafts.reviews)
  const oldIds = new Set(beforeDrafts.notes.map((note) => note.id))
  const newNotes = afterDrafts.notes
    .filter((note) => !oldIds.has(note.id))
    .map((note) => note.value)
  assert.deepEqual(newNotes.map((note) => note.type).sort(), ['basic', 'cloze', 'reversed'])
  assert.ok(newNotes.every((note) => note.excerpt.quote === sourceQuote))
  assert.ok(
    newNotes.some(
      (note) => note.front === 'Native MCP edited question' && note.tags.includes('native-draft'),
    ),
  )
  await execute("document.querySelector('dialog .modal-header button').click()")
  await selectDraftExcerpt()
  await click('通过 MCP 制卡')
  await waitButton('分享这段摘录')
  await click('分享这段摘录')
  await until(
    () => execute("return !!document.querySelector('.draft-queue')"),
    'native second excerpt shared',
  )
  const nextSelection = (
    await mcpRpc(draftMcp, 'tools/call', { name: 'repeaty_selected_excerpt', arguments: {} })
  ).result.structuredContent
  assert.equal(nextSelection.text, sourceQuote)
  const unconfirmed = await mcpRpc(draftMcp, 'tools/call', {
    name: 'repeaty_propose_cards',
    arguments: {
      ...draftArguments,
      selectionId: nextSelection.selectionId,
      requestId: 'unconfirmed',
      cards: [draftArguments.cards[0]],
    },
  })
  assert.equal(unconfirmed.result.isError, false)
  await until(
    () => execute("return document.querySelectorAll('.draft-list li').length===1"),
    'native unsaved draft',
  )
  await click('检查并编辑')
  const pendingText = 'Native persisted edit ' + '等待确认🙂\n'.repeat(700)
  await until(
    () => execute("return !!document.querySelector('#card-front')"),
    'native pending draft editor',
  )
  await fill('#card-front', pendingText)
  await fill('#card-back', '')
  await waitButton('保存草稿')
  await click('保存草稿')
  await until(
    () =>
      execute(
        "return !!document.querySelector('.draft-queue') && document.querySelectorAll('.draft-list li').length===1",
      ),
    'native pending edits saved',
  )
  assert.deepEqual(await libraryRecords(), afterDrafts)
  // Close the actual application and reopen the same isolated profile.
  await command(`/session/${session}`, undefined, 'DELETE')
  session = undefined
  await createSession()
  await until(
    () => execute("return document.querySelectorAll('.deck-title').length===1"),
    'native app reopened',
  )
  assert.deepEqual(await libraryRecords(), afterDrafts)
  await waitButton('制卡草稿（1）')
  assert.equal((await invoke('mcp_status')).enabled, false)
  await click('制卡草稿（1）')
  assert.equal(await execute("return document.body.textContent.includes('当前分享的摘录')"), false)
  await click('检查并编辑')
  await until(
    () =>
      execute("return document.querySelector('#card-front')?.value===arguments[0]", pendingText),
    'native restored draft edits',
  )
  assert.equal(await execute("return document.querySelector('#card-back').value"), '')
  await fill('#card-back', 'Native completed answer')
  await waitButton('确认并保存卡片')
  await click('确认并保存卡片')
  await until(
    () =>
      execute(
        "return !!document.querySelector('.draft-queue') && document.querySelectorAll('.draft-list li').length===0",
      ),
    'native restored draft confirmed',
  )
  const confirmed = await libraryRecords()
  assert.equal(confirmed.notes.length, afterDrafts.notes.length + 1)
  assert.equal(confirmed.cards.length, afterDrafts.cards.length + 1)
  assert.deepEqual(confirmed.reviews, afterDrafts.reviews)
  await command(`/session/${session}/refresh`, {})
  await until(
    () => execute("return document.querySelectorAll('.deck-title').length===1"),
    'native consumed draft after reload',
  )
  assert.deepEqual(await libraryRecords(), confirmed)
  assert.equal(await execute("return document.body.textContent.includes('制卡草稿（')"), false)
  console.log(
    'Native MCP excerpt sharing, long drafts, retry, three note types, confirmation and restart passed',
  )
  await click('学习材料')
  await until(
    () =>
      execute("return document.querySelector('.source-text')?.getAttribute('aria-busy')==='false'"),
    'native reading ready',
  )
  await execute(
    "const reader=document.querySelector('.source-text');reader.scrollTop=(reader.scrollHeight-reader.clientHeight)*0.45;reader.dispatchEvent(new Event('scroll'));",
  )
  await waitButton('保存阅读位置')
  await click('保存阅读位置')
  await until(
    () =>
      execute(
        "return document.querySelector('.reading-progress')?.dataset.readingStatus==='saved'",
      ),
    'native reading position saved',
  )
  const sourceRecords = () =>
    execute(`return (async()=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('repeaty');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    try{return await new Promise((resolve,reject)=>{const request=db.transaction('sources').objectStore('sources').getAll();request.onsuccess=()=>resolve(request.result.map(row=>row.value));request.onerror=()=>reject(request.error)})}finally{db.close()}})();`)
  const plainReading = (await sourceRecords())[0].reading
  assert.equal(plainReading.view, 'source')
  assert.ok(plainReading.offset > 1000)
  const plainScroll = await execute("return document.querySelector('.source-text').scrollTop")
  await command(`/session/${session}`, undefined, 'DELETE')
  session = undefined
  await createSession()
  await until(
    () => execute("return document.querySelectorAll('.deck-title').length===1"),
    'native app reopened with reading position',
  )
  await click('学习材料')
  await until(
    () =>
      execute("return document.querySelector('.source-text')?.getAttribute('aria-busy')==='false'"),
    'native plain reading restored',
  )
  assert.deepEqual((await sourceRecords())[0].reading, plainReading)
  assert.ok(
    Math.abs(
      (await execute("return document.querySelector('.source-text').scrollTop")) - plainScroll,
    ) < 60,
  )
  await click('阅读 Markdown 预览')
  await until(
    () =>
      execute(
        "return document.querySelector('.source-markdown-preview')?.getAttribute('aria-busy')==='false'",
      ),
    'native reading preview ready',
  )
  await execute(
    "const reader=document.querySelector('.source-markdown-preview');reader.scrollTop=(reader.scrollHeight-reader.clientHeight)*0.63;reader.dispatchEvent(new Event('scroll'));",
  )
  await waitButton('保存阅读位置')
  await click('保存阅读位置')
  await until(
    () =>
      execute(
        "return document.querySelector('.reading-progress')?.dataset.readingStatus==='saved'",
      ),
    'native preview position saved',
  )
  const previewReading = (await sourceRecords())[0].reading
  assert.equal(previewReading.view, 'preview')
  assert.ok(previewReading.fraction > 0.2)
  await command(`/session/${session}`, undefined, 'DELETE')
  session = undefined
  await createSession()
  await until(
    () => execute("return document.querySelectorAll('.deck-title').length===1"),
    'native app reopened with preview position',
  )
  await click('学习材料')
  await until(
    () =>
      execute(
        "return document.querySelector('.source-markdown-preview')?.getAttribute('aria-busy')==='false'",
      ),
    'native preview restored',
  )
  assert.ok(
    (await execute("return document.querySelector('.source-markdown-preview').scrollTop")) > 1000,
  )
  assert.deepEqual((await sourceRecords())[0].reading, previewReading)
  assert.deepEqual(await libraryRecords(), confirmed)
  await writeFile(
    'test-results/native-reading-restored.png',
    Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
  )
  console.log(
    'Native reading positions: plain text and Markdown preview survive application exits without changing study records',
  )
  const queueView = (label) =>
    execute(
      "const nav=document.querySelector('.source-queue-filters');const button=[...nav.querySelectorAll('button')].find(button=>button.textContent.trim().startsWith(arguments[0]));if(!button)throw Error('Missing queue view');button.click();",
      label,
    )
  async function setReadingPriority(priority) {
    await until(
      () =>
        execute(
          "return !!document.querySelector('.source-priority-control select') && !document.querySelector('.source-priority-control select').disabled",
        ),
      'native priority control available',
    )
    await execute(
      "const select=document.querySelector('.source-priority-control select');select.value=arguments[0];select.dispatchEvent(new Event('change',{bubbles:true}));",
      priority,
    )
    await until(
      () =>
        execute(
          "return document.querySelector('.source-priority-control select')?.value===arguments[0] && !document.querySelector('.source-priority-control select').disabled",
          priority,
        ),
      'native reading priority saved',
    )
    assert.equal((await sourceRecords())[0].priority, priority)
  }
  assert.equal(
    await execute("return document.querySelector('.source-priority-control select').value"),
    'normal',
  )
  await setReadingPriority('high')
  assert.equal((await sourceRecords())[0].queue, undefined)
  assert.deepEqual(await libraryRecords(), confirmed)
  await writeFile(
    'test-results/native-reading-priority.png',
    Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
  )
  await waitButton('归档材料')
  await click('归档材料')
  await until(
    () => execute("return document.body.textContent.includes('暂无待阅读材料')"),
    'native material archived',
  )
  const archivedSource = (await sourceRecords())[0]
  assert.equal(archivedSource.queue.state, 'archived')
  assert.equal(archivedSource.priority, 'high')
  assert.equal(archivedSource.reading.view, 'preview')
  assert.equal(archivedSource.reading.offset, previewReading.offset)
  assert.deepEqual(await libraryRecords(), confirmed)
  await command(`/session/${session}`, undefined, 'DELETE')
  session = undefined
  await createSession()
  await until(
    () => execute("return document.querySelectorAll('.deck-title').length===1"),
    'native archived app reopened',
  )
  await click('学习材料')
  await until(
    () => execute("return document.body.textContent.includes('暂无待阅读材料')"),
    'native archived material stays out of ready queue',
  )
  await queueView('已归档')
  await until(
    () =>
      execute(
        "return document.querySelector('.source-markdown-preview')?.getAttribute('aria-busy')==='false'",
      ),
    'native archived preview restored',
  )
  assert.equal(
    await execute("return document.querySelector('.source-priority-control select').value"),
    'high',
  )
  assert.ok(
    (await execute("return document.querySelector('.source-markdown-preview').scrollTop")) > 1000,
  )
  await waitButton('加入待阅读')
  await click('加入待阅读')
  await until(
    () => execute("return !document.querySelector('.source-reader')"),
    'native archive view empty after restore',
  )
  await queueView('待阅读')
  await until(
    () =>
      execute(
        "return document.querySelector('.source-markdown-preview')?.getAttribute('aria-busy')==='false'",
      ),
    'native restored ready material',
  )
  await waitButton('稍后阅读')
  await click('稍后阅读')
  await until(
    () => execute("return !!document.querySelector('#source-reading-date')?.value"),
    'native reading date',
  )
  const readingDate = await execute("return document.querySelector('#source-reading-date').value")
  await click('保存阅读安排')
  await until(
    () =>
      execute(
        "return !document.querySelector('dialog') && !document.querySelector('.source-reader')",
      ),
    'native reading deferred',
  )
  assert.deepEqual((await sourceRecords())[0].queue, { state: 'active', availableOn: readingDate })
  assert.equal((await sourceRecords())[0].priority, 'high')
  await command(`/session/${session}`, undefined, 'DELETE')
  session = undefined
  await createSession()
  await until(
    () => execute("return document.querySelectorAll('.deck-title').length===1"),
    'native deferred app reopened',
  )
  await click('学习材料')
  await until(
    () => execute("return document.body.textContent.includes('暂无待阅读材料')"),
    'native deferred material stays out of ready queue',
  )
  await queueView('稍后阅读')
  await until(
    () =>
      execute(
        "return document.querySelector('.source-markdown-preview')?.getAttribute('aria-busy')==='false'",
      ),
    'native deferred position restored',
  )
  assert.deepEqual((await sourceRecords())[0].queue, { state: 'active', availableOn: readingDate })
  assert.equal(
    await execute("return document.querySelector('.source-priority-control select').value"),
    'high',
  )
  await setReadingPriority('low')
  assert.deepEqual((await sourceRecords())[0].queue, { state: 'active', availableOn: readingDate })
  assert.deepEqual(await libraryRecords(), confirmed)
  await writeFile(
    'test-results/native-reading-queue.png',
    Buffer.from(await command(`/session/${session}/screenshot`), 'base64'),
  )
  console.log(
    'Native reading priority and queue: changes persist across application exits, preserve dates, positions and study records',
  )
  console.log(
    'Native WebKit/Tauri: starter lifecycle, accounts, upstream, credentials, backup, LeetCode history and Anki import/update, source snapshots, excerpt review and native text export passed.',
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
