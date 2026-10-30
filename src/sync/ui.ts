import type { InjectionKey, Ref } from 'vue'

export interface SyncUiState {
  available: boolean
  phase: 'idle' | 'busy' | 'error'
  enabled: boolean
  paused: boolean
  deviceId: string
  groupId: string | null
  address: string
  invite: string | null
  peers: Array<{ id: string; name: string; address: string }>
  requests: Array<{ id: string; name: string }>
  pending: number
  conflicts: Array<{
    id: string
    store: string
    recordId: string
    label?: string
    fields: string[]
    local: unknown
    remote: unknown
  }>
  preview: { changes: number; events: number } | null
  message: string | null
  error: string | null
  blockedReason: string | null
}

export type SyncAction =
  | {
      type:
        | 'refresh'
        | 'start'
        | 'pause'
        | 'resume'
        | 'invite'
        | 'exchange'
        | 'preview'
        | 'apply'
        | 'cancel'
        | 'diagnostics'
        | 'leave'
    }
  | { type: 'listen'; address: string }
  | { type: 'join'; invite: string }
  | { type: 'approve' | 'reject' | 'revoke'; id: string }
  | { type: 'resolve'; id: string; choice: 'local' | 'remote' }

export interface SyncUiController {
  state: Readonly<Ref<SyncUiState>>
  run(action: SyncAction): Promise<void>
}

export const syncUiKey: InjectionKey<SyncUiController> = Symbol('sync-ui')

/** Input feedback only. The native transport must independently enforce its address policy. */
export function isPrivateSyncAddress(input: string): boolean {
  const match = /^(\[[\da-f:]+\]|[\d.]+):(\d{1,5})$/i.exec(input)
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) return false
  const host = match[1]!
  if (host.startsWith('[')) {
    try {
      const canonical = new URL(`http://${input}`).hostname.slice(1, -1)
      return canonical === '::1' || /^(?:f[cd][\da-f]{2}|fe[89ab][\da-f]):/i.test(canonical)
    } catch {
      return false
    }
  }
  const octets = host.split('.')
  if (
    octets.length !== 4 ||
    octets.some((octet) => !/^(?:0|[1-9]\d{0,2})$/.test(octet) || Number(octet) > 255)
  )
    return false
  const [first, second] = octets.map(Number)
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  )
}
