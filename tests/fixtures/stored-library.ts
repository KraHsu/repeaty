import type { Page } from '@playwright/test'
export async function storedLibrary(page: Page) {
  return page.evaluate(async () => {
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
