import { prepareAssets } from './assets'
self.onmessage = (event: MessageEvent) => {
  try {
    self.postMessage({ assets: prepareAssets(event.data.files) })
  } catch {
    self.postMessage({ error: 'cloudflare-assets-invalid' })
  }
}
