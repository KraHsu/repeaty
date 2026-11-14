import { z } from 'zod'

export const materialFolderSchema = z.object({
  studyPriority: z.number().int().min(0).max(9).optional(),
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  parentId: z.string().min(1).max(100).optional(),
  order: z.number().int().min(0).max(1_000_000),
  createdAt: z.iso.datetime(),
})
export type MaterialFolder = z.infer<typeof materialFolderSchema>
export interface MaterialDestination {
  folderId?: string
  parentSourceId?: string
}
export interface MaterialMove {
  kind: 'folder' | 'source'
  id: string
  destination: MaterialDestination
  beforeId?: string
}

export function validateMaterialFolders(
  folders: MaterialFolder[],
  sources: { id: string; folderId?: string; parentSourceId?: string }[],
  problem: (message: string) => void,
) {
  const entries = new Map(folders.map((folder) => [folder.id, folder]))
  for (const folder of folders) {
    const seen = new Set([folder.id])
    let parent = folder.parentId
    while (parent) {
      if (seen.has(parent) || seen.size >= 32 || !entries.has(parent)) {
        problem('材料文件夹的层级无效。')
        break
      }
      seen.add(parent)
      parent = entries.get(parent)!.parentId
    }
  }
  for (const source of sources)
    if (
      (source.folderId && !entries.has(source.folderId)) ||
      (source.folderId && source.parentSourceId)
    )
      problem('材料所属文件夹无效。')
}
