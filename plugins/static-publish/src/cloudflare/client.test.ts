import { describe, expect, it, vi } from 'vitest'
vi.mock('@repeaty/plugin-api', () => ({ resources: {} }))
import {
  createProject,
  deploy,
  reconcile,
  removeProject,
  targetKey,
  type CloudflarePorts,
  type CloudflareTarget,
  type DeploymentState,
} from './client'
import { prepareAssets } from './assets'
import { emptyIndex, file, type SiteBuild } from '../model'
import type { PluginHttpRequest } from '@repeaty/plugin-api'

const target: CloudflareTarget = {
  accountId: 'a'.repeat(32),
  projectName: 'learning',
  branch: 'main',
  credentialSlot: 'cloudflare',
}
const build: SiteBuild = {
  files: [file('index.html', 'text/html', '<h1>学习</h1>')],
  fingerprint: 'f'.repeat(64),
  index: emptyIndex(),
  generatedAt: '2026-10-30T00:00:00Z',
  pages: [],
}
function response(result: unknown, status = 200) {
  return {
    status,
    headers: {},
    body: JSON.stringify({ success: status < 400, result }),
    credentialRevision: null,
    currentCredentialRevision: null,
  }
}
function state(phase: DeploymentState['phase'] = 'submitting'): DeploymentState {
  return {
    version: 1,
    operationId: 'operation',
    targetKey: targetKey(target),
    fingerprint: build.fingerprint,
    phase,
    startedAt: build.generatedAt,
  }
}
function fixture() {
  const saved: DeploymentState[] = []
  const calls: PluginHttpRequest[] = []
  let failSubmission = false
  let remote: Record<string, unknown> | undefined
  const ports: CloudflarePorts = {
    prepare: async (files) => prepareAssets(files),
    save: async (value) => {
      saved.push(structuredClone(value))
    },
    request: async (input) => {
      calls.push(input)
      if (input.url.endsWith('/upload-token')) return response({ jwt: 'short-lived-secret' })
      if (input.url.endsWith('/check-missing'))
        return response(prepareAssets(build.files).map((file) => file.hash))
      if (input.url.endsWith('/assets/upload')) return response(null)
      if (input.url.endsWith('/deployments') && input.method === 'POST') {
        expect(saved.at(-1)?.phase).toBe('submitting')
        const multipart = (input.body as { multipart: { name: string; text: string }[] }).multipart
        remote = {
          id: 'deployment-one',
          url: 'https://learning.pages.dev/',
          latest_stage: { status: 'success' },
          deployment_trigger: {
            metadata: {
              commit_message: multipart.find((part) => part.name === 'commit_message')!.text,
              branch: 'main',
            },
          },
        }
        if (failSubmission) throw new Error('connection closed after server commit')
        return response(remote)
      }
      if (input.url.includes('/deployments?')) return response(remote ? [remote] : [])
      if (input.url.includes('/deployments/')) return response(remote)
      return response({ subdomain: 'learning.pages.dev' })
    },
  }
  return {
    ports,
    saved,
    calls,
    failSubmission() {
      failSubmission = true
    },
  }
}
describe('Cloudflare Pages publication journal', () => {
  it('uploads content-addressed assets and a manifest without persisting credentials or local IDs', async () => {
    const { ports, saved, calls } = fixture()
    const result = await deploy(build, target, undefined, ports)
    expect(result.phase).toBe('published')
    expect(result.deploymentId).toBe('deployment-one')
    expect(JSON.stringify(saved)).not.toContain('short-lived-secret')
    const submission = calls.find((call) => call.url.endsWith('/deployments'))!
    expect(submission.secret?.headers?.authorization).toBe('Bearer {{token}}')
    expect(JSON.stringify(submission.body)).toContain('/index.html')
    const before = calls.filter((call) => call.method === 'POST').length
    await deploy(build, target, result, ports)
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(before)
  })
  it('recovers a committed deployment after a lost response and never reposts an unresolved operation', async () => {
    const fixtureA = fixture()
    fixtureA.failSubmission()
    const unknown = await deploy(build, target, undefined, fixtureA.ports)
    expect(unknown.phase).toBe('unknown')
    const recovered = await deploy(build, target, unknown, fixtureA.ports)
    expect(recovered.phase).toBe('published')
    expect(
      fixtureA.calls.filter((call) => call.url.endsWith('/deployments') && call.method === 'POST'),
    ).toHaveLength(1)
    const fixtureB = fixture()
    const absent = await deploy(build, target, state(), fixtureB.ports)
    expect(absent.phase).toBe('unknown')
    expect(fixtureB.calls.every((call) => !call.method || call.method === 'GET')).toBe(true)
  })
  it('does not send remote writes when the durable submission journal cannot be saved', async () => {
    const { ports, calls } = fixture()
    ports.save = async (value) => {
      if (value.phase === 'submitting') throw new Error('disk-full')
    }
    const result = await deploy(build, target, undefined, ports)
    expect(result.phase).toBe('failed')
    expect(calls.some((call) => call.url.endsWith('/deployments') && call.method === 'POST')).toBe(
      false,
    )
  })
  it('revalidates the source after asset uploads and before the final non-idempotent submission', async () => {
    const { ports, calls } = fixture()
    let changed = false
    const request = ports.request
    ports.request = async (input, signal) => {
      const result = await request(input, signal)
      if (input.url.endsWith('/assets/upload')) changed = true
      return result
    }
    ports.validate = () => {
      if (changed) throw new Error('publishing-library-changed')
    }
    const result = await deploy(build, target, undefined, ports)
    expect(result.phase).toBe('failed')
    expect(result.error).toBe('publishing-library-changed')
    expect(calls.some((call) => call.url.endsWith('/deployments') && call.method === 'POST')).toBe(
      false,
    )
    changed = false
    ports.request = request
    expect((await deploy(build, target, result, ports)).phase).toBe('published')
  })
  it('keeps an uncertain remote result if recording the acknowledged deployment fails', async () => {
    const { ports, calls } = fixture()
    const save = ports.save
    ports.save = async (value) => {
      if (value.phase === 'published') throw new Error('disk-full')
      await save(value)
    }
    expect((await deploy(build, target, undefined, ports)).phase).toBe('unknown')
    expect(
      calls.filter((call) => call.url.endsWith('/deployments') && call.method === 'POST'),
    ).toHaveLength(1)
  })
  it('allows retry after cancellation before submission or an explicit authentication rejection', async () => {
    const cancelled = fixture()
    const abort = new AbortController()
    const save = cancelled.ports.save
    cancelled.ports.save = async (value) => {
      await save(value)
      if (value.phase === 'submitting') abort.abort()
    }
    expect((await deploy(build, target, undefined, cancelled.ports, abort.signal)).phase).toBe(
      'failed',
    )
    expect(
      cancelled.calls.some((call) => call.url.endsWith('/deployments') && call.method === 'POST'),
    ).toBe(false)

    const rejected = fixture()
    const request = rejected.ports.request
    let deny = true
    rejected.ports.request = async (input, signal) => {
      if (deny && input.url.endsWith('/deployments') && input.method === 'POST')
        return response(null, 403)
      return request(input, signal)
    }
    const failed = await deploy(build, target, undefined, rejected.ports)
    expect(failed.phase).toBe('failed')
    expect(failed.error).toBe('cloudflare-auth-failed')
    deny = false
    expect((await deploy(build, target, failed, rejected.ports)).phase).toBe('published')
  })
  it('rejects target changes while an unresolved operation exists and honors cancellation before upload', async () => {
    const { ports, calls } = fixture()
    await expect(
      deploy(build, { ...target, projectName: 'other' }, state(), ports),
    ).rejects.toThrow('cloudflare-pending-other-target')
    const abort = new AbortController()
    abort.abort()
    await expect(deploy(build, target, undefined, ports, abort.signal)).rejects.toThrow()
    expect(calls).toHaveLength(0)
    await expect(reconcile({ ...target, branch: 'other' }, state(), ports)).rejects.toThrow(
      'cloudflare-state-mismatch',
    )
  })
  it('reconciles project create conflicts and project deletion without implicit retries', async () => {
    let exists = false
    let creates = 0
    const saved: DeploymentState[] = []
    const ports: CloudflarePorts = {
      save: async (value) => {
        saved.push(value)
      },
      request: async (input) => {
        if (input.method === 'POST') {
          creates++
          exists = true
          return response(null, 409)
        }
        if (input.method === 'DELETE') {
          exists = false
          throw new Error('reply lost')
        }
        return response(exists ? { subdomain: 'learning.pages.dev' } : null, exists ? 200 : 404)
      },
    }
    expect((await createProject(target, ports)).exists).toBe(true)
    expect(creates).toBe(1)
    const deleting = await removeProject(target, state('published'), ports)
    expect(deleting.phase).toBe('deleting')
    expect((await reconcile(target, deleting, ports)).phase).toBe('deleted')
  })
  it('hashes extension and bytes deterministically, rejecting duplicate and unsafe output paths', () => {
    expect(prepareAssets([file('index.html', 'text/html', '<h1>Hello</h1>')])[0]!.hash).toBe(
      '8deb79e268ae1932009657bb3e496c87',
    )
    const first = prepareAssets(build.files)[0]!
    expect(first.hash).toMatch(/^[a-f0-9]{32}$/u)
    expect(first.hash).toBe(prepareAssets(build.files)[0]!.hash)
    expect(prepareAssets([{ ...build.files[0]!, path: 'index.txt' }])[0]!.hash).not.toBe(first.hash)
    expect(() => prepareAssets([...build.files, ...build.files])).toThrow('cloudflare-invalid-path')
    expect(() => prepareAssets([{ ...build.files[0]!, path: '../private' }])).toThrow(
      'cloudflare-invalid-path',
    )
  })
})
