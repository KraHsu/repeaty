import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { desktopEdition } from '../src/edition'
import { bundleSchema } from '../src/plugins/package'
import { initializePlugins, usePluginStorage, type PackageEntry } from '../src/plugins/manager'
import { setPluginModuleImporter } from '../src/plugins/sdk'
const ids = desktopEdition ? ['review-history', 'leetcode'] : ['review-history']
const packages = new Map<string, PackageEntry>()
for (const id of ids) {
  const bundle = bundleSchema.parse(
    JSON.parse(await readFile(resolve(`plugins/packages/${id}.repeaty-plugin`), 'utf8')),
  )
  packages.set(id, { id, bundle, trusted: true })
}
usePluginStorage({
  async scope() {
    return 'local:repeaty'
  },
  async list() {
    return [...packages.values()]
  },
  async save(bundle) {
    packages.set(bundle.manifest.id, { id: bundle.manifest.id, bundle, trusted: true })
  },
  async remove(id) {
    packages.delete(id)
  },
})
setPluginModuleImporter(
  async (code) =>
    await import(
      /* @vite-ignore */
      `data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${crypto.randomUUID()}`
    ),
)
await initializePlugins('local:repeaty')
