import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { workspaceRuntime } from './workspace-runtime'
import { createNativeRepository, type AcceptedDocument } from '../../src/desktop/repository'
import type { ActiveWorkspace } from '../../src/desktop/workspaces'
import { input, now } from '../../src/core/test-fixtures'
import { saveNote, type MediaUpload, type Library } from '../../src/core/model'
import { reviewCard } from '../../src/core/scheduler'
import { prepareMedia } from '../../src/core/media'
import {
  addSource,
  prepareSource,
  sourceExcerpt,
  prepareSourceExcerpt,
  replaceSourceContent,
  saveReadingPosition,
} from '../../src/core/sources'
import { practiceHistoryFixture } from './practice-history'

export async function directoryDigest(root: string) {
  const result: Record<string, string> = {}
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name)
      if (entry.isDirectory()) await walk(full)
      else
        result[relative(root, full).split('\\').join('/')] = createHash('sha256')
          .update(await readFile(full))
          .digest('hex')
    }
  }
  await walk(root)
  return result
}

/** Created and closed by the production Rust protocol, including generated SQLite columns. */
export async function browserWorkspaceFixture(count = 1) {
  const root = await mkdtemp(join(tmpdir(), 'repeaty-web-workspace-'))
  const path = join(root, '本地学习库🙂')
  await mkdir(path)
  const runtime = workspaceRuntime(join(root, 'device'))
  try {
    const status = await runtime.call<{ epoch: string }>('workspace_status')
    const chosen = await runtime.call<{ active: ActiveWorkspace }>('workspace_choose', {
      epoch: status.epoch,
      mode: 'create',
      path,
    })
    const repo = createNativeRepository(
      chosen.active,
      <T>(command: string, args: Record<string, unknown> = {}) => runtime.call<T>(command, args),
    )
    await repo.load()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/hfoAAAAASUVORK5CYII=',
      'base64',
    )
    const wav = Buffer.alloc(44 + 8 * 1024 * 1024)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(wav.length - 8, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(8000, 24)
    wav.writeUInt32LE(16000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(wav.length - 44, 40)
    const image = prepareMedia(new File([png], 'pixel.png', { type: 'image/png' }))
    const audio = prepareMedia(new File([wav], 'long.wav', { type: 'audio/wav' }))
    const oldText = '# 旧版材料\n\n旧版摘录。\n\n' + '长文本与公式 $x^2$。\n'.repeat(10_000)
    const source = prepareSource(
      { title: '目录里的长材料', url: '', format: 'markdown', content: oldText },
      now,
    )
    const quote = sourceExcerpt(
      source.source,
      oldText,
      oldText.indexOf('旧版摘录'),
      oldText.indexOf('旧版摘录') + 4,
    )
    const excerpt = prepareSourceExcerpt(source.source, oldText, quote, '目录里的摘录', now)
    let library: Library = practiceHistoryFixture(3)
    library = { ...library, media: [image.meta, audio.meta] }
    library = addSource(
      addSource(library, source.source, source.asset),
      excerpt.source,
      excerpt.asset,
    )
    library = saveNote(
      library,
      {
        ...input,
        front: '目录里的问题',
        back: '目录里的答案',
        format: 'markdown',
        frontMedia: [image.meta.id],
        backMedia: [audio.meta.id],
        excerpt: quote,
      },
      undefined,
      false,
      now,
    )
    const note = library.notes.at(-1)!,
      card = library.cards.find((card) => card.noteId === note.id)!
    library = reviewCard(library, card.id, 3, now)
    for (let index = 1; index < count; index++)
      library = saveNote(library, { ...input, front: `目录问题 ${index}` }, undefined, false, now)
    library = saveReadingPosition(
      library,
      source.source.id,
      source.source.mediaId,
      { offset: 60000, fraction: 0, view: 'source' },
      now,
    )
    const assets: MediaUpload[] = [image, audio, source.asset, excerpt.asset]
    let saved = await repo.save(library, 0, { assets })
    const text = '# 新版材料\n\n更新后的材料。\n\n' + '继续阅读长文本与公式 $y^2$。\n'.repeat(8000)
    const changed = replaceSourceContent(
      saved.library,
      source.source.id,
      { title: source.source.title, url: '', format: 'markdown', content: text },
      now,
    )
    assets.push(changed.asset)
    saved = await repo.save(changed.library, saved.revision, { assets: [changed.asset] })
    const docs = await runtime.call<AcceptedDocument[]>('workspace_read', {
      token: chosen.active.token,
      request: { type: 'documents' },
    })
    const document = docs.find((doc) => doc.id === note.id)!
    await runtime.close()
    // This working-file edit must not replace the accepted SQLite content in the web trial.
    await writeFile(
      join(path, document.path),
      document.raw.replace('目录里的问题', '尚未接受的外部修改'),
    )
    return {
      root,
      path,
      library: saved.library,
      note,
      card,
      assets,
      sourceId: source.source.id,
      sourceMediaId: source.source.mediaId,
      text,
      oldText,
      async close() {
        await rm(root, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await runtime.close()
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
