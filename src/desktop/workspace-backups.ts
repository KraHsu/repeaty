import { z } from 'zod'
import { shallowRef } from 'vue'
import { currentWorkspace, workspaceApi, workspaceStatus, type NativeApi } from './workspaces'
import type { useLibrary } from '../composables/useLibrary'

export const backupPolicySchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(15).max(10080),
  hourly: z.number().int().min(0).max(1000),
  daily: z.number().int().min(0).max(1000),
  weekly: z.number().int().min(0).max(1000),
  monthly: z.number().int().min(0).max(1000),
})
export type BackupPolicy = z.infer<typeof backupPolicySchema>
export const backupConfigurationSchema = z.object({
  policy: backupPolicySchema,
  targets: z.array(z.string()).max(2),
})
export const fullBackupSchema = z
  .object({
    id: z.uuid(),
    archivePath: z.string(),
    sourceWorkspaceId: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
    revision: z.number().int(),
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().nonnegative(),
    verified: z.boolean(),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sha256: z.union([z.literal(''), z.string().regex(/^[a-f0-9]{64}$/)]),
    counts: z.record(z.string(), z.number().nonnegative()),
  })
  .refine((value) => (value.verified ? value.sha256.length === 64 : value.sha256 === ''), {
    message: 'Invalid backup verification state',
  })
export const backupEntrySchema = z.object({ key: z.uuid(), summary: fullBackupSchema })
export type BackupEntry = z.infer<typeof backupEntrySchema>
const reportSchema = z.object({
  target: z.string(),
  backup: fullBackupSchema.nullable(),
  error: z.string().nullable(),
  pruned: z.number().int().nonnegative(),
})
export const backupReportsSchema = z.array(reportSchema)
export type BackupReport = z.infer<typeof reportSchema>
export const backupSearchSchema = z.array(
  z.object({
    store: z.string(),
    id: z.string(),
    title: z.string(),
    excerpt: z.string(),
    retired: z.boolean(),
    path: z.string().nullable(),
    restoreKey: z.string().nullable(),
  }),
)
export type BackupHit = z.infer<typeof backupSearchSchema>[number]
export const maintenanceSchema = z.object({
  integrity: z.string(),
  pages: z.number(),
  freePages: z.number(),
  pageSize: z.number(),
  databaseBytes: z.number(),
  reclaimableBytes: z.number(),
  compacted: z.boolean(),
})
export const automaticBackupReport = shallowRef<{
  token: string
  reports: BackupReport[]
  error?: Error
}>()
export function createWorkspaceBackups(token: string, api: NativeApi = workspaceApi) {
  const epoch = workspaceStatus.value?.epoch
  const request = <T>(body: unknown) =>
    api<T>('workspace_backups', { token, ...(epoch ? { epoch } : {}), request: body })
  return {
    configuration: async () =>
      backupConfigurationSchema.parse(await request({ type: 'configuration' })),
    target: async (slot: number, clear = false) => {
      const value = await request({ type: 'target', slot, clear })
      return value === null ? null : backupConfigurationSchema.parse(value)
    },
    policy: async (policy: BackupPolicy) =>
      backupConfigurationSchema.parse(
        await request({ type: 'policy', policy: backupPolicySchema.parse(policy) }),
      ),
    list: async () =>
      z
        .object({ entries: z.array(backupEntrySchema), errors: backupReportsSchema })
        .parse(await request({ type: 'list' })),
    run: async (job: string, automatic = false) =>
      backupReportsSchema.parse(await request({ type: 'run', job, automatic })),
    inspect: async (key?: string, job: string = crypto.randomUUID()) => {
      const value = await request({ type: 'inspect', key: key ?? null, job })
      if (value === null) return null
      const result = backupEntrySchema.parse(value)
      if (!result.summary.verified) throw new Error('备份未通过完整校验。')
      return result
    },
    search: async (key: string, query: string, job: string = crypto.randomUUID()) =>
      backupSearchSchema.parse(await request({ type: 'search', key, query, job })),
    restore: async (key: string, job: string, paths?: string[]) => {
      const value = await request({ type: 'restore', key, job, paths: paths ?? null })
      return value === null
        ? null
        : z.object({ path: z.string(), result: z.unknown() }).parse(value)
    },
    maintenance: async (vacuum = false) =>
      maintenanceSchema.parse(await request({ type: 'maintenance', vacuum })),
    cancel: (job: string) => api('workspace_backup_cancel', { job }),
  }
}
/** One timer per application, independent of which page is visible. No work after disposal. */
export async function connectAutomaticBackups(reader: ReturnType<typeof useLibrary>) {
  const active = await currentWorkspace().catch(() => undefined)
  if (!active) return () => {}
  const client = createWorkspaceBackups(active.token)
  let alive = true,
    job: string | undefined
  const tick = async () => {
    if (!alive || job || !reader.ready.value || reader.busy.value) return
    job = crypto.randomUUID()
    try {
      const reports = await client.run(job, true)
      if (alive && reports.length) automaticBackupReport.value = { token: active.token, reports }
    } catch (error) {
      if (alive)
        automaticBackupReport.value = {
          token: active.token,
          reports: [],
          error: error instanceof Error ? error : new Error(String(error)),
        }
    } finally {
      job = undefined
    }
  }
  const timer = setInterval(() => {
    void tick()
  }, 60_000)
  void tick()
  return () => {
    alive = false
    clearInterval(timer)
    if (job) void client.cancel(job).catch(() => {})
  }
}
