import { fixture, input, now } from '../../src/core/test-fixtures'
import {
  addSource,
  prepareSource,
  prepareSourceExcerpt,
  sourceExcerpt,
  saveReadingPosition,
} from '../../src/core/sources'
import { saveNote, type MediaUpload } from '../../src/core/model'
import type { MaterialLocator } from '../../src/core/material-data'

export function materialFixture() {
  const text = 'First page.\nSecond page with a quotation.'
  const root = prepareSource(
    { title: 'Original PDF', url: '', format: 'plain', content: text },
    now,
  )
  const blob = new Blob(['%PDF-original-byte-preservation'], { type: 'application/pdf' })
  const original: MediaUpload = {
    meta: {
      id: crypto.randomUUID(),
      name: 'original.pdf',
      type: 'application/pdf',
      size: blob.size,
      createdAt: now.toISOString(),
    },
    blob,
  }
  root.source.document = {
    schemaVersion: 1,
    providerId: 'example.materials',
    readerId: 'pdf',
    format: 'pdf',
    originalMediaId: original.meta.id,
    importKey: 'a'.repeat(64),
  }
  const locator: MaterialLocator = {
    schemaVersion: 1,
    sourceId: root.source.id,
    versionId: root.source.mediaId,
    kind: 'pdf',
    regions: [
      { page: 0, x: 0.1, y: 0.2, width: 0.4, height: 0.2 },
      { page: 1, x: 0.2, y: 0.1, width: 0.3, height: 0.4 },
    ],
  }
  const excerpt = { ...sourceExcerpt(root.source, text, 0, 11), locator }
  const child = prepareSourceExcerpt(root.source, text, excerpt, 'Selected pages', now)
  child.source.parentSourceId = root.source.id
  let library = fixture()
  library.media.push(original.meta)
  library = addSource(addSource(library, root.source, root.asset), child.source, child.asset)
  library = saveNote(library, { ...input, excerpt }, undefined, false, now)
  library = saveReadingPosition(
    library,
    root.source.id,
    root.source.mediaId,
    { offset: 0, fraction: 0, view: 'source', locator },
    now,
  )
  library.materialReceipts = [
    {
      id: 'receipt:import',
      pluginId: 'example.materials',
      operationId: 'import-1',
      kind: 'import',
      fingerprint: 'b'.repeat(64),
      result: { sourceIds: [root.source.id, child.source.id], noteIds: [] },
      createdAt: now.toISOString(),
    },
  ]
  const assets = [original, root.asset, child.asset]
  const read = async (id: string) => assets.find((asset) => asset.meta.id === id)?.blob
  return { library, assets, read, root, child, original, locator, text }
}
