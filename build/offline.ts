import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

export function offlinePlugin(): Plugin {
  let base = '/'
  return {
    name: 'repeaty-offline-shell',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      base = config.base
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const template = readFileSync(
          fileURLToPath(new URL('./service-worker.js', import.meta.url)),
          'utf8',
        )
        const publicFiles = [
          'favicon.svg',
          'icon-192.png',
          'icon-512.png',
          'manifest.webmanifest',
          'manifest.en.webmanifest',
          'example.csv',
          'example.en.csv',
          'licenses/nuxt-ui.txt',
          'licenses/branched-menu.txt',
          'skills/repeaty-cards/SKILL.md',
          'skills/repeaty-cards/example.csv',
        ]
        const assets = [
          ...new Set([
            ...Object.keys(bundle).filter(
              (name) => !name.endsWith('.map') && !name.startsWith('.vite/'),
            ),
            ...publicFiles,
          ]),
        ]
        const hash = createHash('sha256').update(template).update(base)
        for (const output of Object.values(bundle))
          hash.update(output.type === 'chunk' ? output.code : output.source)
        for (const name of publicFiles)
          hash.update(readFileSync(fileURLToPath(new URL(`../public/${name}`, import.meta.url))))
        const source = template
          .replace('__PRECACHE_FILES__', JSON.stringify(assets))
          .replace('__CACHE_VERSION__', JSON.stringify(hash.digest('hex').slice(0, 16)))
        this.emitFile({ type: 'asset', fileName: 'sw.js', source })
      },
    },
  }
}
