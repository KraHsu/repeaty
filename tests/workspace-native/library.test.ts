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
import { operationFor, revertOperation, replayOperation } from '../../src/core/operations'
import { operationHistory } from '../../src/core/operation-history'
import { saveNote, removeNotes } from '../../src/core/model'
import { noteLifecycle } from '../../src/desktop/retirement'
import {
  prepareSource,
  prepareSourceExcerpt,
  sourceExcerpt,
  replaceSourceContent,
  readSource,
  addSource,
  saveReadingPosition,
} from '../../src/core/sources'
import { sourceAtVersion } from '../../src/core/source-data'
import { exportBackup, parseBackup, rekeyBackup } from '../../src/core/backups'
import { readWorkspaceMarkdown, registerWorkspaceNote } from '../../src/workspace/markdown'
import { sha256 } from '../../src/workspace/source-revisions'
import type { CardDraft } from '../../src/core/card-draft-data'
import { materialFixture } from '../fixtures/material-model'
import {
  editSourceContent,
  upsertSourceAnnotation,
  type SourceDraft,
} from '../../src/core/source-workbench'
import { parseSourceProperties } from '../../src/core/source-properties'
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
      waiting.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject: (error) => reject(new Error(`${command}: ${error.message}`)),
      })
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
  it('persists source drafts and consumes them with versioned text, YAML properties and exact annotation history', async () => {
    const env = await workspace()
    const text = '保留旧版本🙂\n可批注正文'
    const prepared = prepareSource({ title: '材料', url: '', format: 'markdown', content: text })
    prepared.source.properties = 'author: Old\nunknown:\n  preserved: true\n'
    const library = addSource(fixture(), prepared.source, prepared.asset)
    const first = await env.repo.save(library, 0, { assets: [prepared.asset] })
    const draft: SourceDraft = {
      id: crypto.randomUUID(),
      sourceId: prepared.source.id,
      mediaId: prepared.source.mediaId,
      scope: env.repo.scope(),
      title: '材料',
      url: '',
      content: '新正文',
      properties: 'author: New\nunknown:\n  preserved: true\n',
      updatedAt: new Date().toISOString(),
    }
    await env.repo.writeSourceDraft(draft)
    expect((await env.repo.load()).revision).toBe(first.revision)
    await env.runtime.stop()
    const runtime = host(env.device)
    const status = statusSchema.parse(await runtime.api('workspace_status'))
    expect(status.active).not.toBeNull()
    const repo = createNativeRepository(status.active!, runtime.api)
    expect(await repo.readSourceDraft(prepared.source.id)).toEqual(draft)
    const reopened = await repo.load()
    const edited = editSourceContent(reopened.library, draft)
    const marked = upsertSourceAnnotation(
      edited.library,
      {
        sourceId: draft.sourceId,
        mediaId: draft.mediaId,
        scope: repo.scope(),
        start: 0,
        end: 5,
        quote: '保留旧版本',
        body: '原始出处',
      },
      text,
    )
    const entry = operationFor(reopened.library, marked, repo.scope(), '编辑材料正文')!
    await expect(
      repo.save(marked, 0, { assets: [edited.asset], consumeSourceDraft: draft.id }),
    ).rejects.toThrow()
    expect(await repo.readSourceDraft(prepared.source.id)).toEqual(draft)
    const saved = await repo.save(marked, reopened.revision, {
      assets: [edited.asset],
      consumeSourceDraft: draft.id,
      operationHistory: operationHistory([entry]),
    })
    expect(await repo.readSourceDraft(prepared.source.id)).toBeUndefined()
    expect(parseSourceProperties(await repo.readSourceProperties(prepared.source.id))).toEqual({
      author: 'New',
      unknown: { preserved: true },
    })
    await repo.save(revertOperation(saved.library, entry), saved.revision, {
      operationHistory: operationHistory([], [entry]),
    })
    expect(parseSourceProperties(await repo.readSourceProperties(prepared.source.id))).toEqual({
      author: 'Old',
      unknown: { preserved: true },
    })
    const old = await repo.getMedia(prepared.source.mediaId)
    expect(await old!.text()).toBe(text)
    expect((await repo.load()).library.cards).toEqual(first.library.cards)
    await runtime.stop()
  })
  it('persists material originals, reading locators and retry receipts through the real workspace and restart', async () => {
    const env = await workspace(),
      material = materialFixture()
    await env.repo.load()
    const saved = await env.repo.save(material.library, 0, { assets: material.assets })
    expect(saved.library).toEqual(material.library)
    expect((await docs(env)).filter((doc) => doc.kind === 'source')).toHaveLength(2)
    await env.runtime.stop()
    const runtime = host(env.device)
    const status = statusSchema.parse(await runtime.api('workspace_status'))
    const repo = createNativeRepository(status.active!, runtime.api)
    expect(await repo.load()).toEqual(saved)
    expect(await (await repo.getMedia(material.original.meta.id))!.text()).toBe(
      await material.original.blob.text(),
    )
    const restored = parseBackup(await exportBackup(saved.library, repo.getMedia))
    expect(restored.library).toEqual(saved.library)
    expect(
      await restored.assets
        .find((asset) => asset.meta.id === material.original.meta.id)!
        .blob.text(),
    ).toBe(await material.original.blob.text())
    const updated = saveReadingPosition(
      saved.library,
      material.root.source.id,
      material.root.source.mediaId,
      {
        offset: 0,
        fraction: 0,
        view: 'source',
        locator: { ...material.locator, regions: [{ page: 3, x: 0, y: 0, width: 1, height: 1 }] },
      },
    )
    const moved = await repo.save(updated, saved.revision)
    expect(moved.library.sources[0]!.reading!.locator).toEqual(updated.sources[0]!.reading!.locator)
    await expect(
      repo.save(
        {
          ...moved.library,
          materialReceipts: moved.library.materialReceipts.map((receipt) => ({
            ...receipt,
            operationId: 'rewritten',
          })),
        },
        moved.revision,
      ),
    ).rejects.toThrow()
    expect(await repo.load()).toEqual(moved)
  })
  it('observes OS hints incrementally, distinguishes accepted self writes and leaves pending text alone when grading', async () => {
    const env = await workspace()
    await env.repo.load()
    let saved = await env.repo.save(
      saveNote(fixture({ format: 'markdown' }), {
        ...input,
        front: 'Other note',
        format: 'markdown',
      }),
      0,
    )
    const document = (await docs(env))[0]!
    async function hint() {
      const deadline = Date.now() + 6000
      while (Date.now() < deadline) {
        const event = await env.runtime.api<{ paths: string[]; full: boolean } | null>(
          'workspace_changes',
          { token: env.active.token },
        )
        if (event) return event
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      throw Error('Missing native filesystem notification')
    }
    await hint()
    const read = <T>(request: unknown) =>
      env.runtime.api<T>('workspace_read', { token: env.active.token, request })
    const first = await read<{ accepted: AcceptedDocument[]; working: { raw: string }[] }>({
      type: 'observe',
      paths: [document.path],
      known: [document.id],
    })
    expect(first.accepted).toHaveLength(1)
    expect(first.working[0]!.raw).toBe(document.raw)
    const external = document.raw
      .replace('Question', '外部修改🙂')
      .replace('Other note', '外部修改🙂')
    await writeFile(join(env.path, document.path), external)
    expect((await hint()).paths).toContain(document.path)
    const observed = await read<{
      accepted: AcceptedDocument[]
      working: { raw: string; path: string }[]
    }>({ type: 'observe', paths: [document.path], known: [document.id] })
    expect(observed.accepted[0]!.raw).toBe(document.raw)
    expect(observed.working).toEqual([
      {
        path: document.path,
        raw: external,
        hash: await sha256(new TextEncoder().encode(external)),
      },
    ])
    expect(await env.repo.load()).toEqual(saved)
    saved = await env.repo.save(
      reviewCard(saved.library, saved.library.cards[0]!.id, 3, now),
      saved.revision,
    )
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(await env.runtime.api('workspace_changes', { token: env.active.token })).toBeNull()
    expect(await readFile(join(env.path, document.path), 'utf8')).toBe(external)
    const state = statusSchema.parse(await env.runtime.api('workspace_status'))
    await env.runtime.api('workspace_close', { epoch: state.epoch })
    await expect(
      env.runtime.api('workspace_changes', { token: env.active.token }),
    ).rejects.toThrow()
  })
  it('hashes only requested working assets and preserves both file contents and library revision', async () => {
    const env = await workspace()
    await env.repo.load()
    const saved = await env.repo.save(fixture(), 0)
    await writeFile(join(env.path, 'assets/a.png'), 'first')
    await writeFile(join(env.path, 'assets/b.wav'), 'untouched')
    const request = (paths: string[]) =>
      env.runtime.api('workspace_read', {
        token: env.active.token,
        request: { type: 'inspect-assets', paths },
      })
    expect(await request(['assets/a.png'])).toEqual([
      { path: 'assets/a.png', hash: await sha256(new TextEncoder().encode('first')) },
    ])
    expect(await request(['assets/missing.png'])).toMatchObject([
      { path: 'assets/missing.png', hash: null },
    ])
    await expect(request(['assets/../workspace.json'])).rejects.toThrow()
    await expect(request(['.repeaty/state.sqlite3'])).rejects.toThrow()
    await expect(request(Array.from({ length: 5 }, () => 'assets/a.png'))).rejects.toThrow()
    expect(await env.repo.load()).toEqual(saved)
    expect(await readFile(join(env.path, 'assets/b.wav'), 'utf8')).toBe('untouched')
  })
  it('accepts source versions with old excerpt anchors and locations intact across restart and complete backup', async () => {
    const env = await workspace()
    await env.repo.load()
    const body = '开头🙂\n旧版摘录\n' + '长文本。'.repeat(20_000)
    const root = prepareSource({ title: '材料', url: '', format: 'markdown', content: body }, now)
    const quote = sourceExcerpt(root.source, body, body.indexOf('旧版'), body.indexOf('旧版') + 4)
    const child = prepareSourceExcerpt(root.source, body, quote, '摘录', now)
    let library = addSource(
      addSource(fixture(), root.source, root.asset),
      child.source,
      child.asset,
    )
    library = saveNote(library, { ...input, excerpt: quote }, library.notes[0]!.id)
    library = saveReadingPosition(
      library,
      root.source.id,
      root.source.mediaId,
      { offset: 60_000, fraction: 0, view: 'source' },
      now,
    )
    let saved = await env.repo.save(reviewCard(library, library.cards[0]!.id, 3, now), 0, {
      assets: [root.asset, child.asset],
    })
    const beforeEdit = saved.library
    const doc = (await docs(env)).find((doc) => doc.id === root.source.id)!
    const raw = doc.raw.replace(body, '更短的第二版🙂')
    await writeFile(join(env.path, doc.path), raw)
    const changed = replaceSourceContent(saved.library, root.source.id, {
      title: '材料',
      url: '',
      format: 'markdown',
      content: '更短的第二版🙂',
    })
    saved = await env.repo.save(changed.library, saved.revision, {
      assets: [changed.asset],
      externalDocuments: [
        {
          kind: doc.kind,
          id: doc.id,
          path: doc.path,
          raw,
          expectedHash: doc.hash,
          workingHash: await sha256(new TextEncoder().encode(raw)),
        },
      ],
    })
    expect(saved.library.cards).toEqual(beforeEdit.cards)
    expect(saved.library.reviews).toHaveLength(1)
    expect(saved.library.sources[0]!.versions![0]!.reading!.offset).toBe(60_000)
    await expect(
      env.repo.save(
        {
          ...saved.library,
          sources: saved.library.sources.map((source) =>
            source.id === root.source.id ? { ...source, versions: [] } : source,
          ),
        },
        saved.revision,
      ),
    ).rejects.toThrow()
    await env.runtime.stop()
    const runtime = host(env.device)
    const status = statusSchema.parse(await runtime.api('workspace_status'))
    const repo = createNativeRepository(status.active!, runtime.api)
    const reopened = await repo.load()
    expect(reopened).toEqual(saved)
    expect(
      await readSource(
        sourceAtVersion(reopened.library.sources[0]!, root.source.mediaId)!,
        reopened.library,
        repo.getMedia,
      ),
    ).toBe(body)
    expect(await readSource(reopened.library.sources[0]!, reopened.library, repo.getMedia)).toBe(
      '更短的第二版🙂',
    )
    const backup = rekeyBackup(parseBackup(await exportBackup(reopened.library, repo.getMedia)))
    expect(backup.library.notes[0]!.excerpt!.mediaId).toBe(
      backup.library.sources[0]!.versions![0]!.mediaId,
    )
    expect(backup.library.cards).toEqual(saved.library.cards)
  })

  it('snapshots relative image/audio files, rejects races and unsafe paths, and retains older bytes after replacement', async () => {
    const env = await workspace()
    await env.repo.load()
    let saved = await env.repo.save(fixture({ format: 'markdown' }), 0)
    const doc = (await docs(env))[0]!
    const picture = 'assets/图片.png',
      sound = 'assets/sound.ogg'
    const oldPicture = Uint8Array.from([137, 80, 78, 71, 1]),
      oldSound = Uint8Array.from([79, 103, 103, 83, 1])
    await writeFile(join(env.path, picture), oldPicture)
    await writeFile(join(env.path, sound), oldSound)
    const raw = doc.raw.replace(
      'Question',
      '![示例](../assets/%E5%9B%BE%E7%89%87.png)\n<audio src="../assets/sound.ogg" controls></audio>',
    )
    await writeFile(join(env.path, doc.path), raw)
    const media = await env.repo.externalMedia(raw, doc.path)
    expect(media.inlineMedia).toHaveLength(2)
    const next = saveNote(
      {
        ...saved.library,
        media: [...saved.library.media, ...media.assets.map((asset) => asset.meta)],
      },
      {
        ...input,
        format: 'markdown',
        front:
          '![示例](../assets/%E5%9B%BE%E7%89%87.png)\n<audio src="../assets/sound.ogg" controls></audio>\n',
        inlineMedia: media.inlineMedia,
      },
      saved.library.notes[0]!.id,
    )
    const options = {
      assets: media.assets,
      assetObservations: media.assetObservations,
      externalDocuments: [
        {
          kind: doc.kind,
          id: doc.id,
          path: doc.path,
          raw,
          expectedHash: doc.hash,
          workingHash: await sha256(new TextEncoder().encode(raw)),
        },
      ],
    }
    await writeFile(join(env.path, picture), Uint8Array.from([137, 80, 78, 71, 2]))
    await expect(env.repo.save(next, saved.revision, options)).rejects.toThrow(
      'working-file-changed',
    )
    expect((await env.repo.load()).revision).toBe(saved.revision)
    await writeFile(join(env.path, picture), oldPicture)
    saved = await env.repo.save(next, saved.revision, options)
    const firstId = saved.library.notes[0]!.inlineMedia![0]!.mediaId
    await writeFile(join(env.path, picture), Uint8Array.from([137, 80, 78, 71, 3]))
    expect(new Uint8Array(await (await env.repo.getMedia(firstId))!.arrayBuffer())).toEqual(
      oldPicture,
    )
    expect(
      await env.runtime.api('workspace_read', {
        token: env.active.token,
        request: { type: 'check-media', kind: 'note', id: saved.library.notes[0]!.id },
      }),
    ).toEqual({ changed: [picture] })
    const replacement = await env.repo.externalMedia(raw, doc.path)
    expect(replacement.inlineMedia[0]!.mediaId).not.toBe(firstId)
    expect(replacement.inlineMedia[1]!.mediaId).toBe(media.inlineMedia[1]!.mediaId)
    expect(replacement.assets).toHaveLength(1)
    for (const path of [
      '../../secret.png',
      '../.repeaty/private.png',
      '/etc/image.png',
      '..%2f..%2fsecret.png',
    ])
      await expect(
        env.repo.externalMedia(raw.replace('../assets/%E5%9B%BE%E7%89%87.png', path), doc.path),
      ).rejects.toThrow()
    await env.runtime.stop()
    const runtime = host(env.device)
    const status = statusSchema.parse(await runtime.api('workspace_status'))
    const repo = createNativeRepository(status.active!, runtime.api)
    await repo.load()
    expect(new Uint8Array(await (await repo.getMedia(firstId))!.arrayBuffer())).toEqual(oldPicture)
  })
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
  it('persists undo and redo journals atomically across native process restarts', async () => {
    const env = await workspace()
    const first = await env.repo.save(fixture({ format: 'markdown', type: 'reversed' }), 0)
    const next = reviewCard(first.library, first.library.cards[0]!.id, 3, now)
    const entry = operationFor(first.library, next, env.repo.scope(), '评分', 'review')!
    const rated = await env.repo.save(next, first.revision, {
      operationHistory: operationHistory([entry]),
    })
    const documents = await docs(env)
    await env.runtime.stop()
    const runtime = host(env.device)
    const status = statusSchema.parse(await runtime.api('workspace_status'))
    const repo = createNativeRepository(status.active!, runtime.api)
    const reopened = await repo.load()
    expect(reopened).toEqual(rated)
    const undone = await repo.save(revertOperation(reopened.library, entry), reopened.revision, {
      operationHistory: operationHistory([], [entry]),
    })
    expect(undone.library).toEqual(first.library)
    const other = createNativeRepository(status.active!, runtime.api)
    const reread = await other.load()
    expect(reread.operationHistory!.redo[0]).toEqual(entry)
    const document = documents[0]!
    const path = join(env.path, document.path)
    await writeFile(path, document.raw + '\nExternal edit must survive')
    const conflicting = saveNote(
      reread.library,
      { ...input, type: 'reversed', front: 'Conflicting edit' },
      reread.library.notes[0]!.id,
    )
    await expect(
      other.save(conflicting, reread.revision, { operationHistory: operationHistory() }),
    ).rejects.toThrow()
    expect((await other.load()).operationHistory).toEqual(reread.operationHistory)
    expect((await other.load()).revision).toBe(reread.revision)
    const redone = await other.save(replayOperation(reread.library, entry), reread.revision, {
      operationHistory: operationHistory([entry]),
    })
    expect(redone.library).toEqual(rated.library)
    expect(await readFile(path, 'utf8')).toContain('External edit must survive')
    await runtime.stop()
    const restarted = host(env.device)
    const restoredStatus = statusSchema.parse(await restarted.api('workspace_status'))
    const final = await createNativeRepository(restoredStatus.active!, restarted.api).load()
    expect(final).toEqual(redone)
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

describe('native note file lifecycle', () => {
  async function scan(env: Awaited<ReturnType<typeof workspace>>) {
    return env.runtime.api<{
      scanHash: string
      retired: { id: string; cards: number }[]
      working: { path: string; hash: string; raw: string }[]
    }>('workspace_read', { token: env.active.token, request: { type: 'scan' } })
  }
  it('retires a direction across restart, restores its original schedule, and recovers a removed note', async () => {
    const env = await workspace()
    await env.repo.load()
    let library = fixture({ type: 'reversed', format: 'markdown' })
    library.decks[0]!.burySiblings = false
    library = reviewCard(library, library.cards[0]!.id, 3, now)
    library = reviewCard(library, library.cards[1]!.id, 2, new Date(now.getTime() + 1000))
    let saved = await env.repo.save(library, 0)
    const id = library.notes[0]!.id,
      reverse = library.cards[1]!,
      before = structuredClone(library)
    let doc = (await docs(env))[0]!
    const raw = registerWorkspaceNote(doc.raw, {
      id,
      deckId: 'deck',
      type: 'basic',
      format: 'markdown',
    }).raw
    await writeFile(join(env.path, doc.path), raw)
    let seen = await scan(env),
      retired = await env.repo.retiredNote(id)
    const reduced = noteLifecycle(
      saved.library,
      { ...saved.library.notes[0]!, type: 'basic' },
      id,
      retired,
      true,
    ).library
    saved = await env.repo.save(reduced, saved.revision, {
      scanHash: seen.scanHash,
      externalDocuments: [
        {
          kind: 'note',
          id,
          path: doc.path,
          raw,
          expectedHash: doc.hash,
          workingHash: seen.working.find((file) => file.path === doc.path)!.hash,
        },
      ],
    })
    expect(saved.library.cards).toEqual([before.cards[0]])
    retired = await env.repo.retiredNote(id)
    expect(retired.cards).toEqual([reverse])
    expect(retired.reviews).toEqual([before.reviews[1]])
    await env.runtime.stop()
    env.runtime = host(env.device)
    const status = statusSchema.parse(await env.runtime.api('workspace_status'))
    env.active = status.active!
    env.repo = createNativeRepository(env.active, env.runtime.api)
    saved = await env.repo.load()
    retired = await env.repo.retiredNote(id)
    saved = await env.repo.save(
      noteLifecycle(saved.library, { ...saved.library.notes[0]!, type: 'reversed' }, id, retired)
        .library,
      saved.revision,
    )
    expect(saved.library.cards).toEqual(before.cards)
    expect(saved.library.reviews).toEqual(before.reviews)
    expect((await env.repo.retiredNote(id)).cards).toEqual([])
    doc = (await docs(env))[0]!
    await rm(join(env.path, doc.path))
    seen = await scan(env)
    saved = await env.repo.save(removeNotes(saved.library, new Set([id])), saved.revision, {
      scanHash: seen.scanHash,
      externalDocuments: [
        { kind: 'note', id, path: doc.path, raw: null, expectedHash: doc.hash, missing: true },
      ],
    })
    expect(saved.library.notes).toEqual([])
    expect(saved.library.reviews).toEqual([])
    expect((await scan(env)).retired).toEqual([expect.objectContaining({ id, cards: 2 })])
    await env.runtime.stop()
    env.runtime = host(env.device)
    env.active = statusSchema.parse(await env.runtime.api('workspace_status')).active!
    env.repo = createNativeRepository(env.active, env.runtime.api)
    saved = await env.repo.load()
    retired = await env.repo.retiredNote(id)
    seen = await scan(env)
    expect(retired.document?.raw).toBe(doc.raw)
    saved = await env.repo.save(
      noteLifecycle(saved.library, retired.note!, id, retired, true).library,
      saved.revision,
      {
        scanHash: seen.scanHash,
        externalDocuments: [
          {
            kind: 'note',
            id,
            path: doc.path,
            raw: retired.document!.raw,
            expectedHash: null,
            missing: true,
          },
        ],
      },
    )
    expect(saved.library.cards).toEqual(before.cards)
    expect(saved.library.reviews).toEqual(before.reviews)
    expect(await readFile(join(env.path, doc.path), 'utf8')).toBe(doc.raw)
    expect((await scan(env)).retired).toEqual([])
  })
  it('registers an ordinary external Markdown file without changing the existing cards', async () => {
    const env = await workspace()
    await env.repo.load()
    let saved = await env.repo.save(fixture(), 0)
    const cards = structuredClone(saved.library.cards),
      id = crypto.randomUUID(),
      path = 'notes/新增🙂.md',
      raw = '外部题目\n<!-- repeaty:answer -->\n外部答案'
    await writeFile(join(env.path, path), raw)
    const seen = await scan(env)
    const parsed = registerWorkspaceNote(raw, {
      id,
      deckId: 'deck',
      format: 'markdown',
      type: 'basic',
    })
    if (parsed.content.kind !== 'note') throw Error('fixture')
    const input = {
      deckId: 'deck',
      type: 'basic' as const,
      format: 'markdown' as const,
      front: parsed.content.front,
      back: parsed.content.back,
      tags: [],
      frontMedia: [],
      backMedia: [],
    }
    const next = noteLifecycle(saved.library, input, id, await env.repo.retiredNote(id)).library
    saved = await env.repo.save(next, saved.revision, {
      scanHash: seen.scanHash,
      externalDocuments: [
        {
          kind: 'note',
          id,
          path,
          raw: parsed.raw,
          expectedHash: null,
          workingHash: seen.working.find((file) => file.path === path)!.hash,
        },
      ],
    })
    expect(saved.library.cards[0]).toEqual(cards[0])
    expect(saved.library.cards).toHaveLength(2)
    const disk = readWorkspaceMarkdown(await readFile(join(env.path, path), 'utf8'))
    expect(disk.status).toBe('managed')
    if (disk.status === 'managed') expect(disk.document.identity.id).toBe(id)
  })
  it('rejects stale missing-file observations and never archives records from a rolled-back transaction', async () => {
    const env = await workspace()
    await env.repo.load()
    let library = fixture()
    library = reviewCard(library, library.cards[0]!.id, 3, now)
    const saved = await env.repo.save(library, 0),
      id = library.notes[0]!.id,
      doc = (await docs(env))[0]!
    await rm(join(env.path, doc.path))
    const missing = await scan(env)
    await writeFile(join(env.path, 'notes/moved.md'), doc.raw)
    const options = {
      scanHash: missing.scanHash,
      externalDocuments: [
        {
          kind: 'note' as const,
          id,
          path: doc.path,
          raw: null,
          expectedHash: doc.hash,
          missing: true,
        },
      ],
    }
    await expect(
      env.repo.save(removeNotes(saved.library, new Set([id])), saved.revision, options),
    ).rejects.toThrow()
    expect((await env.repo.load()).library).toEqual(saved.library)
    expect((await scan(env)).retired).toEqual([])
    await rm(join(env.path, 'notes/moved.md'))
    const again = await scan(env)
    await expect(
      env.runtime.api('workspace_write', {
        token: env.active.token,
        request: {
          type: 'commit',
          input: {
            operationId: crypto.randomUUID(),
            expectedRevision: saved.revision,
            reason: null,
            consumeCardDraft: null,
            scanHash: again.scanHash,
            documents: options.externalDocuments,
            patches: [
              { store: 'notes', id },
              { store: 'cards', id: library.cards[0]!.id },
            ],
          },
        },
      }),
    ).rejects.toThrow()
    expect(await env.repo.load()).toEqual(saved)
    expect((await env.repo.retiredNote(id)).cards).toEqual([])
    expect((await scan(env)).retired).toEqual([])
  })
  it('keeps full code and media after deletion and restores them without another upload', async () => {
    const env = await workspace()
    await env.repo.load()
    const plugin = { id: 'leetcode', version: 1, data: { slug: 'test-problem' } }
    const library = fixture({ type: 'plugin', plugin, format: 'markdown' })
    const note = library.notes[0]!,
      image = {
        id: crypto.randomUUID(),
        name: 'image.png',
        type: 'image/png' as const,
        size: 4,
        createdAt: now.toISOString(),
      }
    library.media = [image]
    note.frontMedia = [image.id]
    library.practices = [
      {
        id: 'practice',
        cardId: library.cards[0]!.id,
        contentRevision: 'revision',
        startedAt: now.toISOString(),
        question: { front: 'Problem', back: 'Answer', format: 'markdown', plugin },
      },
    ]
    const code = '// 中文🙂\n' + 'x'.repeat(48000)
    library.attempts = [
      {
        id: 'attempt',
        practiceId: 'practice',
        submittedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        language: 'rust',
        code,
        elapsedMs: 5000,
        status: 'unknown',
      },
    ]
    let saved = await env.repo.save(library, 0, {
      assets: [
        { meta: image, blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }) },
      ],
    })
    saved = await env.repo.save(removeNotes(saved.library, new Set([note.id])), saved.revision)
    await env.runtime.stop()
    env.runtime = host(env.device)
    env.active = statusSchema.parse(await env.runtime.api('workspace_status')).active!
    env.repo = createNativeRepository(env.active, env.runtime.api)
    saved = await env.repo.load()
    const retired = await env.repo.retiredNote(note.id)
    expect(retired.attempts[0]).not.toHaveProperty('code')
    expect(retired.media).toEqual([image])
    saved = await env.repo.save(
      noteLifecycle(saved.library, retired.note!, note.id, retired, true).library,
      saved.revision,
    )
    expect((await env.repo.getAttempt('attempt')).code).toBe(code)
    expect(new Uint8Array(await (await env.repo.getMedia(image.id))!.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    )
    expect(saved.library.cards).toEqual(library.cards)
    expect(saved.library.practices).toEqual(library.practices)
    expect((await env.repo.retiredNote(note.id)).cards).toEqual([])
  })
})

describe('bounded retirement work', () => {
  it('reindexes surviving long submissions in SQLite without reading or publishing their bodies', async () => {
    const env = await workspace()
    const calls: {
      command: string
      request: {
        type: string
        input?: {
          patches: { store: string; id: string; positionOnly?: boolean; value?: unknown }[]
          documents: unknown[]
        }
      }
    }[] = []
    const api: NativeApi = (command, args) => {
      calls.push({ command, request: args?.request as (typeof calls)[number]['request'] })
      return env.runtime.api(command, args)
    }
    const repo = createNativeRepository(env.active, api)
    await repo.load()
    const plugin = { id: 'leetcode', version: 1, data: { slug: 'test-problem' } }
    const library = fixture({ type: 'plugin', plugin, format: 'markdown' })
    const original = library.notes[0]!,
      card = library.cards[0]!
    library.notes.push({ ...original, id: 'other-note', front: 'Other question' })
    library.cards.push({ ...card, id: 'other-card', noteId: 'other-note' })
    library.practices = library.cards.map((card, index) => ({
      id: 'practice-' + index,
      cardId: card.id,
      contentRevision: 'revision',
      startedAt: now.toISOString(),
      question: { front: 'Problem', back: 'Answer', format: 'markdown', plugin },
    }))
    library.attempts = library.practices.map((practice, index) => ({
      id: 'attempt-' + index,
      practiceId: practice.id,
      submittedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      language: 'rust',
      code: '// ' + index + 'x'.repeat(48000),
      elapsedMs: 5000,
      status: 'unknown',
    }))
    let saved = await repo.save(library, 0)
    const untouched = (await docs(env)).find((doc) => doc.id === 'other-note')!
    calls.length = 0
    saved = await repo.save(removeNotes(saved.library, new Set([original.id])), saved.revision)
    expect(
      calls.some(
        (call) => call.request.type === 'attempts' || call.request.type === 'retired-attempt',
      ),
    ).toBe(false)
    const commit = calls.find((call) => call.request.type === 'commit')!.request.input!
    expect(commit.patches.find((patch) => patch.id === 'attempt-1')).toEqual({
      store: 'attempts',
      id: 'attempt-1',
      position: 0,
      positionOnly: true,
    })
    expect(commit.documents).toHaveLength(1)
    expect(await readFile(join(env.path, untouched.path), 'utf8')).toBe(untouched.raw)
    expect((await repo.getAttempt('attempt-1')).code).toBe(library.attempts[1]!.code)
    expect((await repo.retiredNote('other-note')).cards).toEqual([])
    expect((await repo.retiredNote(original.id)).cards).toEqual([card])
  })
  it('paginates and searches removed notes, then restores the original working path', async () => {
    const env = await workspace()
    await env.repo.load()
    const library = fixture(),
      note = library.notes[0]!,
      card = library.cards[0]!
    library.notes = Array.from({ length: 65 }, (_, index) => ({
      ...note,
      id: 'note-' + index,
      front: 'Archived ' + String(index).padStart(2, '0'),
    }))
    library.cards = library.notes.map((note, index) => ({
      ...card,
      id: 'card-' + index,
      noteId: note.id,
    }))
    let saved = await env.repo.save(library, 0)
    const doc = (await docs(env)).find((doc) => doc.id === 'note-64')!
    saved = await env.repo.save(
      removeNotes(saved.library, new Set(library.notes.map((note) => note.id))),
      saved.revision,
    )
    const read = (query: string, offset: number) =>
      env.runtime.api<{ notes: { id: string }[]; total: number }>('workspace_read', {
        token: env.active.token,
        request: { type: 'retired-list', query, offset },
      })
    const first = await read('', 0),
      next = await read('', 50),
      found = await read('Archived 64', 0)
    expect(first.notes).toHaveLength(50)
    expect(first.total).toBe(65)
    expect(next.notes).toHaveLength(15)
    expect(new Set([...first.notes, ...next.notes].map((note) => note.id)).size).toBe(65)
    expect(found.notes).toEqual([expect.objectContaining({ id: 'note-64' })])
    const retired = await env.repo.retiredNote('note-64')
    saved = await env.repo.save(
      noteLifecycle(saved.library, retired.note!, 'note-64', retired).library,
      saved.revision,
    )
    expect(await readFile(join(env.path, doc.path), 'utf8')).toBe(doc.raw)
    expect((await read('', 0)).total).toBe(64)
    expect(saved.library.cards).toEqual([library.cards[64]])
  })
})
