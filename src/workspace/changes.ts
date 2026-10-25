import {
  readWorkspaceMarkdown,
  type Identity,
  type MarkdownResult,
  type WorkspaceDocument,
} from './markdown'

export interface VariantRecord {
  variant: string
  cardId: string
  lifecycle: 'active' | 'retired'
}
export interface VariantPlan {
  keep: VariantRecord[]
  restore: VariantRecord[]
  retire: VariantRecord[]
  create: string[]
}

/** Proposals only: retain original records by reference, never reschedule or assign IDs. */
export function planVariants(
  known: readonly VariantRecord[],
  desired: readonly string[],
): VariantPlan {
  if (
    new Set(known.map((card) => card.variant)).size !== known.length ||
    new Set(known.map((card) => card.cardId)).size !== known.length ||
    new Set(desired).size !== desired.length
  )
    throw new Error('duplicate-variant-mapping')
  const records = new Map(known.map((card) => [card.variant, card]))
  const wanted = new Set(desired)
  return {
    keep: known.filter((card) => wanted.has(card.variant) && card.lifecycle === 'active'),
    restore: known.filter((card) => wanted.has(card.variant) && card.lifecycle === 'retired'),
    retire: known.filter((card) => !wanted.has(card.variant) && card.lifecycle === 'active'),
    create: desired.filter((variant) => !records.has(variant)),
  }
}

export interface AcceptedFile {
  path: string
  document: WorkspaceDocument
  cards: readonly VariantRecord[]
}
export interface FileObservation {
  path: string
  raw?: string
  error?: string
  symbolicLink?: boolean
}
export type ChangeStatus =
  | 'unchanged'
  | 'modified'
  | 'renamed'
  | 'renamed-modified'
  | 'new'
  | 'unmanaged'
  | 'unregistered'
  | 'pending'
  | 'conflict'
  | 'missing'
export interface FileChange {
  path: string
  status: ChangeStatus
  identity?: Identity
  previousPath?: string
  reason?: string
  document?: WorkspaceDocument
  variants?: VariantPlan
}
export interface ScanOptions {
  // An event batch is never sufficient evidence of deletion.
  completeScan: boolean
  caseSensitive?: boolean
  // M0 parses syntax; actual deck/media/plugin/source availability is a separate gate.
  acceptanceIssues?: (document: WorkspaceDocument) => readonly string[]
}
const identityKey = (identity: Identity) => JSON.stringify([identity.kind, identity.id])

/** Logical root-relative paths only. Realpath/symlink containment remains the filesystem adapter's job. */
export function workspacePathKey(path: string, caseSensitive = true): string | undefined {
  if (
    !path ||
    /[\\\u0000-\u001f\u007f:]/.test(path) ||
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return undefined
  const normalized = path.normalize('NFC')
  return caseSensitive ? normalized : normalized.toLowerCase()
}

/** Classify a stable observed snapshot; never accepts, deletes, retires, or writes anything itself. */
export function classifyWorkspaceChanges(
  accepted: readonly AcceptedFile[],
  observations: readonly FileObservation[],
  options: ScanOptions,
): FileChange[] {
  const pathKey = (path: string) => workspacePathKey(path, options.caseSensitive)
  const byIdentity = new Map<string, AcceptedFile>()
  const byPath = new Map<string, AcceptedFile>()
  for (const file of accepted) {
    const path = pathKey(file.path)
    const id = identityKey(file.document.identity)
    if (!path || byPath.has(path) || byIdentity.has(id))
      throw new Error('invalid-accepted-manifest')
    byPath.set(path, file)
    byIdentity.set(id, file)
  }
  const reads = observations.map((file) => {
    const path = pathKey(file.path)
    const result: MarkdownResult =
      !path || file.symbolicLink || file.error || file.raw === undefined
        ? {
            status: 'pending',
            reason: !path
              ? 'invalid-workspace-path'
              : file.symbolicLink
                ? 'symbolic-link'
                : 'unreadable-file',
          }
        : readWorkspaceMarkdown(file.raw)
    const identity =
      result.status === 'managed'
        ? result.document.identity
        : result.status === 'pending'
          ? result.identity
          : undefined
    let issues: readonly string[] = []
    if (result.status === 'managed') {
      const root = { note: 'notes/', draft: 'drafts/', source: 'sources/' }[
        result.document.identity.kind
      ]
      issues =
        !file.path.startsWith(root) || !/\.md$/i.test(file.path)
          ? ['invalid-managed-location']
          : (options.acceptanceIssues?.(result.document) ?? [])
    }
    return { file, path, result, identity, issues }
  })
  const pathCounts = new Map<string, number>()
  const idCounts = new Map<string, number>()
  for (const read of reads) {
    if (read.path) pathCounts.set(read.path, (pathCounts.get(read.path) ?? 0) + 1)
    if (read.identity) {
      const key = identityKey(read.identity)
      idCounts.set(key, (idCounts.get(key) ?? 0) + 1)
    }
  }
  const movedIdentities = new Set(
    reads
      .filter(
        (read) =>
          read.result.status === 'managed' &&
          !read.issues.length &&
          read.identity &&
          idCounts.get(identityKey(read.identity)) === 1 &&
          read.path &&
          pathCounts.get(read.path) === 1,
      )
      .map((read) => identityKey(read.identity!)),
  )
  const changes: FileChange[] = reads.map(({ file, path, result, identity, issues }) => {
    const base = { path: file.path, ...(identity ? { identity } : {}) }
    if (path && pathCounts.get(path)! > 1)
      return { ...base, status: 'conflict', reason: 'duplicate-path' }
    if (identity && idCounts.get(identityKey(identity))! > 1)
      return { ...base, status: 'conflict', reason: 'duplicate-id' }
    const atPath = path ? byPath.get(path) : undefined
    if (result.status === 'pending') return { ...base, status: 'pending', reason: result.reason }
    if (result.status === 'unmanaged' || result.status === 'unregistered') {
      return atPath
        ? {
            ...base,
            identity: atPath.document.identity,
            status: 'conflict',
            reason: 'registered-identity-removed',
          }
        : { ...base, status: result.status }
    }
    const document = result.document
    const id = identityKey(document.identity)
    if (
      atPath &&
      identityKey(atPath.document.identity) !== id &&
      !movedIdentities.has(identityKey(atPath.document.identity))
    ) {
      return { ...base, status: 'conflict', reason: 'registered-identity-changed' }
    }
    if (issues.length) return { ...base, status: 'pending', reason: issues.join(', ') }
    const before = byIdentity.get(id)
    const renamed = before && before.path !== file.path
    const modified = before && before.document.raw !== document.raw
    return {
      ...base,
      document,
      status: !before
        ? 'new'
        : renamed
          ? modified
            ? 'renamed-modified'
            : 'renamed'
          : modified
            ? 'modified'
            : 'unchanged',
      ...(before ? { previousPath: before.path } : {}),
      ...(document.identity.kind === 'note'
        ? { variants: planVariants(before?.cards ?? [], document.variants) }
        : {}),
    }
  })
  if (options.completeScan) {
    for (const file of accepted) {
      if (
        !idCounts.has(identityKey(file.document.identity)) &&
        !pathCounts.has(pathKey(file.path)!)
      ) {
        changes.push({
          path: file.path,
          identity: file.document.identity,
          status: 'missing',
          reason: 'confirm-stable-deletion',
        })
      }
    }
  }
  return changes
}
