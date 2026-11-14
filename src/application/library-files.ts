import { noteLifecycle } from '../desktop/retirement'
import { msg, LocalizedError } from '../i18n'
import { removeNotes, saveNote, type NoteInput } from '../core/model'
import { addSource, editSourceDetails, prepareSource, replaceSourceContent } from '../core/sources'
import type { SourceInput } from '../core/source-data'
import type { DocumentWrite } from '../desktop/repository'
import type { LibraryContext } from './library-context'
export function createFilesCommands(context: LibraryContext) {
  return {
    async readRetiredNote(id: string) {
      await context.savingDone
      if (!context.ready.value || !('retiredNote' in context.repository))
        throw new LocalizedError(msg('本地数据库尚未准备好。'))
      return context.repository.retiredNote(id)
    },
    async acceptExternalNote(
      id: string,
      input: NoteInput,
      document: DocumentWrite,
      scanHash?: string,
    ) {
      const target = context.repository
      const media =
        scanHash && document.raw && 'externalMedia' in target
          ? await target.externalMedia(document.raw, document.path)
          : { inlineMedia: input.inlineMedia, assets: [], assetObservations: [] }
      if (target !== context.repository)
        throw new LocalizedError(msg('材料已变化，请重新打开后继续阅读。'))
      return context.commit(
        async (current) => {
          if (!('retiredNote' in context.repository)) return saveNote(current, input, id)
          const retired = await context.repository.retiredNote(id)
          return noteLifecycle(
            { ...current, media: [...current.media, ...media.assets.map((asset) => asset.meta)] },
            { ...input, inlineMedia: media.inlineMedia },
            id,
            retired,
            true,
          ).library
        },
        {
          externalDocuments: [document],
          scanHash,
          reason: '接受外部修改前',
          undoLabel: '编辑卡片',
          assets: media.assets,
          assetObservations: media.assetObservations,
        },
      )
    },
    async acceptExternalSource(
      id: string,
      input: SourceInput,
      document: DocumentWrite,
      scanHash: string,
    ) {
      const target = context.repository
      const media =
        document.raw && 'externalMedia' in target
          ? await target.externalMedia(document.raw, document.path)
          : { inlineMedia: [], assets: [], assetObservations: [] }
      if (target !== context.repository)
        throw new LocalizedError(msg('材料已变化，请重新打开后继续阅读。'))
      const previous = context.library.value.sources.find((source) => source.id === id)
      const oldText = previous ? await context.getSource(id) : undefined
      const prepared =
        previous &&
        (oldText !== input.content.replace(/\r\n?/g, '\n') ||
          previous.format !== input.format ||
          JSON.stringify(previous.inlineMedia ?? []) !== JSON.stringify(media.inlineMedia))
          ? replaceSourceContent(context.library.value, id, input)
          : undefined
      const added = !previous ? prepareSource(input) : undefined
      if (added) added.source.id = id
      if (prepared) prepared.source.inlineMedia = media.inlineMedia
      if (added) added.source.inlineMedia = media.inlineMedia
      const assets = [
        ...(prepared ? [prepared.asset] : added ? [added.asset] : []),
        ...media.assets,
      ]
      return context.commit(
        (current) => {
          if (previous && current.sources.find((source) => source.id === id) !== previous)
            throw new LocalizedError(msg('材料已变化，请重新打开后继续阅读。'))
          if (prepared)
            return {
              ...current,
              sources: current.sources.map((source) =>
                source.id === id ? prepared.source : source,
              ),
              media: [...current.media, ...assets.map((asset) => asset.meta)],
            }
          if (added)
            return addSource(
              { ...current, media: [...current.media, ...media.assets.map((asset) => asset.meta)] },
              added.source,
              added.asset,
            )
          const next = editSourceDetails(
            current,
            id,
            previous!.mediaId,
            { title: previous!.title, url: previous!.url },
            input,
          )
          return {
            ...next,
            sources: next.sources.map((source) =>
              source.id === id ? { ...source, acceptedAt: new Date().toISOString() } : source,
            ),
          }
        },
        {
          assets,
          externalDocuments: [document],
          scanHash,
          reason: '接受外部修改前',
          undoLabel: '编辑材料',
          assetObservations: media.assetObservations,
        },
      )
    },
    removeExternalNote(id: string, document: DocumentWrite, scanHash: string) {
      return context.commit((current) => removeNotes(current, new Set([id])), {
        externalDocuments: [document],
        scanHash,
        reason: '移除外部笔记前',
        undoLabel: '删除笔记',
      })
    },
  }
}
