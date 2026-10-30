import { createPluginResources } from '../../../src/plugins/resources'
import type { resources as ResourceApi } from '@repeaty/plugin-api'

export let resources: typeof ResourceApi
let lifetime = new AbortController()
export async function initialize() {
  lifetime.abort()
  lifetime = new AbortController()
  const entries = await Promise.all(
    ['optimizer.worker.mjs', 'optimizer.wasm'].map(async (path) => {
      const blob = await (await fetch(`/assets/${path}`)).blob()
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1]!)
        reader.readAsDataURL(blob)
      })
      return [
        path,
        { type: path.endsWith('wasm') ? 'application/wasm' : 'text/javascript', base64 },
      ]
    }),
  )
  resources = createPluginResources(Object.fromEntries(entries), lifetime.signal, () =>
    lifetime.signal.throwIfAborted(),
  )
}
export function unload() {
  lifetime.abort()
}
