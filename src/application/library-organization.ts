import type { LibraryContext } from './library-context'
import type { MaterialMove } from '../core/material-organization-data'
import {
  addMaterialFolder,
  renameMaterialFolder,
  removeMaterialFolder,
  moveMaterial,
} from '../core/material-organization'

export function createOrganizationCommands(context: LibraryContext) {
  async function apply(scope: string, transform: Parameters<LibraryContext['commit']>[0]) {
    const repository = context.repository
    await context.savingDone
    if (!context.ready.value || scope !== context.scope.value || repository !== context.repository)
      throw new Error('学习库已变化，请重新操作。')
    await context.commit(transform, { reason: '整理材料前', undoLabel: '整理材料' })
  }
  return {
    createMaterialFolder: (scope: string, name: string, parentId?: string) =>
      apply(scope, (library) => addMaterialFolder(library, name, parentId)),
    renameMaterialFolder: (scope: string, id: string, name: string) =>
      apply(scope, (library) => renameMaterialFolder(library, id, name)),
    removeMaterialFolder: (scope: string, id: string) =>
      apply(scope, (library) => removeMaterialFolder(library, id)),
    moveMaterial: (scope: string, move: MaterialMove) =>
      apply(scope, (library) => moveMaterial(library, move)),
  }
}
