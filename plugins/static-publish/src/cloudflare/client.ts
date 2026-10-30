import type { PluginHttpRequest, PluginHttpResponse } from '@repeaty/plugin-api'
import { resources } from '@repeaty/plugin-api'
import type { SiteBuild, SiteFile } from '../model'
import type { UploadAsset } from './assets'

export const cloudflareOrigin = 'https://api.cloudflare.com'
const api = cloudflareOrigin + '/client/v4'
export interface CloudflareTarget {
  accountId: string
  projectName: string
  branch: string
  credentialSlot: string
  credentialRevision?: number
}
export interface DeploymentState {
  version: 1
  operationId: string
  targetKey: string
  fingerprint: string
  phase:
    | 'prepared'
    | 'uploading'
    | 'submitting'
    | 'unknown'
    | 'deploying'
    | 'published'
    | 'failed'
    | 'deleting'
    | 'deleted'
  deploymentId?: string
  url?: string
  startedAt: string
  error?: string
}
export interface CloudflarePorts {
  request(input: PluginHttpRequest, signal?: AbortSignal): Promise<PluginHttpResponse>
  save(state: DeploymentState): Promise<void>
  validate?(): void
  prepare?(files: SiteFile[], signal?: AbortSignal): Promise<UploadAsset[]>
}
interface Deployment {
  id?: string
  url?: string
  latest_stage?: { status?: string }
  deployment_trigger?: {
    metadata?: { commit_message?: string; commit_hash?: string; branch?: string }
  }
}
export class CloudflareError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(code)
  }
}
function check(signal?: AbortSignal) {
  signal?.throwIfAborted()
}
export function targetKey(target: CloudflareTarget) {
  if (
    !/^[a-f0-9]{32}$/iu.test(target.accountId) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/u.test(target.projectName) ||
    !target.branch ||
    target.branch.length > 100 ||
    /[\u0000-\u001f]/u.test(target.branch) ||
    !/^[a-zA-Z0-9._-]{1,128}$/u.test(target.credentialSlot)
  )
    throw new CloudflareError('cloudflare-invalid-target')
  return `${target.accountId.toLowerCase()}/${target.projectName}/${target.branch}`
}
function endpoint(target: CloudflareTarget) {
  targetKey(target)
  return `${api}/accounts/${target.accountId}/pages/projects/${target.projectName}`
}
function marker(state: DeploymentState) {
  return `repeaty:${state.operationId}:${state.fingerprint}`
}
function secret(target: CloudflareTarget) {
  return {
    slot: target.credentialSlot,
    expectedRevision: target.credentialRevision,
    headers: { authorization: 'Bearer {{token}}' },
  }
}
function safeUrl(value: unknown) {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined
  } catch {
    return undefined
  }
}
async function request<T>(
  ports: CloudflarePorts,
  input: PluginHttpRequest,
  signal?: AbortSignal,
): Promise<T> {
  check(signal)
  let response: PluginHttpResponse
  try {
    response = await ports.request(input, signal)
  } catch {
    check(signal)
    throw new CloudflareError('cloudflare-network-unknown')
  }
  check(signal)
  if (response.credentialRevision !== response.currentCredentialRevision)
    throw new CloudflareError('cloudflare-credentials-changed')
  let envelope: { success?: boolean; result?: T }
  try {
    envelope = JSON.parse(response.body)
  } catch {
    throw new CloudflareError('cloudflare-invalid-response', response.status)
  }
  if (response.status < 200 || response.status >= 300 || envelope.success === false)
    throw new CloudflareError(
      response.status === 401 || response.status === 403
        ? 'cloudflare-auth-failed'
        : 'cloudflare-request-failed',
      response.status,
    )
  if (!Object.hasOwn(envelope, 'result') && envelope.success !== true)
    throw new CloudflareError('cloudflare-invalid-response', response.status)
  return envelope.result as T
}
export async function inspectProject(
  target: CloudflareTarget,
  ports: CloudflarePorts,
  signal?: AbortSignal,
): Promise<{ exists: boolean; subdomain?: string }> {
  try {
    const result = await request<{ subdomain?: string }>(
      ports,
      { url: endpoint(target), secret: secret(target) },
      signal,
    )
    return {
      exists: true,
      subdomain: typeof result?.subdomain === 'string' ? result.subdomain : undefined,
    }
  } catch (error) {
    if (error instanceof CloudflareError && error.status === 404) return { exists: false }
    throw error
  }
}
export async function createProject(
  target: CloudflareTarget,
  ports: CloudflarePorts,
  signal?: AbortSignal,
) {
  const current = await inspectProject(target, ports, signal)
  if (current.exists) return current
  try {
    await request(
      ports,
      {
        url: `${api}/accounts/${target.accountId}/pages/projects`,
        method: 'POST',
        secret: secret(target),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: target.projectName, production_branch: target.branch }),
      },
      signal,
    )
  } catch (error) {
    // Names are unique remotely. An interrupted create is reconciled by GET, never repeated here.
    if (
      error instanceof CloudflareError &&
      (error.status === 409 || error.code === 'cloudflare-network-unknown')
    ) {
      const found = await inspectProject(target, ports, signal)
      if (found.exists) return found
    }
    throw error
  }
  return inspectProject(target, ports, signal)
}
async function prepare(files: SiteFile[], signal?: AbortSignal): Promise<UploadAsset[]> {
  check(signal)
  const source = resources.read('cloudflare-worker.js')
  if (!source) throw new CloudflareError('cloudflare-worker-missing')
  const scope = resources.createScope()
  const abort = () => scope.dispose()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const worker = scope.createWorker(await source.text())
    check(signal)
    return await new Promise<UploadAsset[]>((resolve, reject) => {
      const cancelled = () => reject(new CloudflareError('cloudflare-cancelled'))
      scope.signal.addEventListener('abort', cancelled, { once: true })
      worker.onmessage = (event: MessageEvent) => {
        scope.signal.removeEventListener('abort', cancelled)
        if (event.data.error) reject(new CloudflareError('cloudflare-assets-invalid'))
        else resolve(event.data.assets)
      }
      worker.onerror = () => reject(new CloudflareError('cloudflare-assets-invalid'))
      worker.postMessage({ files })
    })
  } finally {
    signal?.removeEventListener('abort', abort)
    scope.dispose()
  }
}
async function persist(
  ports: CloudflarePorts,
  state: DeploymentState,
  patch: Partial<DeploymentState>,
) {
  const next = { ...state, ...patch }
  await ports.save(next)
  return next
}
function deploymentState(state: DeploymentState, deployment: Deployment): DeploymentState {
  if (
    !deployment ||
    typeof deployment.id !== 'string' ||
    !/^[a-zA-Z0-9-]{1,100}$/u.test(deployment.id)
  )
    throw new CloudflareError('cloudflare-invalid-response')
  const status = deployment.latest_stage?.status
  return {
    ...state,
    deploymentId: deployment.id,
    url: safeUrl(deployment.url),
    phase:
      status === 'success'
        ? 'published'
        : ['failure', 'canceled'].includes(status ?? '')
          ? 'failed'
          : 'deploying',
    error: undefined,
  }
}
function verifyState(target: CloudflareTarget, state: DeploymentState) {
  if (
    state.version !== 1 ||
    state.targetKey !== targetKey(target) ||
    !/^[a-zA-Z0-9-]{1,100}$/u.test(state.operationId) ||
    !/^[a-f0-9]{64}$/u.test(state.fingerprint)
  )
    throw new CloudflareError('cloudflare-state-mismatch')
}
export async function reconcile(
  target: CloudflareTarget,
  state: DeploymentState,
  ports: CloudflarePorts,
  signal?: AbortSignal,
): Promise<DeploymentState> {
  verifyState(target, state)
  if (state.phase === 'deleting' || state.phase === 'deleted') {
    const project = await inspectProject(target, ports, signal)
    return persist(ports, state, { phase: project.exists ? 'deleting' : 'deleted' })
  }
  let found: Deployment | undefined
  if (state.deploymentId) {
    try {
      found = await request<Deployment>(
        ports,
        {
          url: `${endpoint(target)}/deployments/${encodeURIComponent(state.deploymentId)}`,
          secret: secret(target),
        },
        signal,
      )
    } catch (error) {
      if (!(error instanceof CloudflareError && error.status === 404)) throw error
    }
  } else {
    for (let page = 1; page <= 20; page++) {
      const deployments = await request<Deployment[]>(
        ports,
        { url: `${endpoint(target)}/deployments?per_page=25&page=${page}`, secret: secret(target) },
        signal,
      )
      if (!Array.isArray(deployments)) throw new CloudflareError('cloudflare-invalid-response')
      found = deployments.find(
        (item) =>
          item.deployment_trigger?.metadata?.commit_message === marker(state) &&
          item.deployment_trigger?.metadata?.branch === target.branch,
      )
      if (found || deployments.length < 25) break
    }
  }
  if (!found)
    return persist(ports, state, { phase: 'unknown', error: 'cloudflare-result-unconfirmed' })
  const next = deploymentState(state, found)
  await ports.save(next)
  return next
}
export async function deploy(
  build: SiteBuild,
  target: CloudflareTarget,
  previous: DeploymentState | undefined,
  ports: CloudflarePorts,
  signal?: AbortSignal,
): Promise<DeploymentState> {
  check(signal)
  const key = targetKey(target)
  if (
    previous &&
    previous.targetKey !== key &&
    ['submitting', 'unknown', 'deploying', 'deleting'].includes(previous.phase)
  )
    throw new CloudflareError('cloudflare-pending-other-target')
  if (
    previous &&
    previous.targetKey === key &&
    ['submitting', 'unknown', 'deploying', 'deleting'].includes(previous.phase)
  )
    return reconcile(target, previous, ports, signal)
  if (
    previous?.targetKey === key &&
    previous.phase === 'published' &&
    previous.fingerprint === build.fingerprint
  )
    return reconcile(target, previous, ports, signal)
  if (!/^[a-f0-9]{64}$/u.test(build.fingerprint))
    throw new CloudflareError('cloudflare-invalid-build')
  let state: DeploymentState = {
    version: 1,
    operationId: crypto.randomUUID(),
    targetKey: key,
    fingerprint: build.fingerprint,
    phase: 'prepared',
    startedAt: new Date().toISOString(),
  }
  await ports.save(state)
  let submissionStarted = false
  try {
    ports.validate?.()
    if (!(await inspectProject(target, ports, signal)).exists)
      throw new CloudflareError('cloudflare-project-missing')
    const files = await (ports.prepare ?? prepare)(build.files, signal)
    check(signal)
    ports.validate?.()
    const token = await request<{ jwt: string }>(
      ports,
      { url: `${endpoint(target)}/upload-token`, secret: secret(target) },
      signal,
    )
    if (!token || typeof token.jwt !== 'string' || !token.jwt || token.jwt.length > 8192)
      throw new CloudflareError('cloudflare-invalid-response')
    const headers = { authorization: `Bearer ${token.jwt}`, 'content-type': 'application/json' }
    const missing = await request<string[]>(
      ports,
      {
        url: `${api}/pages/assets/check-missing`,
        method: 'POST',
        headers,
        body: JSON.stringify({ hashes: files.map((file) => file.hash) }),
      },
      signal,
    )
    if (
      !Array.isArray(missing) ||
      missing.some((hash) => !files.some((file) => file.hash === hash))
    )
      throw new CloudflareError('cloudflare-invalid-response')
    state = await persist(ports, state, { phase: 'uploading' })
    for (const file of files.filter((file) => missing.includes(file.hash))) {
      ports.validate?.()
      await request(
        ports,
        {
          url: `${api}/pages/assets/upload`,
          method: 'POST',
          headers,
          body: JSON.stringify([
            {
              key: file.hash,
              value: file.base64,
              metadata: { contentType: file.type },
              base64: true,
            },
          ]),
        },
        signal,
      )
    }
    // The durable uncertain state precedes the only non-idempotent write.
    state = await persist(ports, state, { phase: 'submitting' })
    check(signal)
    ports.validate?.()
    submissionStarted = true
    const deployment = await request<Deployment>(
      ports,
      {
        url: `${endpoint(target)}/deployments`,
        method: 'POST',
        secret: secret(target),
        body: {
          multipart: [
            { name: 'branch', text: target.branch },
            {
              name: 'manifest',
              text: JSON.stringify(
                Object.fromEntries(files.map((file) => [`/${file.path}`, file.hash])),
              ),
            },
            { name: 'commit_message', text: marker(state) },
            { name: 'commit_hash', text: state.fingerprint.slice(0, 40) },
            { name: 'commit_dirty', text: 'false' },
          ],
        },
      },
      signal,
    )
    const next = deploymentState(state, deployment)
    await ports.save(next)
    return next
  } catch (error) {
    const rejected = error instanceof CloudflareError && error.code === 'cloudflare-auth-failed'
    const uncertain = submissionStarted && !rejected
    return persist(ports, state, {
      phase: uncertain ? 'unknown' : 'failed',
      error: uncertain
        ? 'cloudflare-result-unconfirmed'
        : error instanceof CloudflareError
          ? error.code
          : error instanceof Error && /^(publishing-[a-z-]+|publication-stale)$/.test(error.message)
            ? error.message
            : signal?.aborted
              ? 'cloudflare-cancelled'
              : 'cloudflare-request-failed',
    })
  }
}
export async function removeProject(
  target: CloudflareTarget,
  state: DeploymentState,
  ports: CloudflarePorts,
  signal?: AbortSignal,
) {
  verifyState(target, state)
  // Caller must explicitly confirm deleting the project and all its deployments.
  const deleting = await persist(ports, state, { phase: 'deleting' })
  try {
    await request(
      ports,
      { url: endpoint(target), method: 'DELETE', secret: secret(target) },
      signal,
    )
  } catch (error) {
    if (!(error instanceof CloudflareError && error.status === 404)) return deleting
  }
  return reconcile(target, deleting, ports, signal)
}
