import { cardDraftSchema } from '../core/card-draft-data'
import { createWorkspaceMarkdown, type JsonObject } from './markdown'
import { createSourceRevision, quoteSource } from './source-revisions'
import type { AcceptanceContext } from './acceptance'

export const workspaceId = 'a805f495-125b-4c8a-9030-a66492db3311'
export const preparedAt = new Date('2026-10-25T18:00:00.000Z')
export function context(id = workspaceId): AcceptanceContext {
  return {
    workspaceId: id,
    decks: new Set(['deck']),
    assets: [],
    sources: [],
    installedPlugins: new Set(),
  }
}
export function rawNote(
  type = 'basic',
  front = '  中文问题🙂\r\n',
  back = '\n答案  ',
  extra: JsonObject = {},
) {
  return createWorkspaceMarkdown(
    {
      repeaty: {
        version: 1,
        kind: 'note',
        id: 'note-original',
        type,
        format: 'markdown',
        deckId: 'deck',
        ...extra,
      },
      custom: { editor: 'retained' },
    },
    { kind: 'note', front, back },
  )
}
export async function actualDraft() {
  const revision = await createSourceRevision(
    'source-original',
    'markdown',
    '前文\r\n中文🙂原文\n后文',
  )
  const origin = quoteSource(
    revision,
    revision.body.indexOf('中文'),
    revision.body.indexOf('\n后文'),
  )
  const blob = new Blob(['original image bytes'], { type: 'image/png' })
  const audio = new Blob(['original audio bytes'], { type: 'audio/mpeg' })
  const draft = cardDraftSchema.parse({
    version: 1,
    id: 'f1555452-5bdf-4730-aab8-93bcaed3a984',
    position: 7,
    selectionId: 'e5f06698-e342-4bda-bdd2-a54af3e39b35',
    scope: 'local:repeaty',
    mediaId: 'old-source-media',
    deckId: 'deck',
    title: '原草稿标题',
    format: 'markdown',
    excerpt: {
      sourceId: origin.sourceId,
      start: origin.start,
      end: origin.end,
      quote: origin.quote,
    },
    receivedAt: preparedAt.toISOString(),
    updatedAt: preparedAt.toISOString(),
    input: {
      type: 'reversed',
      format: 'markdown',
      front: '\n问题🙂  ',
      back: '\r\n答案\r\n',
      tags: ['中文'],
      frontMedia: ['original-image-id'],
      backMedia: ['original-audio-id'],
    },
    uploads: [
      {
        meta: {
          id: 'original-image-id',
          name: '图片.png',
          type: blob.type,
          size: blob.size,
          createdAt: preparedAt.toISOString(),
        },
        blob,
      },
      {
        meta: {
          id: 'original-audio-id',
          name: 'recording.mp3',
          type: audio.type,
          size: audio.size,
          createdAt: preparedAt.toISOString(),
        },
        blob: audio,
      },
    ],
  })
  return { draft, revision, origin }
}
