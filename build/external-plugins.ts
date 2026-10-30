import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** Copies independently built packages; never compiles plugin source into the application. */
export function externalPlugins(desktop: boolean): Plugin {
  function resources() {
    const ids = desktop
      ? [
          'review-history',
          'leetcode',
          'review-heatmap',
          'format-cleanup',
          'pdf-reader',
          'document-reader',
          'visual-occlusion',
          'obsidian',
          'readwise',
          'fsrs-optimizer',
          'study-statistics',
          'assistant',
        ]
      : [
          'review-history',
          'review-heatmap',
          'format-cleanup',
          'pdf-reader',
          'document-reader',
          'visual-occlusion',
          'obsidian',
          'readwise',
          'fsrs-optimizer',
          'study-statistics',
        ]
    const files = new Map<string, string>()
    const catalog = ids.map((id) => {
      const bundle = JSON.parse(
        readFileSync(
          fileURLToPath(new URL(`../plugins/packages/${id}.repeaty-plugin`, import.meta.url)),
          'utf8',
        ),
      )
      const path = `plugins/${id}.repeaty-plugin`
      files.set(path, JSON.stringify(bundle))
      return {
        ...bundle.manifest,
        path,
        installByDefault: ['review-history', 'leetcode'].includes(id),
      }
    })
    files.set('plugins/catalog.json', JSON.stringify(catalog))
    return files
  }
  return {
    name: 'repeaty-external-plugin-packages',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0]!
        const path = pathname.startsWith(server.config.base)
          ? pathname.slice(server.config.base.length)
          : pathname.replace(/^\//, '')
        if (!path.startsWith('plugins/')) return next()
        try {
          const source = resources().get(path)
          if (source === undefined) return next()
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(source)
        } catch (error) {
          next(error)
        }
      })
    },
    generateBundle() {
      for (const [fileName, source] of resources())
        this.emitFile({ type: 'asset', fileName, source })
    },
  }
}
