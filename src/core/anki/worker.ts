import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { LocalizedError, msg, type Message } from '../../i18n'
import { parseAnkiPackage } from './package'
import type { AnkiPackage } from './types'

export type AnkiWorkerReply =
  | { type: 'progress'; percent: number }
  | { type: 'complete'; data: AnkiPackage }
  | { type: 'error'; error: Message }
const context = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ file: File }>) => Promise<void>
  postMessage: (message: AnkiWorkerReply) => void
}
context.onmessage = async ({ data: { file } }) => {
  try {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl })
    const data = await parseAnkiPackage(file, SQL, (percent) =>
      context.postMessage({ type: 'progress', percent }),
    )
    context.postMessage({ type: 'complete', data })
  } catch (error) {
    context.postMessage({
      type: 'error',
      error:
        error instanceof LocalizedError
          ? error.detail
          : msg('Anki 文件损坏、格式不受支持或超过导入限制。'),
    })
  }
}
