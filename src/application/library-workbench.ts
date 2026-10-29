import type { LibraryContext } from './library-context'
import {
  editSourceContent,
  upsertSourceAnnotation,
  removeSourceAnnotation,
  sourceChanged,
  sourceDraftSchema,
  type SourceDraft,
  type SourceContentUpdate,
  type SourceAnnotationUpdate,
} from '../core/source-workbench'
import { sourceSchema } from '../core/source-data'

export function createWorkbenchCommands(context: LibraryContext) {
  function session(scope: string) {
    const repository = context.repository
    const check = () => {
      if (
        !context.ready.value ||
        !scope ||
        scope !== context.scope.value ||
        repository !== context.repository
      )
        throw sourceChanged()
    }
    check()
    return { repository, check }
  }
  async function prepareSourceProperties(sourceId: string, mediaId: string, scope: string) {
    const { repository, check } = session(scope)
    await context.savingDone
    check()
    let source = context.library.value.sources.find((item) => item.id === sourceId)
    if (!source || source.mediaId !== mediaId) throw sourceChanged()
    // Capture pre-existing custom YAML before the first edit so undo restores it too.
    if (source.properties === undefined && 'readSourceProperties' in repository) {
      const properties = await repository.readSourceProperties(sourceId)
      check()
      await context.commit(
        (library) => {
          const current = library.sources.find((item) => item.id === sourceId)
          if (!current || current.mediaId !== mediaId) throw sourceChanged()
          if (current.properties !== undefined) return library
          return {
            ...library,
            sources: library.sources.map((item) =>
              item.id === sourceId ? sourceSchema.parse({ ...item, properties }) : item,
            ),
          }
        },
        { undoLabel: false },
      )
      check()
      source = context.library.value.sources.find((item) => item.id === sourceId)!
    }
    return source.properties ?? ''
  }
  return {
    prepareSourceProperties,
    async readSourceProperties(sourceId: string, scope: string) {
      const { repository, check } = session(scope)
      const source = context.library.value.sources.find((item) => item.id === sourceId)
      if (!source) throw sourceChanged()
      const result =
        source.properties ??
        ('readSourceProperties' in repository
          ? await repository.readSourceProperties(sourceId)
          : '')
      check()
      return result
    },
    async prepareSourceEditor(sourceId: string, mediaId: string, scope: string) {
      const { repository, check } = session(scope)
      const properties = await prepareSourceProperties(sourceId, mediaId, scope)
      const draft =
        'readSourceDraft' in repository ? await repository.readSourceDraft(sourceId) : undefined
      check()
      return { properties, draft: draft ? { ...draft, scope } : undefined }
    },
    async writeSourceDraft(input: SourceDraft) {
      const draft = sourceDraftSchema.parse(input)
      const { repository, check } = session(draft.scope)
      if (!('writeSourceDraft' in repository)) throw new Error('当前学习库不支持材料草稿。')
      await repository.writeSourceDraft(draft)
      check()
    },
    async discardSourceDraft(sourceId: string, id: string, scope: string) {
      const { repository, check } = session(scope)
      if ('discardSourceDraft' in repository) await repository.discardSourceDraft(sourceId, id)
      check()
    },
    async editSourceContent(update: SourceContentUpdate) {
      const { check } = session(update.scope)
      await context.savingDone
      check()
      const before = context.library.value
      const prepared = editSourceContent(before, update)
      await context.commit(
        (library) => {
          check()
          if (
            library !== before ||
            library.sources.find((source) => source.id === update.sourceId)?.mediaId !==
              update.mediaId
          )
            throw sourceChanged()
          return prepared.library
        },
        {
          assets: [prepared.asset],
          consumeSourceDraft: update.draftId,
          reason: '编辑材料正文前',
          undoLabel: '编辑材料正文',
        },
      )
    },
    async upsertSourceAnnotation(update: SourceAnnotationUpdate) {
      const { check } = session(update.scope)
      const text = await context.getSource(update.sourceId, undefined, update.mediaId)
      check()
      await context.commit((library) => upsertSourceAnnotation(library, update, text), {
        undoLabel: '编辑批注',
      })
    },
    async removeSourceAnnotation(sourceId: string, id: string, scope: string) {
      const { check } = session(scope)
      await context.commit(
        (library) => {
          check()
          return removeSourceAnnotation(library, sourceId, id)
        },
        { undoLabel: '删除批注' },
      )
    },
  }
}
