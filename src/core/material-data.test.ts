import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import { materialFixture } from '../../tests/fixtures/material-model'
import { materialLocatorSchema, validateMaterialLocator } from './material-data'
import { librarySchema, migrateLibrary, pruneMedia, saveNote } from './model'
import { input, now } from './test-fixtures'
import { replaceSourceContent, removeSource, saveReadingPosition } from './sources'
import { sourceAtVersion } from './source-data'
import { exportBackup, parseBackup, rekeyBackup } from './backups'
import { exportArchive, parseArchive } from './archive'
import { createRepository } from './storage'

describe('versioned material locators', () => {
  it('validates format, immutable version identity and normalized multi-page regions', () => {
    const { root, locator } = materialFixture()
    expect(validateMaterialLocator(root.source, locator)).toEqual(locator)
    expect(() =>
      validateMaterialLocator(root.source, { ...locator, versionId: 'new-version' }),
    ).toThrow('version-mismatch')
    expect(() =>
      validateMaterialLocator({ ...root.source, document: undefined }, locator),
    ).toThrow()
    for (const region of [
      { page: -1, x: 0, y: 0, width: 1, height: 1 },
      { page: 0, x: 0.7, y: 0, width: 0.4, height: 1 },
      { page: 0, x: 0, y: 0, width: 0, height: 1 },
    ])
      expect(materialLocatorSchema.safeParse({ ...locator, regions: [region] }).success).toBe(false)
    const binding = { schemaVersion: 1, sourceId: root.source.id, versionId: root.source.mediaId }
    expect(
      materialLocatorSchema.safeParse({ ...binding, kind: 'text', start: 0, end: 2, quote: '🙂' })
        .success,
    ).toBe(true)
    expect(
      materialLocatorSchema.safeParse({ ...binding, kind: 'text', start: 0, end: 1, quote: '🙂' })
        .success,
    ).toBe(false)
    expect(
      materialLocatorSchema.safeParse({
        ...binding,
        kind: 'epub',
        href: 'chapters/one.xhtml',
        cfi: 'epubcfi(/6/2)',
        start: 0,
        end: 5,
      }).success,
    ).toBe(true)
    for (const href of ['../private', 'https://example.com', '/absolute'])
      expect(materialLocatorSchema.safeParse({ ...binding, kind: 'epub', href }).success).toBe(
        false,
      )
    expect(
      materialLocatorSchema.safeParse({ ...binding, kind: 'epub', href: 'chapter.xhtml', start: 5 })
        .success,
    ).toBe(false)
    expect(
      materialLocatorSchema.safeParse({
        ...binding,
        kind: 'image',
        x: 0.5,
        y: 0,
        width: 0.6,
        height: 1,
      }).success,
    ).toBe(false)
  })

  it('retains original bytes, locator and reading on historical versions when the projection is edited', () => {
    const env = materialFixture()
    const changed = replaceSourceContent(
      env.library,
      env.root.source.id,
      { title: 'Edited text', url: '', format: 'plain', content: 'New projection' },
      now,
    )
    expect(changed.source.document).toBeUndefined()
    expect(changed.source.reading).toBeUndefined()
    expect(changed.source.versions![0]!.document).toEqual(env.root.source.document)
    expect(changed.source.versions![0]!.reading!.locator).toEqual(env.locator)
    expect(sourceAtVersion(changed.source, env.root.source.mediaId)!.document).toEqual(
      env.root.source.document,
    )
    expect(librarySchema.parse(changed.library).notes.at(-1)!.excerpt!.locator).toEqual(env.locator)
    expect(
      pruneMedia(saveNote(changed.library, input)).media.some(
        (item) => item.id === env.original.meta.id,
      ),
    ).toBe(true)
    expect(() =>
      saveReadingPosition(changed.library, changed.source.id, changed.source.mediaId, {
        offset: 0,
        fraction: 0,
        view: 'source',
        locator: env.locator,
      }),
    ).toThrow()
    const updated = saveReadingPosition(
      env.library,
      env.root.source.id,
      env.root.source.mediaId,
      {
        offset: 0,
        fraction: 0,
        view: 'source',
        locator: { ...env.locator, regions: [{ page: 2, x: 0, y: 0, width: 1, height: 1 }] },
      },
      now,
    )
    expect(updated).not.toBe(env.library)
  })

  it('preserves documents and all locator references in JSON/archive backups and rekeys each media identity', async () => {
    const env = materialFixture()
    const edited = replaceSourceContent(
      env.library,
      env.root.source.id,
      { title: 'New', url: '', format: 'plain', content: 'New body' },
      now,
    )
    const assets = [...env.assets, edited.asset]
    const read = async (id: string) => assets.find((asset) => asset.meta.id === id)?.blob
    const json = await exportBackup(edited.library, read)
    expect(JSON.parse(json).version).toBe(15)
    const archive = await exportArchive(edited.library, read)
    for (const saved of [parseBackup(json), await parseArchive(archive!)]) {
      expect(saved.library).toEqual(edited.library)
      expect(
        await saved.assets.find((item) => item.meta.id === env.original.meta.id)!.blob.text(),
      ).toBe(await env.original.blob.text())
      const copy = rekeyBackup(saved)
      expect(copy.library.materialReceipts).toEqual([])
      const historical = copy.library.sources[0]!.versions![0]!
      expect(historical.document!.importKey).toBe(env.root.source.document!.importKey)
      expect(historical.document!.originalMediaId).not.toBe(env.original.meta.id)
      expect(historical.reading!.locator!.versionId).toBe(historical.mediaId)
      expect(copy.library.notes.at(-1)!.excerpt!.locator!.versionId).toBe(historical.mediaId)
      expect(copy.library.sources[1]!.origin!.locator!.versionId).toBe(historical.mediaId)
      expect(librarySchema.safeParse(copy.library).success).toBe(true)
    }
  })

  it('checks hierarchy and keeps child content when a parent is removed', () => {
    const env = materialFixture()
    expect(
      librarySchema.safeParse({
        ...env.library,
        sources: [
          { ...env.library.sources[0], parentSourceId: env.child.source.id },
          env.library.sources[1],
        ],
      }).success,
    ).toBe(false)
    const removed = removeSource(env.library, env.root.source.id)
    expect(removed.sources[0]!.parentSourceId).toBeUndefined()
    expect(removed.sources[0]!.origin).toBeUndefined()
    expect(removed.sources[0]!.mediaId).toBe(env.child.source.mediaId)
    expect(librarySchema.safeParse(removed).success).toBe(true)
    expect(
      librarySchema.safeParse({
        ...env.library,
        media: env.library.media.filter((entry) => entry.id !== env.original.meta.id),
      }).success,
    ).toBe(false)
    expect(
      migrateLibrary({ ...env.library, version: 13, materialReceipts: undefined }).materialReceipts,
    ).toEqual([])
  })

  it('persists immutable originals and receipts atomically and blocks older IndexedDB writers', async () => {
    const env = materialFixture(),
      name = `material-${crypto.randomUUID()}`,
      repo = createRepository(name)
    await repo.load()
    const saved = await repo.save(env.library, 0, { assets: env.assets })
    await expect(
      repo.save(
        {
          ...saved.library,
          sources: saved.library.sources.map((source) =>
            source.id === env.root.source.id
              ? { ...source, document: { ...source.document!, providerId: 'different' } }
              : source,
          ),
        },
        saved.revision,
      ),
    ).rejects.toThrow('immutable')
    await expect(
      repo.save(
        {
          ...saved.library,
          materialReceipts: saved.library.materialReceipts.map((receipt) => ({
            ...receipt,
            fingerprint: 'c'.repeat(64),
          })),
        },
        saved.revision,
      ),
    ).rejects.toThrow('immutable')
    expect((await repo.load()).revision).toBe(1)
    await repo.close()
    await expect(openDB(name, 16)).rejects.toMatchObject({ name: 'VersionError' })
    const reopened = createRepository(name)
    expect((await reopened.load()).library).toEqual(env.library)
    expect(await (await reopened.getMedia(env.original.meta.id))!.text()).toBe(
      await env.original.blob.text(),
    )
    await reopened.close()
  })
})
