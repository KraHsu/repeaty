import type { SyncChange, SyncClock } from './protocol'

/** One atomic materialization plus an optional causal conflict-resolution event. */
export interface SyncCommit {
  expectedClock: SyncClock
  clock: SyncClock
  appliedIds: string[]
  values: Record<string, Record<string, unknown | null>>
  resolutions: SyncChange[]
  retiredMedia: Record<string, unknown>
}
