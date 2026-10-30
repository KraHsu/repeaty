import { Channel, invoke } from '@tauri-apps/api/core'
import { ref, shallowRef, watch } from 'vue'
import { remoteWorkspace } from '../edition'
import { LearningQueryError, type LearningQuery } from '../core/learning-reader'
import { draftSession, bindDraftScope, receiveDrafts, type DraftWorkspace } from './drafts'
import type {
  AutomationApi,
  AutomationGrant,
  AutomationQuery,
  AutomationRequest,
  AutomationApply,
} from '@repeaty/plugin-api'

type Status = { enabled: boolean; available: boolean; url: string | null }
type AutomationTool =
  | 'repeaty_automation_status'
  | 'repeaty_query_library'
  | 'repeaty_preview_changes'
  | 'repeaty_apply_changes'
  | 'repeaty_operation_status'
type BridgeRequest = {
  id: string
  scope: string
  query: LearningQuery | { tool: AutomationTool; arguments: unknown }
}
export const mcpStatus = shallowRef<Status>({ enabled: false, available: false, url: null })
export const mcpBridgeError = ref('')
export const automationGrant = shallowRef<AutomationGrant>()
let connectedScope = ''
export function setAutomationAccess(readEnabled: boolean, writeEnabled = false) {
  automationGrant.value =
    readEnabled && connectedScope
      ? {
          id: crypto.randomUUID(),
          libraryScope: connectedScope,
          scope: { kind: 'all' },
          write: writeEnabled,
        }
      : undefined
}
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
  automationGrant.value = undefined
  await invoke('mcp_stop')
  return refreshMcpStatus()
}
export type McpClient = 'codex' | 'claude-code' | 'claude-desktop' | 'http'
export const mcpClientConfiguration = (client: McpClient) =>
  invoke<string>('mcp_client_configuration', { client })
export const mcpConfiguration = async () =>
  JSON.stringify(await invoke<unknown>('mcp_configuration'), null, 2)

export async function connectLearningReader(reader: DraftWorkspace): Promise<() => void> {
  const onRequest = new Channel<BridgeRequest>()
  let alive = true,
    sequence = 0,
    scopeEpoch = 0,
    lastScope = ''
  let automation: AutomationApi | undefined
  let controller = new AbortController()
  function automationApi(scope: string) {
    if (!reader.ready.value || !scope || scope !== reader.scope.value)
      throw new Error('library-unavailable')
    return (automation ??= reader.automationApi(
      {
        actorId: 'external:local',
        label: 'CLI / MCP',
        scope,
        signal: controller.signal,
        assertCurrent() {
          if (!alive || scope !== reader.scope.value || remoteWorkspace.value)
            throw new Error('library-changed')
        },
      },
      { authorize: async () => false, grant: () => automationGrant.value },
    ))
  }
  onRequest.onmessage = async (request) => {
    let reply: unknown
    try {
      if (!alive || remoteWorkspace.value) throw new LearningQueryError('library-unavailable')
      let data: unknown
      if (request.query.tool === 'repeaty_automation_status') {
        data = automationApi(request.scope).capabilities()
      } else if (request.query.tool === 'repeaty_query_library') {
        data = await automationApi(request.scope).query(request.query.arguments as AutomationQuery)
      } else if (request.query.tool === 'repeaty_preview_changes') {
        data = await automationApi(request.scope).preview(
          request.query.arguments as AutomationRequest,
        )
      } else if (request.query.tool === 'repeaty_apply_changes') {
        data = await automationApi(request.scope).apply(request.query.arguments as AutomationApply)
      } else if (request.query.tool === 'repeaty_operation_status') {
        const input = request.query.arguments as { operationId?: unknown }
        if (
          !input ||
          typeof input.operationId !== 'string' ||
          !/^[a-zA-Z0-9._-]{1,100}$/.test(input.operationId)
        )
          throw new Error('invalid-arguments')
        const result = await automationApi(request.scope).operationStatus(input.operationId)
        data = result ? { found: true, receipt: result } : { found: false }
      } else if (request.query.tool === 'repeaty_selected_excerpt') {
        data = draftSession.readSelection(
          reader.localLearningSnapshot(request.scope),
          request.query.arguments,
        )
      } else if (request.query.tool === 'repeaty_propose_cards') {
        data = await receiveDrafts(reader, request.scope, request.query.arguments)
      } else data = reader.readLearning(request.query as LearningQuery, request.scope)
      reply = { status: 'ok', data }
    } catch (error) {
      reply = {
        status: 'error',
        code:
          error instanceof LearningQueryError
            ? error.code
            : request.query.tool.startsWith('repeaty_') &&
                [
                  'repeaty_automation_status',
                  'repeaty_query_library',
                  'repeaty_preview_changes',
                  'repeaty_apply_changes',
                  'repeaty_operation_status',
                ].includes(request.query.tool)
              ? error instanceof Error &&
                [
                  'invalid-arguments',
                  'library-changed',
                  'library-unavailable',
                  'permission-denied',
                  'not-found',
                  'request-conflict',
                  'cancelled',
                  'missing-media',
                  'preview-limit',
                  'preview-required',
                  'receipt-limit',
                  'unsupported-operation',
                ].includes(error.message)
                ? error.message
                : 'operation-failed'
              : 'library-unavailable',
      }
    }
    try {
      await invoke('mcp_reply', { id: request.id, scope: request.scope, reply })
    } catch {
      // A persisted batch remains available for review when its reply is lost.
      // Its request ID makes retries safe while this selection is still shared.
    }
  }
  try {
    const attachment = await invoke<string>('mcp_attach', { onRequest })
    function update() {
      const scope = reader.scope.value
      bindDraftScope(reader, remoteWorkspace.value ? '' : scope)
      if (scope !== lastScope) {
        lastScope = scope
        controller.abort()
        controller = new AbortController()
        automation = undefined
        automationGrant.value = undefined
        scopeEpoch++
      }
      connectedScope = scope
      return invoke('mcp_workspace', {
        attachment,
        workspace: {
          scope,
          scopeEpoch,
          sequence: ++sequence,
          available: reader.ready.value && !reader.busy.value && !remoteWorkspace.value,
          ready: reader.ready.value && !remoteWorkspace.value,
          automation: {
            readEnabled: !!automationGrant.value,
            writeEnabled: !!automationGrant.value?.write,
          },
        },
      })
    }
    const stop = watch(
      [
        () => reader.scope.value,
        () => reader.ready.value,
        () => reader.busy.value,
        remoteWorkspace,
        automationGrant,
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
      controller.abort()
      automationGrant.value = undefined
      connectedScope = ''
      stop()
      bindDraftScope(reader, '')
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
