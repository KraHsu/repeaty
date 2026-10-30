import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createLibraryState } from '../composables/library-state'
import { fixture } from '../core/test-fixtures'
import { createRepository } from '../core/storage'
import { prepareSource } from '../core/sources'
import { createLibraryService } from './library'
const services: ReturnType<typeof createLibraryService>[] = []
afterEach(async () => {
  for (const service of services.splice(0)) await service.commands.close()
  vi.restoreAllMocks()
})
async function setup(body = 'Visible body', properties?: string) {
  const first = prepareSource({
    title: 'Public title',
    content: body,
    format: 'markdown',
    url: 'https://private.example/source',
  })
  first.source.properties = properties
  const second = prepareSource({
    title: 'Unselected',
    content: 'Unselected private body',
    format: 'markdown',
    url: '',
  })
  second.source.parentSourceId = first.source.id
  const image = {
    meta: {
      id: 'image',
      name: 'private-device-name.png',
      type: 'image/png' as const,
      size: 3,
      createdAt: first.source.createdAt,
    },
    blob: new Blob(['png'], { type: 'image/png' }),
  }
  first.source.inlineMedia = [
    {
      url: '../assets/image.png',
      path: 'assets/image.png',
      mediaId: 'image',
      hash: '1'.repeat(64),
    },
  ]
  const library = fixture()
  library.sources = [first.source, second.source]
  library.media.push(first.asset.meta, second.asset.meta, image.meta)
  const repo = createRepository(`publishing-${crypto.randomUUID()}`)
  await repo.save(library, 0, { assets: [first.asset, second.asset, image] })
  const state = createLibraryState()
  const service = createLibraryService(state, {
    createWorkspaceRepository: async () => repo,
    remoteWorkspace: { value: false },
    desktopEdition: false,
    canReviewCard: () => true,
  })
  services.push(service)
  await service.commands.init()
  const controller = new AbortController()
  const api = service.commands.publishingApi({
    pluginId: 'publisher',
    scope: state.scope.value,
    signal: controller.signal,
    assertCurrent() {},
  })
  const request = (publicFields: string[] = []) => ({
    sourceIds: [first.source.id],
    expectedRevision: api.list().revision,
    publicFields,
  })
  return { api, request, repo, state, service, controller, first, second }
}
it('publishes only explicit selections/fields and strips embedded frontmatter without reading unrelated bodies', async () => {
  const t = await setup(
    '---\nrepeaty:\n  id: private-id\nauthor: Author\nsecret: private-secret\n---\nVisible',
    'tags: [one, two]\n_private: hidden',
  )
  const reads = vi.spyOn(t.repo, 'getMedia')
  const result = await t.api.prepare(t.request(['author', 'tags']))
  expect(result.sources).toHaveLength(1)
  expect(result.sources[0]).toMatchObject({
    body: 'Visible',
    fields: { author: 'Author', tags: ['one', 'two'] },
    assets: [],
  })
  expect(JSON.stringify(result)).not.toMatch(
    /private-secret|private-id|private-device-name|private\.example|Unselected/,
  )
  expect(reads.mock.calls.map(([id]) => id)).toEqual([t.first.source.mediaId])
  expect(Object.keys(t.api.list().sources[0]!)).toEqual(['id', 'title', 'versionId'])
})
it.each([
  ['draft: true', 'Visible'],
  ['private: true', 'Visible'],
  ['', '---\ndraft: true\n---\nVisible'],
] as const)('rejects private/draft projections (%s)', async (properties, body) => {
  const t = await setup(body, properties)
  await expect(t.api.prepare(t.request())).rejects.toThrow('publishing-source-private')
})
it('does not expose reserved or nested field values as public template data', async () => {
  const t = await setup('Visible', 'nested:\n  secret: hidden\ntoken: hidden')
  await expect(t.api.prepare(t.request(['token']))).rejects.toThrow('publishing-private-field')
  await expect(t.api.prepare(t.request(['nested']))).rejects.toThrow('publishing-field-type')
  await expect(
    t.api.prepare({ ...t.request(), sourceIds: [t.first.source.id, t.first.source.id] }),
  ).rejects.toThrow()
})
it('allows only actually referenced attachments, with snapshot-private handles and release', async () => {
  const t = await setup('![image](../assets/image.png)')
  const snapshot = await t.api.prepare(t.request())
  const asset = snapshot.sources[0]!.assets[0]!
  expect(asset.reference).toBe('../assets/image.png')
  expect(asset.id).not.toBe('image')
  expect(await (await t.api.asset(snapshot.id, asset.id)).text()).toBe('png')
  await expect(t.api.asset(snapshot.id, 'image')).rejects.toThrow('publishing-asset-denied')
  t.api.release(snapshot.id)
  expect(() => t.api.validate(snapshot.id)).toThrow('publishing-preview-expired')
})
it('rejects a read completing after switching libraries and never publishes a partial snapshot', async () => {
  const t = await setup()
  let finish!: (value: Blob | undefined) => void
  vi.spyOn(t.repo, 'getMedia').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = t.api.prepare(t.request())
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  t.state.scope.value = 'other-library'
  finish(t.first.asset.blob)
  await rejected
  expect(() => t.api.list()).toThrow('publishing-library-changed')
})
it('invalidates previews on actual library edits and activation cancellation', async () => {
  const t = await setup()
  const snapshot = await t.api.prepare(t.request())
  await t.service.commands.saveSource(
    {
      title: 'New source',
      content: 'New',
      format: 'plain',
      url: '',
    },
    t.state.scope.value,
  )
  expect(() => t.api.validate(snapshot.id)).toThrow('publishing-library-changed')
  const next = await t.api.prepare(t.request())
  t.controller.abort()
  expect(() => t.api.validate(next.id)).toThrow()
})
it('keeps a preview usable across focus/blur study-activity saves without rereading bodies', async () => {
  const t = await setup('Visible', 'author: Author')
  const snapshot = await t.api.prepare(t.request(['author']))
  const reads = vi.spyOn(t.repo, 'getMedia')
  await t.service.commands.beginStudyStatistics(t.state.scope.value)
  await t.service.commands.recordStudyActivity(
    [
      {
        id: 'activity:publishing',
        kind: 'other',
        studyDay: '2026-10-30',
        startedAt: '2026-10-30T00:00:00Z',
        endedAt: '2026-10-30T00:00:03Z',
        activeMs: 3000,
      },
    ],
    t.state.scope.value,
  )
  expect(t.api.list().revision).toBeGreaterThan(snapshot.revision)
  expect(() => t.api.validate(snapshot.id)).not.toThrow()
  expect(reads).not.toHaveBeenCalled()
  // Editing privacy metadata still invalidates the exact public projection.
  await t.service.commands.editSourceContent({
    sourceId: t.first.source.id,
    mediaId: t.first.source.mediaId,
    scope: t.state.scope.value,
    content: 'Visible',
    properties: 'private: true',
  })
  expect(() => t.api.validate(snapshot.id)).toThrow('publishing-library-changed')
  await expect(t.api.prepare(t.request())).rejects.toThrow('publishing-source-private')
})
it('allows a background activity commit during a lazy read but rejects an initially stale revision', async () => {
  const t = await setup()
  let finish!: (value: string) => void
  Object.assign(t.repo, {
    readSourceProperties: () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
  })
  const request = t.request()
  const pending = t.api.prepare(request)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await t.service.commands.beginStudyStatistics(t.state.scope.value)
  finish('author: Author')
  const snapshot = await pending
  expect(() => t.api.validate(snapshot.id)).not.toThrow()
  await expect(t.api.prepare(request)).rejects.toThrow('publishing-library-changed')
})
it('maps referenced internal identities without loading or publishing unselected sources', async () => {
  const t = await setup('[[Unselected]]')
  const reads = vi.spyOn(t.repo, 'getMedia')
  const selected = await t.api.prepare(t.request())
  expect(selected.sources).toHaveLength(1)
  expect(selected.sources[0]!.links).toEqual([
    { reference: 'Unselected', sourceId: t.second.source.id },
  ])
  expect(reads.mock.calls.map(([id]) => id)).toEqual([t.first.source.mediaId])
  expect(JSON.stringify(selected)).not.toContain('Unselected private body')
  const snapshot = await t.api.prepare({
    ...t.request(),
    sourceIds: [t.first.source.id, t.second.source.id],
  })
  expect(snapshot.sources[0]!.links).toEqual([
    { reference: 'Unselected', sourceId: t.second.source.id },
  ])
})
it('allows an explicit empty publishing snapshot without reading library content', async () => {
  const t = await setup()
  const media = vi.spyOn(t.repo, 'getMedia')
  const properties = vi.fn(async () => 'private: true')
  Object.assign(t.repo, { readSourceProperties: properties })
  const snapshot = await t.api.prepare({ ...t.request(), sourceIds: [] })
  expect(snapshot.sources).toEqual([])
  expect(media).not.toHaveBeenCalled()
  expect(properties).not.toHaveBeenCalled()
  expect(() => t.api.validate(snapshot.id)).not.toThrow()
  t.api.release(snapshot.id)
  expect(() => t.api.validate(snapshot.id)).toThrow('publishing-preview-expired')
})
it.each(['private: true', 'draft: true', 'status: private', 'status: draft', 'published: false'])(
  'rejects lazy workspace privacy metadata before reading a selected body (%s)',
  async (properties) => {
    const t = await setup()
    const read = vi.fn(async () => properties)
    Object.assign(t.repo, { readSourceProperties: read })
    const media = vi.spyOn(t.repo, 'getMedia')
    await expect(t.api.prepare(t.request())).rejects.toThrow('publishing-source-private')
    expect(read).toHaveBeenCalledExactlyOnceWith(t.first.source.id)
    expect(media).not.toHaveBeenCalled()
  },
)
it('projects selected lazy workspace fields without reading unselected properties or committing metadata', async () => {
  const t = await setup()
  const read = vi.fn(async () => 'author: Imported\nsecret: Hidden\n_private: Hidden')
  Object.assign(t.repo, { readSourceProperties: read })
  const save = vi.spyOn(t.repo, 'save')
  const initialRevision = t.api.list().revision
  const result = await t.api.prepare(t.request(['author']))
  expect(result.sources[0]!.fields).toEqual({ author: 'Imported' })
  expect(read).toHaveBeenCalledExactlyOnceWith(t.first.source.id)
  expect(save).not.toHaveBeenCalled()
  expect(t.api.list().revision).toBe(initialRevision)
  expect(t.state.library.value.sources[0]!.properties).toBeUndefined()
})
it('uses managed properties without rereading an unmanaged fallback', async () => {
  const t = await setup('Visible', 'author: Managed')
  const read = vi.fn(async () => 'author: Old\nprivate: true')
  Object.assign(t.repo, { readSourceProperties: read })
  const result = await t.api.prepare(t.request(['author']))
  expect(result.sources[0]!.fields).toEqual({ author: 'Managed' })
  expect(read).not.toHaveBeenCalled()
})
it.each(['scope', 'revision', 'abort'] as const)(
  'rejects a lazy property read that finishes after its %s changed',
  async (change) => {
    const t = await setup()
    let finish!: (value: string) => void
    Object.assign(t.repo, {
      readSourceProperties: () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    })
    const pending = t.api.prepare(t.request(['author']))
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    if (change === 'scope') t.state.scope.value = 'other-library'
    else if (change === 'abort') t.controller.abort()
    else
      await t.service.commands.saveSource(
        { title: 'Added while reading', content: 'Body', format: 'plain', url: '' },
        t.state.scope.value,
      )
    finish('author: Old')
    await rejected
    expect(t.state.library.value.sources[0]!.properties).toBeUndefined()
  },
)
it.each(['---\n---\nVisible', '---\n...\nVisible'])(
  'strips an empty opening YAML frontmatter block (%s)',
  async (body) => {
    const t = await setup(body)
    expect((await t.api.prepare(t.request())).sources[0]!.body).toBe('Visible')
  },
)
