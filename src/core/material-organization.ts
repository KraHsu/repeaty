import type { Library } from './model'
import { validateSourceHierarchy } from './source-tree'
import {
  materialFolderSchema,
  validateMaterialFolders,
  type MaterialMove,
} from './material-organization-data'

const fail = (message: string): never => {
  throw new Error(message)
}
export function addMaterialFolder(library: Library, name: string, parentId?: string): Library {
  const folder = materialFolderSchema.parse({
    id: crypto.randomUUID(),
    name,
    parentId,
    order: library.materialFolders.filter((entry) => entry.parentId === parentId).length,
    createdAt: new Date().toISOString(),
  })
  const next = { ...library, materialFolders: [...library.materialFolders, folder] }
  validateMaterialFolders(next.materialFolders, next.sources, fail)
  return next
}
export function renameMaterialFolder(library: Library, id: string, name: string): Library {
  const current = library.materialFolders.find((entry) => entry.id === id)
  if (!current) return fail('材料文件夹已不存在。')
  const folder = materialFolderSchema.parse({ ...current, name })
  return {
    ...library,
    materialFolders: library.materialFolders.map((entry) => (entry.id === id ? folder : entry)),
  }
}
/** Removing a folder unwraps its children; learning content and provenance stay intact. */
export function removeMaterialFolder(library: Library, id: string): Library {
  const folder = library.materialFolders.find((entry) => entry.id === id)
  if (!folder) return fail('材料文件夹已不存在。')
  return {
    ...library,
    materialFolders: library.materialFolders
      .filter((entry) => entry.id !== id)
      .map((entry) => (entry.parentId === id ? { ...entry, parentId: folder.parentId } : entry)),
    sources: library.sources.map((source) =>
      source.folderId === id ? { ...source, folderId: folder.parentId } : source,
    ),
  }
}
export function moveMaterial(library: Library, move: MaterialMove): Library {
  const { folderId, parentSourceId } = move.destination
  if (folderId && parentSourceId) return fail('材料所属文件夹无效。')
  if (move.kind === 'folder') {
    if (parentSourceId || !library.materialFolders.some((entry) => entry.id === move.id))
      return fail('材料文件夹的层级无效。')
    const siblings = library.materialFolders
      .filter((entry) => entry.id !== move.id && entry.parentId === folderId)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    const at = move.beforeId
      ? siblings.findIndex((entry) => entry.id === move.beforeId)
      : siblings.length
    if (at < 0) return fail('材料位置已变化，请重新选择。')
    const ordered = siblings.map((entry) => entry.id)
    ordered.splice(at, 0, move.id)
    const next = {
      ...library,
      materialFolders: library.materialFolders.map((entry) =>
        ordered.includes(entry.id)
          ? { ...entry, parentId: folderId, order: ordered.indexOf(entry.id) }
          : entry,
      ),
    }
    validateMaterialFolders(next.materialFolders, next.sources, fail)
    return next
  }
  const source = library.sources.find((entry) => entry.id === move.id)
  if (!source) return fail('材料已不存在。')
  const siblings = library.sources
    .filter(
      (entry) =>
        entry.id !== move.id &&
        entry.folderId === folderId &&
        entry.parentSourceId === parentSourceId,
    )
    .sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )
  const at = move.beforeId
    ? siblings.findIndex((entry) => entry.id === move.beforeId)
    : siblings.length
  if (at < 0) return fail('材料位置已变化，请重新选择。')
  const ordered = siblings.map((entry) => entry.id)
  ordered.splice(at, 0, move.id)
  const next = {
    ...library,
    sources: library.sources.map((entry) =>
      ordered.includes(entry.id)
        ? { ...entry, folderId, parentSourceId, order: ordered.indexOf(entry.id) }
        : entry,
    ),
  }
  validateMaterialFolders(next.materialFolders, next.sources, fail)
  validateSourceHierarchy(next.sources, fail)
  return next
}
