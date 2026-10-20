import { Channel, invoke } from '@tauri-apps/api/core'
import { ref, shallowRef, watch } from 'vue'
import { remoteWorkspace } from '../edition'
import {
  LearningQueryError,
  type LearningQuery,
  type LearningReader,
} from '../core/learning-reader'

type Status = { enabled: boolean; available: boolean; url: string | null }
type BridgeRequest = { id: string; scope: string; query: LearningQuery }
export const mcpStatus = shallowRef<Status>({ enabled: false, available: false, url: null })
export const mcpBridgeError = ref('')
let statusSequence = 0

export async function refreshMcpStatus() {
  const sequence = ++statusSequence
  const status = await invoke<Status>('mcp_status')
  if (sequence === statusSequence) mcpStatus.value = status
  return status
}
export async function startMcp() {
  await invoke('mcp_start')
  return refreshMcpStatus()
}
export async function stopMcp() {
  await invoke('mcp_stop')
  return refreshMcpStatus()
}
export const mcpConfiguration = async () =>
  JSON.stringify(await invoke<unknown>('mcp_configuration'), null, 2)

export async function connectLearningReader(reader: LearningReader): Promise<() => void> {
  const onRequest = new Channel<BridgeRequest>()
  let alive = true,
    sequence = 0,
    scopeEpoch = 0,
    lastScope = ''
  onRequest.onmessage = (request) => {
    let reply: unknown
    try {
      if (!alive || remoteWorkspace.value) throw new LearningQueryError('library-unavailable')
      reply = { status: 'ok', data: reader.readLearning(request.query, request.scope) }
    } catch (error) {
      reply = {
        status: 'error',
        code: error instanceof LearningQueryError ? error.code : 'library-unavailable',
      }
    }
    void invoke('mcp_reply', { id: request.id, scope: request.scope, reply }).catch(() => {
      // Cancellation, expiry and scope changes invalidate an outstanding reply.
    })
  }
  try {
    const attachment = await invoke<string>('mcp_attach', { onRequest })
    function update() {
      const scope = reader.scope.value
      if (scope !== lastScope) {
        scopeEpoch++
        lastScope = scope
      }
      return invoke('mcp_workspace', {
        attachment,
        workspace: {
          scope,
          scopeEpoch,
          sequence: ++sequence,
          available: reader.ready.value && !reader.busy.value && !remoteWorkspace.value,
        },
      })
    }
    const stop = watch(
      [
        () => reader.scope.value,
        () => reader.ready.value,
        () => reader.busy.value,
        remoteWorkspace,
      ],
      () => {
        void update()
          .then(refreshMcpStatus)
          .catch(() => {
            mcpBridgeError.value = 'MCP 连接不可用，请重新打开应用。'
          })
      },
      { immediate: true, flush: 'sync' },
    )
    return () => {
      alive = false
      stop()
      void invoke('mcp_workspace', {
        attachment,
        workspace: { scope: '', scopeEpoch: ++scopeEpoch, sequence: ++sequence, available: false },
      }).catch(() => {})
    }
  } catch {
    mcpBridgeError.value = 'MCP 连接不可用，请重新打开应用。'
    return () => {
      alive = false
    }
  }
}
