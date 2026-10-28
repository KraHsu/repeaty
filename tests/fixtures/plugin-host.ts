import type { BrowserContext } from '@playwright/test'
import { mkdir, readFile, readdir, rm, writeFile, lstat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { bundleSchema, packageHash, type PluginBundle } from '../../src/plugins/package'

interface Runtime {
  call<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>
}
interface Slot {
  slot: string
  origin: string
  revision: number
  configured: boolean
}

/** Real package files and workspace tokens, with only external services emulated. */
export async function installPluginHostFixture(
  context: BrowserContext,
  runtime: Runtime,
  temporaryRoot: string,
) {
  const trusted = new Set<string>()
  const secrets = new Map<string, Slot>()
  let revision = 0
  const absolute = (path: string) => {
    if (process.platform === 'win32') {
      if (path.startsWith('\\\\?\\UNC\\')) path = '\\\\' + path.slice(8)
      else if (path.startsWith('\\\\?\\')) path = path.slice(4)
    }
    return resolve(path)
  }
  const contained = (root: string, path: string) => {
    const suffix = relative(absolute(root), absolute(path))
    if (
      isAbsolute(suffix) ||
      suffix === '..' ||
      suffix.startsWith('..\\') ||
      suffix.startsWith('../')
    )
      throw new Error('Unsafe test fixture path')
    return absolute(path)
  }
  async function bundle(root: string, id: string): Promise<PluginBundle> {
    const directory = join(root, id)
    for (const path of [directory, join(directory, 'manifest.json'), join(directory, 'main.js')])
      if ((await lstat(path)).isSymbolicLink()) throw new Error('invalid-plugin')
    let styles: string | undefined
    let readme: string | undefined
    try {
      const path = join(directory, 'styles.css')
      if ((await lstat(path)).isSymbolicLink()) throw new Error('invalid-plugin')
      styles = await readFile(path, 'utf8')
    } catch (issue) {
      if ((issue as NodeJS.ErrnoException).code !== 'ENOENT') throw issue
    }
    try {
      const path = join(directory, 'README.md')
      if ((await lstat(path)).isSymbolicLink()) throw new Error('invalid-plugin')
      readme = await readFile(path, 'utf8')
    } catch (issue) {
      if ((issue as NodeJS.ErrnoException).code !== 'ENOENT') throw issue
    }
    return bundleSchema.parse({
      manifest: JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')),
      main: await readFile(join(directory, 'main.js'), 'utf8'),
      ...(styles === undefined ? {} : { styles }),
      ...(readme === undefined ? {} : { readme }),
    })
  }
  await context.exposeBinding(
    '__repeatyPluginFilesystem',
    async (_, args: { token: string; id: string; operation: string; payload?: unknown }) => {
      const status = await runtime.call<{
        active: { id: string; token: string; path: string } | null
      }>('workspace_status')
      if (!status.active || status.active.token !== args.token)
        throw new Error('stale-workspace-session')
      const directory = contained(temporaryRoot, status.active.path)
      const root = join(directory, '.repeaty', 'plugins')
      const payload = (args.payload ?? {}) as Record<string, unknown>
      const validId = /^[a-z][a-z0-9-]{0,63}$/.test(args.id)
      if (!validId && !['list', 'trust-state'].includes(args.operation))
        throw new Error('invalid-plugin')
      if (args.operation === 'list') {
        const entries = await readdir(root, { withFileTypes: true }).catch((issue) => {
          if ((issue as NodeJS.ErrnoException).code === 'ENOENT') return []
          throw issue
        })
        return Promise.all(
          entries
            .filter((entry) => !entry.name.startsWith('.'))
            .map(async (entry) => {
              try {
                if (!/^[a-z][a-z0-9-]{0,63}$/.test(entry.name)) throw new Error('invalid-plugin')
                return await bundle(root, entry.name)
              } catch (issue) {
                return {
                  id: entry.name,
                  error: issue instanceof Error ? issue.message : String(issue),
                }
              }
            }),
        )
      }
      if (args.operation === 'trust-state') return { hashes: Array.from(trusted) }
      if (args.operation === 'read') return bundle(root, args.id)
      if (args.operation === 'install') {
        const value = bundleSchema.parse(payload)
        if (value.manifest.id !== args.id) throw new Error('invalid-plugin')
        const target = contained(root, join(root, args.id))
        await mkdir(target, { recursive: true })
        await writeFile(join(target, 'manifest.json'), JSON.stringify(value.manifest))
        await writeFile(join(target, 'main.js'), value.main)
        if (value.styles === undefined) await rm(join(target, 'styles.css'), { force: true })
        else await writeFile(join(target, 'styles.css'), value.styles)
        if (value.readme === undefined) await rm(join(target, 'README.md'), { force: true })
        else await writeFile(join(target, 'README.md'), value.readme)
        return null
      }
      if (args.operation === 'remove') {
        await rm(contained(root, join(root, args.id)), { recursive: true, force: true })
        return null
      }
      const installed = await bundle(root, args.id)
      const hash = await packageHash(installed)
      if (args.operation === 'trust') {
        if (payload.hash !== hash) throw new Error('plugin-file-changed')
        trusted.add(hash)
        return null
      }
      if (!trusted.has(hash)) throw new Error('plugin-not-trusted')
      const slots = () =>
        [...secrets.entries()]
          .filter(([key, slot]) => key.startsWith(`${args.id}:`) && slot.configured)
          .map(([, { slot, origin, revision }]) => ({ slot, origin, revision }))
      const sync = (configured: string[], bump?: string) => {
        const names = new Set([
          ...configured,
          ...slots().map((slot) => slot.slot),
          ...(bump ? [bump] : []),
        ])
        for (const slot of names) {
          const key = `${args.id}:${slot}`
          const previous = secrets.get(key)
          const enabled = configured.includes(slot)
          if (!previous || previous.configured !== enabled || bump === slot)
            secrets.set(key, {
              slot,
              origin: `https://${slot}`,
              revision: ++revision,
              configured: enabled,
            })
        }
        return { slots: slots() }
      }
      if (args.operation === 'test-secret-sync')
        return sync(payload.configured as string[], payload.bump as string | undefined)
      if (args.operation === 'test-http-snapshot') {
        const url = new URL(payload.url as string)
        if (!installed.manifest.permissions?.origins?.includes(url.origin))
          throw new Error('permission-denied')
        const request = payload.secret as { slot: string; expectedRevision?: number } | undefined
        if (!request) return { revision: null }
        const slot = secrets.get(`${args.id}:${request.slot}`)
        if (!slot?.configured) throw new Error('credential-unavailable')
        if (request.expectedRevision !== undefined && request.expectedRevision !== slot.revision)
          throw new Error('credentials-changed')
        if (slot.origin !== url.origin) throw new Error('permission-denied')
        return { revision: slot.revision }
      }
      if (args.operation === 'test-secret-revision') {
        const slot = secrets.get(`${args.id}:${payload.slot}`)
        return slot?.configured ? slot.revision : null
      }
      if (args.operation === 'test-recovery-context') {
        const snapshot = await runtime.call<{
          revision: number
          library: {
            attempts: { id: string; practiceId: string; status: string }[]
            practices: {
              id: string
              question: { plugin: { data: { site: string; slug: string; questionId: string } } }
            }[]
          }
        }>('workspace_read', { token: args.token, request: { type: 'load' } })
        const header =
          snapshot.library.attempts.find((attempt) => attempt.id === payload.attemptId) ??
          snapshot.library.attempts.find((attempt) => attempt.status === 'unknown')
        if (!header) throw new Error('Missing recovery attempt in fixture')
        const result = await runtime.call<{
          attempts: { language: string; code: string; submittedAt: string }[]
        }>('workspace_read', {
          token: args.token,
          request: {
            type: 'attempts',
            input: { mode: 'one', id: header.id, revision: snapshot.revision },
          },
        })
        const attempt = result.attempts[0]!
        const question = snapshot.library.practices.find(
          (practice) => practice.id === header.practiceId,
        )!.question.plugin.data
        return {
          action: 'recover',
          site: question.site,
          slug: question.slug,
          questionId: question.questionId,
          submissionId: payload.submissionId,
          lang: attempt.language,
          code: attempt.code,
          submittedAt: Math.floor(Date.parse(attempt.submittedAt) / 1000),
        }
      }
      throw new Error(`Unexpected plugin fixture operation: ${args.operation}`)
    },
  )
  // This adapter runs only in the browser test harness. Production never uses these URLs.
  await context.addInitScript(() => {
    interface Args {
      token: string
      id: string
      operation: string
      payload?: unknown
    }
    const binding = (args: Args) =>
      (
        window as unknown as {
          __repeatyPluginFilesystem(args: Args): Promise<unknown>
        }
      )
        .__repeatyPluginFilesystem(args)
        .catch((issue: unknown) => {
          throw issue instanceof Error ? issue.message : issue
        })
    const post = async (id: string, payload: unknown, credentials = false) => {
      const response = await fetch(`/__native/${id}${credentials ? '/credentials' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const value = await response.json()
      return { response, value }
    }
    Object.assign(window, {
      __repeatyPluginInvoke: async (args: Args) => {
        if (args.id !== 'leetcode' || !['secrets', 'http'].includes(args.operation))
          return binding(args)
        const payload = (args.payload ?? {}) as Record<string, unknown>
        const call = (operation: string, payload: unknown) =>
          binding({ ...args, operation, payload })
        if (args.operation === 'secrets') {
          const save = payload.action !== 'state'
          const request = save
            ? {
                action: payload.action === 'set' ? 'save' : 'clear',
                site: payload.slot,
                ...(payload.action === 'set' ? (payload.values as Record<string, string>) : {}),
              }
            : { action: 'ping' }
          const { response, value } = await post(args.id, request, save)
          if (!response.ok) throw value.error
          return call('test-secret-sync', {
            configured: value.configured ?? [],
            ...(save ? { bump: payload.slot } : {}),
          })
        }
        const snapshot = (await call('test-http-snapshot', payload)) as { revision: number | null }
        const url = new URL(payload.url as string)
        const body = payload.body ? JSON.parse(payload.body as string) : undefined
        let request: Record<string, unknown>
        if (url.pathname === '/graphql/' && body?.query.includes('RepeatyAccount'))
          request = { action: 'account', site: url.hostname }
        else if (url.pathname === '/graphql/' && body?.query.includes('RepeatyQuestion'))
          request = { action: 'question', site: url.hostname, slug: body.variables.slug }
        else if (url.pathname === '/graphql/' && body?.query.includes('RepeatyRecovery')) {
          const form =
            document.activeElement?.closest('.submission-recovery') ??
            document.querySelector('.submission-recovery')
          const attemptId = form?.querySelector('input')?.id.replace(/^recover-/, '')
          request = (await call('test-recovery-context', {
            attemptId,
            submissionId: String(body.variables.submissionId),
          })) as Record<string, unknown>
        } else if (/^\/problems\/[^/]+\/submit\/$/.test(url.pathname))
          request = {
            action: 'submit',
            site: url.hostname,
            slug: url.pathname.split('/')[2],
            questionId: body.question_id,
            lang: body.lang,
            code: body.typed_code,
          }
        else if (/^\/submissions\/detail\/\d+\/check\/$/.test(url.pathname))
          request = {
            action: 'check',
            site: url.hostname,
            submissionId: url.pathname.split('/')[3],
          }
        else throw 'Unexpected test plugin HTTP endpoint'
        const { response, value: raw } = await post(args.id, request)
        let status = response.status
        let value = raw
        if (!response.ok) {
          const codes: Record<string, number> = {
            'login-required': 401,
            'verification-required': 403,
            'rate-limit': 429,
          }
          if (codes[raw.error]) status = codes[raw.error]!
          else throw raw.error
        } else if (request.action === 'account') {
          value = {
            data: {
              userStatus:
                raw.site !== request.site ||
                (raw.state === 'authenticated' && typeof raw.username !== 'string')
                  ? {}
                  : {
                      isSignedIn: raw.state === 'authenticated',
                      ...(raw.username === undefined ? {} : { username: raw.username }),
                    },
            },
          }
        } else if (request.action === 'recover') {
          const submission = {
            code: request.code,
            timestamp: request.submittedAt,
            question: { questionId: request.questionId, titleSlug: request.slug },
            ...(request.site === 'leetcode.cn'
              ? { isMine: true, lang: request.lang }
              : { user: { username: 'test-learner' }, lang: { name: request.lang } }),
          }
          value = {
            data: { submission, userStatus: { isSignedIn: true, username: 'test-learner' } },
          }
        }
        return {
          status,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(value),
          credentialRevision: snapshot.revision,
          currentCredentialRevision: await call('test-secret-revision', {
            slot: (payload.secret as { slot?: string } | undefined)?.slot,
          }),
        }
      },
    })
  })
}
