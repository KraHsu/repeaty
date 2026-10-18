import type { Library, MediaUpload } from './model'
import type { Snapshot } from './storage'

interface Repository {
  load(): Promise<Snapshot>
  save(library: Library, revision: number, options: { assets: MediaUpload[] }): Promise<Snapshot>
}

/** Revision zero identifies a pristine workspace, including on the Rust service. */
export async function initializeWorkspace(repository: Repository): Promise<Snapshot> {
  const saved = await repository.load()
  if (
    saved.revision !== 0 ||
    Object.values(saved.library).some((value) => Array.isArray(value) && value.length)
  )
    return saved
  const { createStarterDeck } = await import('./sample')
  const starter = createStarterDeck()
  try {
    return await repository.save(starter.library, 0, { assets: starter.assets })
  } catch (error) {
    // Another first-time tab may have committed while this tab prepared its deck.
    const latest = await repository.load()
    if (latest.revision > 0) return latest
    throw error
  }
}
