import { Channel, invoke } from '@tauri-apps/api/core'
import { ref, shallowRef, watch } from 'vue'
import { remoteWorkspace } from '../edition'
import {
  LearningQueryError,
  type LearningQuery,
  type LearningReader,
} from '../core/learning-reader'
import { draftSession } from './drafts'

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
  draftSession.revoke()
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
  onRequest.onmessage = async (request) => {
    let reply: unknown
    let proposal: ReturnType<typeof draftSession.prepare> | undefined
    try {
      if (!alive || remoteWorkspace.value) throw new LearningQueryError('library-unavailable')
      let data: unknown
      if (request.query.tool === 'repeaty_selected_excerpt') {
        data = draftSession.readSelection(
          reader.localLearningSnapshot(request.scope),
          request.query.arguments,
        )
      } else if (request.query.tool === 'repeaty_propose_cards') {
        proposal = draftSession.prepare(
          reader.localLearningSnapshot(request.scope),
          request.query.arguments,
        )
        data = proposal.receipt
      } else data = reader.readLearning(request.query, request.scope)
      reply = { status: 'ok', data }
    } catch (error) {
      reply = {
        status: 'error',
        code: error instanceof LearningQueryError ? error.code : 'library-unavailable',
      }
    }
    try {
      await invoke('mcp_reply', { id: request.id, scope: request.scope, reply })
      proposal?.finish(true)
    } catch {
      // Cancelled, expired and revoked calls must not display unacknowledged drafts.
      proposal?.finish(false)
    }
  }
  try {
    const attachment = await invoke<string>('mcp_attach', { onRequest })
    function update() {
      const scope = reader.scope.value
      draftSession.bindScope(remoteWorkspace.value ? '' : scope)
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
      draftSession.bindScope('')
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
watch(
  () => mcpStatus.value.enabled,
  (enabled) => {
    if (!enabled) draftSession.revoke()
  },
)
