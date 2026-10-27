import type { Page } from '@playwright/test'
export async function storedLibrary(page: Page) {
  return page.evaluate(async () => {
    const native = (
      window as unknown as {
        __TAURI_INTERNALS__?: {
          invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
        }
      }
    ).__TAURI_INTERNALS__
    if (native) {
      const { active } = (await native.invoke('workspace_status')) as { active: { token: string } }
      for (let snapshot = 0; snapshot < 5; snapshot++) {
        const { library, revision } = (await native.invoke('workspace_read', {
          token: active.token,
          request: { type: 'load' },
        })) as { library: Record<string, { id: string }[]>; revision: number }
        try {
          if (library.attempts?.length) {
            const attempts: { id: string }[] = []
            while (attempts.length < library.attempts.length) {
              const value = (await native.invoke('workspace_read', {
                token: active.token,
                request: {
                  type: 'attempts',
                  input: { mode: 'batch', offset: attempts.length, revision },
                },
              })) as { attempts: { id: string }[] }
              if (!value.attempts.length) throw Error('Missing native attempt batch')
              attempts.push(...value.attempts)
            }
            library.attempts = attempts
          }
          return Object.fromEntries(
            Object.entries(library)
              .filter(([, values]) => Array.isArray(values))
              .map(([store, values]) => [
                store,
                values.map((value, position) => ({ id: value.id, position, value })),
              ]),
          )
        } catch (error) {
          // A pending UI save may invalidate the read-only snapshot between batches.
          if (!String(error).includes('revision-conflict') || snapshot === 4) throw error
        }
      }
      throw Error('Could not read a stable native snapshot')
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('repeaty')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    try {
      const result: Record<string, unknown> = {}
      for (const key of [
        'decks',
        'notes',
        'cards',
        'reviews',
        'media',
        'savedSearches',
        'practices',
        'attempts',
        'sources',
      ]) {
        result[key] = await new Promise((resolve, reject) => {
          const r = db.transaction(key).objectStore(key).getAll()
          r.onsuccess = () => resolve(r.result)
          r.onerror = () => reject(r.error)
        })
      }
      return result
    } finally {
      db.close()
    }
  })
}
