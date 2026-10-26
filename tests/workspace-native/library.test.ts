import { beforeAll, afterEach, describe, it, expect } from 'vitest'
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, rename, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeRepository, type AcceptedDocument } from '../../src/desktop/repository'
import { statusSchema, type NativeApi } from '../../src/desktop/workspaces'
import { fixture, input, now } from '../../src/core/test-fixtures'
import { initializeWorkspace } from '../../src/core/onboarding'
import { reviewCard, undoReview } from '../../src/core/scheduler'
import { saveNote } from '../../src/core/model'
import { prepareSource, addSource, saveReadingPosition } from '../../src/core/sources'
import { readWorkspaceMarkdown } from '../../src/workspace/markdown'
import { sha256 } from '../../src/workspace/source-revisions'
import type { CardDraft } from '../../src/core/card-draft-data'
let binary: string
const roots: string[] = []
const processes: ChildProcessWithoutNullStreams[] = []
beforeAll(() => {
  execFileSync(
    'cargo',
    [
      'build',
      '--locked',
      '--manifest-path',
      'crates/workspace-store/Cargo.toml',
      '--example',
      'workspace-runtime',
    ],
    { stdio: 'pipe' },
  )
  const meta = JSON.parse(
    execFileSync(
      'cargo',
      [
        'metadata',
        '--no-deps',
        '--format-version',
        '1',
        '--manifest-path',
        'crates/workspace-store/Cargo.toml',
      ],
      { encoding: 'utf8' },
    ),
  )
  binary = join(
    meta.target_directory,
    'debug/examples/workspace-runtime' + (process.platform === 'win32' ? '.exe' : ''),
  )
})
afterEach(async () => {
  for (const child of processes.splice(0)) {
    if (child.exitCode === null) {
      child.stdin.end()
      await once(child, 'exit')
    }
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
function host(device: string) {
  const child = spawn(binary, [device], { stdio: 'pipe' })
  processes.push(child)
  let next = 0
  let stderr = ''
  child.stderr.on('data', (part) => (stderr += part))
  const waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const item = JSON.parse(line)
    const entry = waiting.get(item.id)
    if (!entry) return
    waiting.delete(item.id)
    if (item.error) entry.reject(new Error(item.error))
    else entry.resolve(item.value)
  })
  child.on('exit', () => {
    for (const entry of waiting.values()) entry.reject(new Error('Native host exited: ' + stderr))
    waiting.clear()
  })
  const api: NativeApi = <T>(command: string, args: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = ++next
      waiting.set(id, { resolve: resolve as (value: unknown) => void, reject })
      child.stdin.write(JSON.stringify({ id, command, args }) + '\n')
    })
  return {
    api,
    async stop() {
      if (child.exitCode === null) {
        child.stdin.end()
        await once(child, 'exit')
      }
    },
  }
}
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'repeaty-live-workspace-'))
  roots.push(root)
  const path = join(root, '学习🙂')
  await mkdir(path)
  const device = join(root, 'device')
  const runtime = host(device)
  const status = statusSchema.parse(await runtime.api('workspace_status'))
  const selected = statusSchema.parse(
    await runtime.api('workspace_choose', { epoch: status.epoch, mode: 'create', path }),
  )
  const active = selected.active!
  return { root, path, device, runtime, active, repo: createNativeRepository(active, runtime.api) }
}
async function docs(env: Awaited<ReturnType<typeof workspace>>) {
  return env.runtime.api<AcceptedDocument[]>('workspace_read', {
    token: env.active.token,
    request: { type: 'documents' },
  })
}
describe('the desktop workspace is the learning store', () => {
  it('creates a real workspace, seeds once and keeps its complete data after closing and copying the folder', async () => {
    const env = await workspace()
    const saved = await initializeWorkspace(env.repo)
    expect(saved.library.cards).toHaveLength(27)
    const documents = await docs(env)
    expect(documents.filter((doc) => doc.kind === 'note')).toHaveLength(saved.library.notes.length)
    for (const doc of documents)
      expect(await readFile(join(env.path, doc.path), 'utf8')).toBe(doc.raw)
    const asset = saved.library.media.find((media) => media.type === 'image/png')!
    const bytes = new Uint8Array(await (await env.repo.getMedia(asset.id))!.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(0)
    expect((await readdir(join(env.path, 'assets'))).some((name) => name.endsWith('.png'))).toBe(
      true,
    )
    await env.runtime.stop()
    const copy = join(env.root, 'copy')
    await cp(env.path, copy, { recursive: true })
    const runtime = host(join(env.root, 'other-device'))
    const state = statusSchema.parse(await runtime.api('workspace_status'))
    const reopened = statusSchema.parse(
      await runtime.api('workspace_choose', { epoch: state.epoch, mode: 'open', path: copy }),
    )
    const repo = createNativeRepository(reopened.active!, runtime.api)
    expect(reopened.active!.id).toBe(env.active.id)
    expect(reopened.active!.token).not.toBe(env.active.token)
    expect(await initializeWorkspace(repo)).toEqual(saved)
    expect(new Uint8Array(await (await repo.getMedia(asset.id))!.arrayBuffer())).toEqual(bytes)
    expect(globalThis.indexedDB).toBeUndefined()
  })
  it('rates and undoes after an actual process restart without rewriting Markdown or losing the FSRS state', async () => {
    const env = await workspace()
    await env.repo.load()
    const first = await env.repo.save(fixture({ format: 'markdown', front: '中文 **题目**🙂' }), 0)
    const document = (await docs(env))[0]!
    const before = await readFile(join(env.path, document.path), 'utf8')
    const rated = await env.repo.save(
      reviewCard(first.library, first.library.cards[0]!.id, 3, now),
      first.revision,
    )
    expect(await readFile(join(env.path, document.path), 'utf8')).toBe(before)
    await env.runtime.stop()
    const runtime = host(env.device)
    const status = statusSchema.parse(await runtime.api('workspace_status'))
    const repo = createNativeRepository(status.active!, runtime.api)
    const reopened = await repo.load()
    expect(reopened).toEqual(rated)
    const undone = await repo.save(undoReview(reopened.library), reopened.revision)
    expect(undone.library).toEqual(first.library)
    expect(await readFile(join(env.path, document.path), 'utf8')).toBe(before)
  })
  it('keeps external edits and ratings separate, accepts a renamed Markdown file, and preserves card identity and comments', async () => {
    const env = await workspace()
    await env.repo.load()
    let saved = await env.repo.save(fixture({ format: 'markdown' }), 0)
    let document = (await docs(env))[0]!
    const raw = document.raw
      .replace('---\n', '\uFEFF---\r\n# user comment\r\n')
      .replace('Question', '外部题目🙂')
    const moved = 'notes/改名🙂.md'
    await rename(join(env.path, document.path), join(env.path, moved))
    await writeFile(join(env.path, moved), raw)
    const changed = saveNote(
      saved.library,
      { ...input, front: 'App change', format: 'markdown' },
      saved.library.notes[0]!.id,
    )
    await expect(env.repo.save(changed, saved.revision)).rejects.toThrow()
    saved = await env.repo.load()
    expect(saved.revision).toBe(1)
    saved = await env.repo.save(
      reviewCard(saved.library, saved.library.cards[0]!.id, 3, now),
      saved.revision,
    )
    expect(await readFile(join(env.path, moved), 'utf8')).toBe(raw)
    // Use a consistent BOM/CRLF document as an external editor would save it.
    const valid = raw.replace(/(?<!\r)\n/g, '\r\n')
    await writeFile(join(env.path, moved), valid)
    const parsed = readWorkspaceMarkdown(valid)
    expect(parsed.status).toBe('managed')
    if (parsed.status !== 'managed' || parsed.document.content.kind !== 'note')
      throw Error('fixture')
    const progress = structuredClone(saved.library.cards)
    saved = await env.repo.save(
      saveNote(
        saved.library,
        {
          ...input,
          format: 'markdown',
          front: parsed.document.content.front,
          back: parsed.document.content.back,
        },
        saved.library.notes[0]!.id,
      ),
      saved.revision,
      {
        externalDocuments: [
          {
            kind: 'note',
            id: document.id,
            path: moved,
            raw: valid,
            expectedHash: document.hash,
            workingHash: await sha256(new TextEncoder().encode(valid)),
          },
        ],
      },
    )
    expect(saved.library.cards).toEqual(progress)
    document = (await docs(env))[0]!
    expect(document.raw).toBe(valid)
    expect(document.path).toBe(moved)
    saved = await env.repo.save(
      saveNote(
        saved.library,
        { ...input, format: 'markdown', front: '编辑题面', back: '新答案' },
        document.id,
      ),
      saved.revision,
    )
    const edited = await readFile(join(env.path, moved), 'utf8')
    expect(edited.startsWith('\uFEFF---\r\n# user comment\r\n')).toBe(true)
    expect(saved.library.cards).toEqual(progress)
  })
  it('stores source snapshots, positions, draft attachments and atomic draft consumption inside the folder', async () => {
    const env = await workspace()
    await env.repo.load()
    let saved = await env.repo.save(fixture(), 0)
    const prepared = prepareSource({
      title: '原文🙂',
      format: 'markdown',
      content: '原文 **中文**\n\n第二段文字🙂',
      url: '',
    })
    saved = await env.repo.save(
      addSource(saved.library, prepared.source, prepared.asset),
      saved.revision,
      { assets: [prepared.asset] },
    )
    const doc = (await docs(env)).find((doc) => doc.kind === 'source')!
    const raw = await readFile(join(env.path, doc.path), 'utf8')
    saved = await env.repo.save(
      saveReadingPosition(
        saved.library,
        prepared.source.id,
        prepared.source.mediaId,
        { offset: 5, fraction: 0, view: 'source' },
        now,
      ),
      saved.revision,
    )
    expect(await readFile(join(env.path, doc.path), 'utf8')).toBe(raw)
    const image = {
      id: crypto.randomUUID(),
      name: 'image.png',
      type: 'image/png' as const,
      size: 4,
      createdAt: now.toISOString(),
    }
    const draft: CardDraft = {
      version: 1,
      id: crypto.randomUUID(),
      position: 0,
      selectionId: crypto.randomUUID(),
      scope: env.repo.scope(),
      mediaId: prepared.source.mediaId,
      deckId: 'deck',
      title: 'Draft',
      format: 'markdown',
      excerpt: { sourceId: prepared.source.id, start: 0, end: 2, quote: '原文' },
      receivedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      input: {
        type: 'basic',
        format: 'markdown',
        front: 'Draft question',
        back: 'Draft answer',
        tags: [],
        frontMedia: [image.id],
        backMedia: [],
      },
      uploads: [
        { meta: image, blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }) },
      ],
    }
    await env.repo.addCardDrafts([draft])
    await env.repo.addCardDrafts([
      { ...draft, input: { ...draft.input, front: 'Retry should not replace' } },
    ])
    const loaded = await env.repo.readCardDrafts()
    expect(loaded[0]!.input.front).toBe('Draft question')
    expect(new Uint8Array(await loaded[0]!.uploads[0]!.blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    )
    saved = await env.repo.save(
      saveNote(
        { ...saved.library, media: [...saved.library.media, image] },
        { ...draft.input, deckId: 'deck', excerpt: draft.excerpt },
      ),
      saved.revision,
      { consumeCardDraft: draft.id },
    )
    expect(await env.repo.readCardDrafts()).toEqual([])
    expect((await env.repo.getMedia(image.id))!.size).toBe(4)
    await expect(
      env.repo.save(saved.library, saved.revision, { consumeCardDraft: draft.id }),
    ).rejects.toThrow()
    expect((await env.repo.load()).revision).toBe(saved.revision)
  })
  it('keeps workspace preferences and unfinished code through a restart, independently of another workspace', async () => {
    const env = await workspace()
    const request = (namespace: string, id: string) => ({ namespace, id, type: 'value' })
    const settings = JSON.stringify({ historyLength: 24, popupInfo: false })
    const code = {
      revision: 'test',
      lang: 'rust',
      code: { rust: 'fn main() { /* 中文🙂 */ }' },
      attempts: 0,
      elapsedMs: 8000,
      answerSeen: false,
      mode: 'automatic',
    }
    for (const [namespace, id, value] of [
      ['settings', 'repeaty.preferences.v1', settings],
      ['leetcode', 'card-1', code],
    ] as const)
      await env.runtime.api('workspace_write', {
        token: env.active.token,
        request: { ...request(namespace, id), value },
      })
    await env.runtime.stop()
    const runtime = host(env.device),
      status = statusSchema.parse(await runtime.api('workspace_status'))
    expect(
      await runtime.api('workspace_read', {
        token: status.active!.token,
        request: { type: 'settings' },
      }),
    ).toEqual({ 'repeaty.preferences.v1': settings })
    expect(
      await runtime.api('workspace_read', {
        token: status.active!.token,
        request: request('leetcode', 'card-1'),
      }),
    ).toEqual(code)
    const other = join(env.root, 'empty')
    await mkdir(other)
    const switched = statusSchema.parse(
      await runtime.api('workspace_choose', { epoch: status.epoch, mode: 'create', path: other }),
    )
    expect(
      await runtime.api('workspace_read', {
        token: switched.active!.token,
        request: request('leetcode', 'card-1'),
      }),
    ).toBeNull()
    expect(
      await runtime.api('workspace_read', {
        token: switched.active!.token,
        request: { type: 'settings' },
      }),
    ).toEqual({})
  })
  it('grades a 1200-card library through a bounded record patch with no document scan or media reads', async () => {
    const env = await workspace()
    const initial = fixture({
      format: 'markdown',
      front: '  保留空白 **中文**\n第二行  ',
      back: '\n答案\n',
    })
    const base = initial.notes[0]!,
      card = initial.cards[0]!
    initial.notes = Array.from({ length: 1200 }, (_, i) => ({ ...base, id: 'note-' + i }))
    initial.cards = Array.from({ length: 1200 }, (_, i) => ({
      ...card,
      id: 'card-' + i,
      noteId: 'note-' + i,
    }))
    const calls: { command: string; request: Record<string, unknown> }[] = []
    const api: NativeApi = (command, args) => {
      calls.push({ command, request: args?.request as Record<string, unknown> })
      return env.runtime.api(command, args)
    }
    const repo = createNativeRepository(env.active, api)
    await repo.load()
    const first = await repo.save(initial, 0)
    calls.length = 0
    const rated = await repo.save(reviewCard(first.library, 'card-0', 3, now), first.revision)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.request.type).toBe('commit')
    const commit = calls[0]!.request.input as { patches: unknown[]; documents: unknown[] }
    expect(commit.patches.length).toBeLessThanOrEqual(4)
    expect(commit.documents).toEqual([])
    expect(rated.library.notes[0]!.front).toBe(base.front)
    expect(rated.library.notes[0]!.back).toBe(base.back)
  })
  it('rejects stale tokens, directory replacement, nonempty creation and another process opening the same library', async () => {
    const env = await workspace()
    await env.repo.load()
    const saved = await env.repo.save(fixture(), 0)
    const other = host(join(env.root, 'other'))
    const otherStatus = statusSchema.parse(await other.api('workspace_status'))
    await expect(
      other.api('workspace_choose', { epoch: otherStatus.epoch, path: env.path, mode: 'open' }),
    ).rejects.toThrow('workspace-already-open')
    let status = statusSchema.parse(await env.runtime.api('workspace_status'))
    await expect(
      env.runtime.api('workspace_choose', { epoch: status.epoch, path: env.path, mode: 'create' }),
    ).rejects.toThrow('workspace-not-empty')
    const moved = join(env.root, 'moved')
    const renamed = await rename(env.path, moved).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code ?? ''))
          return false
        throw error
      },
    )
    if (renamed) {
      await mkdir(env.path)
      await expect(env.repo.load()).rejects.toThrow()
      await rm(env.path, { recursive: true })
      await rename(moved, env.path)
    } else expect(await env.repo.load()).toEqual(saved)
    status = statusSchema.parse(await env.runtime.api('workspace_close', { epoch: status.epoch }))
    await expect(env.repo.save(saved.library, saved.revision)).rejects.toThrow()
    const restored = statusSchema.parse(
      await env.runtime.api('workspace_recent', {
        epoch: status.epoch,
        path: env.active.path,
        id: env.active.id,
      }),
    )
    expect(restored.active!.token).not.toBe(env.active.token)
    expect(await createNativeRepository(restored.active!, env.runtime.api).load()).toEqual(saved)
  })
})
