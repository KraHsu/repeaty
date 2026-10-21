import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  checkVersions,
  githubApi,
  installerFiles,
  parseVersion,
  platforms,
  prepareRelease,
  publishRelease,
} from './release.mjs'

const version = '0.26.0'
const context = { repository: 'KraHsu/repeaty', sha: 'a'.repeat(40), runId: 100 }
const marker = '<!-- repeaty-release:' + context.sha + ' -->'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function installers(t, value = version) {
  const root = await mkdtemp(join(tmpdir(), 'repeaty-release-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const platform of platforms) {
    const directory = join(root, platform.artifact, 'bundle')
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'Repeaty_' + value + '_' + platform.suffix),
      Buffer.from(platform.artifact),
    )
  }
  return root
}

function github() {
  const state = {
    head: context.sha,
    calls: [],
    uploads: [],
    release: undefined,
    tag: undefined,
    run: {
      ...context,
      head_sha: context.sha,
      head_branch: 'main',
      head_repository: { full_name: context.repository },
      event: 'push',
      path: '.github/workflows/desktop.yml',
    },
    checks: [
      {
        id: 200,
        head_sha: context.sha,
        head_branch: 'main',
        head_repository: { full_name: context.repository },
        event: 'push',
        path: '.github/workflows/ci.yml',
        status: 'completed',
        conclusion: 'success',
      },
    ],
    jobs: platforms.map((platform) => ({
      name: platform.job,
      status: 'completed',
      conclusion: 'success',
    })),
    artifacts: platforms.map((platform, index) => ({
      name: platform.artifact,
      id: index + 1,
      expired: false,
      size_in_bytes: 10,
      workflow_run: { head_sha: context.sha },
    })),
  }
  const api = async (path, options = {}) => {
    const { method = 'GET', body, binary } = options
    state.calls.push({ path, method, body })
    if (path === '/git/ref/heads/main') return { object: { sha: state.head } }
    if (path.startsWith('/git/ref/tags/'))
      return state.tag && { object: { type: 'commit', sha: state.tag } }
    if (path.startsWith('/releases/tags/')) return state.release
    if (path === '/actions/runs/100') return state.run
    if (path.startsWith('/actions/workflows/ci.yml/runs?')) return { workflow_runs: state.checks }
    if (path.startsWith('/actions/runs/100/jobs?')) return { jobs: state.jobs }
    if (path.startsWith('/actions/runs/100/artifacts?')) return { artifacts: state.artifacts }
    if (path === '/releases/generate-notes') return { body: 'Changes from merged pull requests.' }
    if (path === '/releases' && method === 'POST') {
      state.release = {
        id: 500,
        ...body,
        html_url: 'https://github.com/KraHsu/repeaty/releases/tag/' + body.tag_name,
        upload_url:
          'https://uploads.github.com/repos/KraHsu/repeaty/releases/500/assets{?name,label}',
      }
      return state.release
    }
    if (path.startsWith('https://uploads.github.com/')) {
      const name = new URL(path).searchParams.get('name')
      const asset = {
        id: state.uploads.length + 1,
        name,
        size: binary.length,
        state: 'uploaded',
        digest: 'sha256:' + (state.badDigest ? '0'.repeat(64) : hash(binary)),
      }
      state.uploads.push(asset)
      if (state.advanceOnUpload) state.head = 'b'.repeat(40)
      return asset
    }
    if (path === '/releases/500/assets?per_page=100') return state.uploads
    if (path.startsWith('/releases/assets/') && method === 'DELETE') {
      state.uploads = state.uploads.filter((entry) => entry.id !== Number(path.split('/').at(-1)))
      return
    }
    if (path === '/releases/500' && method === 'PATCH') {
      state.release = { ...state.release, ...body }
      return state.release
    }
    throw new Error('Unexpected API call: ' + method + ' ' + path)
  }
  return { state, api }
}

test('accepts stable and prerelease SemVer, rejects ambiguous versions and injected text', () => {
  assert.equal(parseVersion('1.0.0-rc.1').prerelease, true)
  assert.equal(parseVersion('1.0.0+build-1').prerelease, false)
  for (const bad of ['v0.26.0', '0.26', '01.2.3', '1.0.0-01', '1.0.0\n', '1.0.0;echo hi'])
    assert.throws(() => parseVersion(bad))
})

test('checks all frontend, Rust, Tauri and lockfile versions; enforces the stable 1.0 checklist', async (t) => {
  const currentVersion = JSON.parse(await readFile('package.json', 'utf8')).version
  assert.equal((await checkVersions()).version, currentVersion)
  const root = await mkdtemp(join(tmpdir(), 'repeaty-release-versions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = [
    'package.json',
    'package-lock.json',
    'src-tauri/tauri.conf.json',
    'docs/RELEASE_1_0.md',
    ...['server', 'src-tauri', 'crates/leetcode-local'].flatMap((directory) => [
      directory + '/Cargo.toml',
      directory + '/Cargo.lock',
    ]),
  ]
  for (const file of files) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await cp(file, join(root, file))
  }
  const original = await readFile(join(root, 'server/Cargo.toml'), 'utf8')
  await writeFile(
    join(root, 'server/Cargo.toml'),
    original.replace('version = "' + currentVersion + '"', 'version = "0.0.0-test.mismatch"'),
  )
  await assert.rejects(checkVersions(root), /server\/Cargo.toml/)
  await writeFile(join(root, 'server/Cargo.toml'), original)
  for (const file of files)
    await writeFile(
      join(root, file),
      (await readFile(join(root, file), 'utf8')).replaceAll(currentVersion, '1.0.0'),
    )
  await writeFile(join(root, 'docs/RELEASE_1_0.md'), '- [ ] Verify native installers\n')
  await assert.rejects(checkVersions(root), /Complete docs\/RELEASE_1_0.md/)
  await writeFile(join(root, 'docs/RELEASE_1_0.md'), '- [x] Verify native installers\n')
  assert.equal((await checkVersions(root)).version, '1.0.0')
  await writeFile(join(root, 'docs/RELEASE_1_0.md'), '- [ ] Verify native installers\n')
  for (const file of files)
    await writeFile(
      join(root, file),
      (await readFile(join(root, file), 'utf8')).replaceAll('1.0.0', '1.0.0-rc.1'),
    )
  assert.equal((await checkVersions(root)).prerelease, true)
})

test('selects only the same main commit, successful matrix jobs and their exact artifacts', async () => {
  const { api } = github()
  const plan = await prepareRelease(api, context, version)
  assert.equal(plan.publish, true)
  assert.equal(plan.sha, context.sha)
  assert.equal(plan.ciRunId, 200)
  assert.deepEqual(
    plan.artifacts.map((entry) => entry.id),
    [1, 2, 3],
  )
})

test('rejects failed checks, foreign PRs and missing or ambiguous artifacts before any writes', async (t) => {
  const cases = [
    [
      'pull request',
      (s) => {
        s.run.event = 'pull_request'
      },
    ],
    [
      'foreign repository',
      (s) => {
        s.run.head_repository.full_name = 'other/repo'
      },
    ],
    [
      'wrong commit',
      (s) => {
        s.run.head_sha = 'b'.repeat(40)
      },
    ],
    [
      'CI failure',
      (s) => {
        s.checks[0].conclusion = 'failure'
      },
    ],
    [
      'newer failed CI',
      (s) => {
        s.checks.push({ ...s.checks[0], id: 201, conclusion: 'failure' })
      },
    ],
    [
      'platform failure',
      (s) => {
        s.jobs[2].conclusion = 'failure'
      },
    ],
    [
      'missing platform',
      (s) => {
        s.jobs.pop()
      },
    ],
    [
      'missing artifact',
      (s) => {
        s.artifacts.pop()
      },
    ],
    [
      'duplicate artifact',
      (s) => {
        s.artifacts.push({ ...s.artifacts[0], id: 4 })
      },
    ],
    [
      'expired artifact',
      (s) => {
        s.artifacts[0].expired = true
      },
    ],
    [
      'foreign artifact',
      (s) => {
        s.artifacts[0].workflow_run.head_sha = 'b'.repeat(40)
      },
    ],
  ]
  for (const [name, mutate] of cases)
    await t.test(name, async () => {
      const { api, state } = github()
      mutate(state)
      await assert.rejects(prepareRelease(api, context, version))
      assert.equal(
        state.calls.some((call) => call.method !== 'GET'),
        false,
      )
    })
})

test('waits for CI and skips older main commits or an already published version', async () => {
  const { api, state } = github()
  state.checks[0].status = 'in_progress'
  assert.equal((await prepareRelease(api, context, version)).waiting, true)
  state.head = 'b'.repeat(40)
  assert.equal((await prepareRelease(api, context, version)).publish, false)
  state.head = context.sha
  state.release = { draft: false, html_url: 'existing' }
  const before = state.calls.length
  assert.equal((await prepareRelease(api, context, version)).url, 'existing')
  assert.equal(state.calls.length - before, 2)
})

test('requires three versioned architectures and builds checksums from the actual installer bytes', async (t) => {
  const directory = await installers(t)
  const assets = await installerFiles(directory, version)
  assert.equal(assets.length, 4)
  for (const asset of assets) assert.equal(asset.hash, hash(asset.bytes))
  const sums = assets.at(-1).bytes.toString()
  for (const asset of assets.slice(0, 3))
    assert.ok(sums.includes(asset.hash + '  ' + asset.name + '\n'))
  await assert.rejects(installerFiles(directory, '0.27.0'), /version or architecture/)
  await rm(join(directory, platforms[0].artifact), { recursive: true })
  await assert.rejects(installerFiles(directory, version), /three tested/)
})

test('rejects empty files and symlinks instead of publishing misleading installers', async (t) => {
  const directory = await installers(t)
  const path = join(
    directory,
    platforms[0].artifact,
    'bundle',
    'Repeaty_' + version + '_' + platforms[0].suffix,
  )
  await writeFile(path, '')
  await assert.rejects(installerFiles(directory, version), /empty/)
  await rm(path)
  await symlink('/etc/passwd', path)
  await assert.rejects(installerFiles(directory, version), /symlinks/)
})

test('publishes only after four uploads match GitHub checksums, and prereleases preserve Latest', async (t) => {
  for (const value of [version, '0.27.0-beta.1'])
    await t.test(value, async (t) => {
      const directory = await installers(t, value)
      const { api, state } = github()
      const plan = await prepareRelease(api, context, value)
      assert.equal((await publishRelease(api, context, plan, directory)).publish, true)
      assert.equal(state.release.draft, false)
      assert.equal(state.release.target_commitish, context.sha)
      assert.equal(state.release.prerelease, value.includes('-'))
      assert.equal(state.release.make_latest, value.includes('-') ? 'false' : 'true')
      assert.equal(state.uploads.length, 4)
      assert.ok(state.release.body.includes(marker))
      assert.ok(state.release.body.includes('未配置代码签名或公证'))
    })
})

test('keeps an upload failure as a draft and can resume an owned partial draft', async (t) => {
  const directory = await installers(t)
  const { api, state } = github()
  const plan = await prepareRelease(api, context, version)
  state.badDigest = true
  await assert.rejects(publishRelease(api, context, plan, directory), /checksum/)
  assert.equal(state.release.draft, true)
  assert.equal(
    state.calls.some((call) => call.method === 'PATCH'),
    false,
  )
  state.badDigest = false
  await publishRelease(api, context, plan, directory)
  assert.equal(state.release.draft, false)
  assert.equal(state.uploads.length, 4)
  assert.equal(
    state.calls.filter((call) => call.path === '/releases' && call.method === 'POST').length,
    1,
  )
})

test('refuses changed plans, conflicting tags or a draft owned by someone else', async (t) => {
  const directory = await installers(t)
  for (const kind of ['plan', 'tag', 'draft'])
    await t.test(kind, async () => {
      const { api, state } = github()
      const plan = await prepareRelease(api, context, version)
      if (kind === 'plan') plan.artifacts[0].id = 999
      if (kind === 'tag') state.tag = 'b'.repeat(40)
      if (kind === 'draft')
        state.release = {
          id: 500,
          draft: true,
          target_commitish: context.sha,
          body: 'A manual draft',
        }
      await assert.rejects(publishRelease(api, context, plan, directory))
      assert.equal(
        state.calls.some((call) => call.method !== 'GET'),
        false,
      )
    })
})

test('does not publish a draft if main advances while files are being uploaded', async (t) => {
  const directory = await installers(t)
  const { api, state } = github()
  const plan = await prepareRelease(api, context, version)
  state.advanceOnUpload = true
  await assert.rejects(publishRelease(api, context, plan, directory), /Main advanced/)
  assert.equal(state.release.draft, true)
  assert.equal(
    state.calls.some((call) => call.method === 'PATCH'),
    false,
  )
})

test('the HTTP adapter rejects redirects and never sends a token to a non-GitHub origin', async () => {
  const requests = []
  const api = githubApi(context.repository, 'test-token', async (url, options) => {
    requests.push({ url: String(url), ...options })
    return new Response('{}', { status: 200 })
  })
  await api('/git/ref/heads/main')
  assert.equal(requests[0].redirect, 'error')
  await assert.rejects(api('https://example.com/repos/KraHsu/repeaty/releases/1'))
  await assert.rejects(api('https://uploads.github.com/repos/other/repo/releases/1/assets'))
  assert.equal(requests.length, 1)
})
