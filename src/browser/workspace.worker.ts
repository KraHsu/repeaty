import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { BrowserWorkspaceReader } from './workspace-reader'
import { workspaceReadCode, WorkspaceReadError, type WorkspaceReadCode } from './errors'
import type { WorkspaceSelection } from './workspace-files'

export type WorkspaceRequest =
  | { type: 'open'; selection: WorkspaceSelection }
  | { type: 'media'; id: string }
  | { type: 'attempts'; ids: string[] }
export type WorkspaceReply =
  | { id: number; type: 'progress'; percent: number }
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; code: WorkspaceReadCode }
const context = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ id: number; request: WorkspaceRequest }>) => Promise<void>
  postMessage: (reply: WorkspaceReply) => void
}
let reader: BrowserWorkspaceReader | undefined
context.onmessage = async ({ data: { id, request } }) => {
  try {
    let value: unknown
    if (request.type === 'open') {
      if (reader) throw new WorkspaceReadError('invalid')
      const SQL = await initSqlJs({ locateFile: () => wasmUrl })
      reader = await BrowserWorkspaceReader.open(SQL, request.selection, (percent) =>
        context.postMessage({ id, type: 'progress', percent }),
      )
      value = reader.snapshot
    } else {
      if (!reader) throw new WorkspaceReadError('closed')
      value =
        request.type === 'media' ? await reader.media(request.id) : reader.attempts(request.ids)
    }
    context.postMessage({ id, type: 'result', value })
  } catch (error) {
    context.postMessage({ id, type: 'error', code: workspaceReadCode(error) })
  }
}
