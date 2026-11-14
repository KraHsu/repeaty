import { isScalar, parseDocument } from 'yaml'
import { rekeyBackup, type BackupData } from './backups'
import { validateRetiredBackup } from './retired-backup'
import { readWorkspaceMarkdown } from '../workspace/markdown'
import { referencedSource } from './source-data'

const hash = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')

/** Only replace known identity scalars; unrelated YAML, comments and body bytes stay verbatim. */
function rewriteDocument(raw: string, ids: ReadonlyMap<string, string>): string {
  const parsed = readWorkspaceMarkdown(raw)
  if (parsed.status !== 'managed') throw new Error('invalid-retired-document')
  const opening = /^(?:\uFEFF)?---(\r?\n)/.exec(raw)!,
    closing = /^---(\r?\n|$)/gm
  closing.lastIndex = opening[0].length
  const end = closing.exec(raw)!,
    start = opening[0].length
  const yaml = parseDocument(raw.slice(start, end.index), { schema: 'core', uniqueKeys: true })
  const edits: { start: number; end: number; text: string }[] = []
  const replace = (path: (string | number)[]) => {
    const node = yaml.getIn(path, true)
    if (!isScalar(node) || typeof node.value !== 'string' || !node.range) return
    const replacement = ids.get(node.value)
    if (!replacement) throw new Error('退役笔记原文引用的媒体或材料版本缺失。')
    if (replacement === node.value) return
    const old = raw.slice(start + node.range[0], start + node.range[1])
    edits.push({
      start: start + node.range[0],
      end: start + node.range[1],
      text: JSON.stringify(replacement) + (/\r?\n$/.test(old) ? parsed.document.framingEol : ''),
    })
  }
  for (const field of ['frontMedia', 'backMedia']) {
    const references = parsed.document.header[field]
    if (Array.isArray(references))
      references.forEach((_ref, index) => replace(['repeaty', field, index, 'id']))
  }
  for (const key of Object.keys(parsed.document.header.plugin?.variantLocators ?? {}))
    replace(['repeaty', 'plugin', 'variantLocators', key, 'versionId'])
  replace(['repeaty', 'excerpt', 'mediaId'])
  replace(['repeaty', 'excerpt', 'locator', 'versionId'])
  const inline = parsed.document.header.inlineMedia
  if (Array.isArray(inline))
    inline.forEach((_ref, index) => replace(['repeaty', 'inlineMedia', index, 'mediaId']))
  let rewritten = raw
  for (const edit of edits.sort((a, b) => b.start - a.start))
    rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end)
  if (readWorkspaceMarkdown(rewritten).status !== 'managed')
    throw new Error('invalid-retired-document')
  return rewritten
}

/** Async restore preflight retains the synchronous rekey helper used by pure model operations. */
export async function prepareBackupRestore(data: BackupData): Promise<BackupData> {
  validateRetiredBackup(data.library, data.retired ?? [])
  const next = rekeyBackup(data),
    ids = new Map(data.assets.map((asset, index) => [asset.meta.id, next.assets[index]!.meta.id]))
  const assets = new Map(next.assets.map((asset) => [asset.meta.id, asset.blob])),
    texts = new Map<string, Promise<string>>()
  for (const entry of next.retired ?? []) {
    if (entry.document) {
      const document = { ...entry.document }
      if ((await hash(new TextEncoder().encode(document.raw))) !== document.hash)
        throw new Error('退役笔记原文的校验和不一致。')
      const raw = rewriteDocument(document.raw, ids)
      entry.document = { ...document, raw, hash: await hash(new TextEncoder().encode(raw)) }
    }
    const excerpt = entry.note?.excerpt
    if (excerpt) {
      const source = next.library.sources.find((source) => source.id === excerpt.sourceId)
      const versionId = source && referencedSource(source, excerpt)?.mediaId
      const blob = versionId && assets.get(versionId)
      if (!blob) throw new Error('退役卡片的来源正文缺失。')
      let reading = texts.get(versionId!)
      if (!reading) {
        reading = blob.text()
        texts.set(versionId!, reading)
      }
      if ((await reading).slice(excerpt.start, excerpt.end) !== excerpt.quote)
        throw new Error('退役卡片的摘录与来源正文不一致。')
    }
    for (const reference of entry.note?.inlineMedia ?? []) {
      const blob = assets.get(reference.mediaId)
      if (!blob || (await hash(new Uint8Array(await blob.arrayBuffer()))) !== reference.hash)
        throw new Error('退役卡片的内嵌附件缺失或已损坏。')
    }
  }
  validateRetiredBackup(next.library, next.retired ?? [])
  return next
}
