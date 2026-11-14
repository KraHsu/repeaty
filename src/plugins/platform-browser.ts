import { openDB } from 'idb'
export async function currentPluginWorkspace(): Promise<{ id: string }> {
  throw new Error('此插件能力需要桌面客户端。')
}
export async function callPluginHost(
  _id: string,
  _operation: string,
  _payload?: unknown,
  _scope?: string,
): Promise<unknown> {
  throw new Error('此插件能力需要桌面客户端。')
}
async function database() {
  return openDB('repeaty-external-plugin-data', 1, {
    upgrade(db) {
      db.createObjectStore('values')
    },
  })
}
export async function readPluginData(plugin: string, id: string, scope: string): Promise<unknown> {
  const db = await database()
  try {
    return await db.get('values', JSON.stringify([scope, plugin, id]))
  } finally {
    db.close()
  }
}
export async function writePluginData(
  plugin: string,
  id: string,
  value: unknown,
  scope: string,
): Promise<void> {
  const db = await database()
  try {
    const key = JSON.stringify([scope, plugin, id])
    if (value === undefined) await db.delete('values', key)
    else await db.put('values', value, key)
  } finally {
    db.close()
  }
}
