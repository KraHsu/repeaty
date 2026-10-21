import { createHash } from 'node:crypto'
import { appendFile, lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

export const platforms = [
  { artifact: 'repeaty-ubuntu-24.04', job: 'Desktop (ubuntu-24.04)', suffix: 'amd64.deb' },
  { artifact: 'repeaty-windows-latest', job: 'Desktop (windows-latest)', suffix: 'x64-setup.exe' },
  { artifact: 'repeaty-macos-latest', job: 'Desktop (macos-latest)', suffix: 'aarch64.dmg' },
]

export function parseVersion(version) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version,
    )
  if (!match || match[4]?.split('.').some((part) => /^\d+$/.test(part) && /^0\d/.test(part)))
    throw new Error('Invalid release version: ' + version)
  return { version, core: match.slice(1, 4).join('.'), prerelease: Boolean(match[4]) }
}

function cargoVersion(text, name, lock = false) {
  const sections = lock
    ? text.split(/^\[\[package\]\]\s*$/m).slice(1)
    : text.split(/^\[/m).filter((part) => /^package\]\r?\n/.test(part))
  const matching = sections.filter((part) => /^name\s*=\s*"([^"]+)"/m.exec(part)?.[1] === name)
  if (matching.length !== 1) throw new Error('Missing or duplicate Cargo package: ' + name)
  return /^version\s*=\s*"([^"]+)"/m.exec(matching[0])?.[1]
}

export async function checkVersions(root = '.') {
  const json = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'))
  const packageJson = await json('package.json')
  const version = packageJson.version
  const parsed = parseVersion(version)
  const lock = await json('package-lock.json')
  const versions = [
    ['package-lock.json', lock.version],
    ['package-lock.json packages[""]', lock.packages[''].version],
    ['src-tauri/tauri.conf.json', (await json('src-tauri/tauri.conf.json')).version],
  ]
  for (const [directory, name] of [
    ['server', 'repeaty-server'],
    ['src-tauri', 'repeaty-desktop'],
    ['crates/leetcode-local', 'repeaty-leetcode-local'],
  ]) {
    for (const extension of ['toml', 'lock']) {
      const path = directory + '/Cargo.' + extension
      versions.push([
        path,
        cargoVersion(await readFile(join(root, path), 'utf8'), name, extension === 'lock'),
      ])
    }
  }
  // The desktop lockfile also embeds the local plugin's package version.
  versions.push([
    'src-tauri/Cargo.lock local plugin',
    cargoVersion(
      await readFile(join(root, 'src-tauri/Cargo.lock'), 'utf8'),
      'repeaty-leetcode-local',
      true,
    ),
  ])
  for (const [path, actual] of versions)
    if (actual !== version) throw new Error(path + ': expected ' + version + ', found ' + actual)
  if (parsed.core === '1.0.0' && !parsed.prerelease) {
    const checklist = await readFile(join(root, 'docs/RELEASE_1_0.md'), 'utf8')
    if (/^-\s+\[ \]/m.test(checklist) || !/^-\s+\[x\]/m.test(checklist))
      throw new Error('Complete docs/RELEASE_1_0.md before publishing stable v1.0.0')
  }
  return parsed
}

export function githubApi(repository, token, fetcher = fetch) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !token)
    throw new Error('A GitHub repository and token are required')
  return async (path, { method = 'GET', body, binary, missing = false } = {}) => {
    const url = path.startsWith('https:')
      ? new URL(path)
      : new URL('https://api.github.com/repos/' + repository + path)
    if (url.origin !== 'https://api.github.com' && url.origin !== 'https://uploads.github.com')
      throw new Error('Unexpected GitHub API origin')
    if (!url.pathname.startsWith('/repos/' + repository + '/'))
      throw new Error('Unexpected GitHub repository')
    const response = await fetcher(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        ...(body === undefined && binary === undefined
          ? {}
          : { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' }),
      },
      body: binary ?? (body === undefined ? undefined : JSON.stringify(body)),
    })
    if (missing && method === 'GET' && response.status === 404) return undefined
    if (!response.ok)
      throw new Error('GitHub ' + method + ' ' + url.pathname + ': HTTP ' + response.status)
    return response.status === 204 ? undefined : response.json()
  }
}

function trustedRun(run, context, workflow) {
  if (
    run.head_sha !== context.sha ||
    run.head_branch !== 'main' ||
    run.head_repository?.full_name !== context.repository ||
    !['push', 'workflow_dispatch'].includes(run.event) ||
    run.path?.split('@')[0] !== '.github/workflows/' + workflow
  )
    throw new Error('Refusing artifacts or checks from an unrelated or untrusted workflow run')
}

export async function prepareRelease(api, context, version) {
  const parsed = parseVersion(version)
  const head = await api('/git/ref/heads/main')
  if (head.object.sha !== context.sha)
    return { publish: false, reason: 'A newer main commit will handle the release.' }
  const tag = 'v' + version
  const existing = await api('/releases/tags/' + tag, { missing: true })
  if (existing && !existing.draft)
    return {
      publish: false,
      reason: tag + ' is already published; its assets will not be overwritten.',
      url: existing.html_url,
    }
  const run = await api('/actions/runs/' + context.runId)
  trustedRun(run, context, 'desktop.yml')
  const [checks, jobs, artifacts] = await Promise.all([
    api('/actions/workflows/ci.yml/runs?branch=main&head_sha=' + context.sha + '&per_page=100'),
    api('/actions/runs/' + context.runId + '/jobs?filter=latest&per_page=100'),
    api('/actions/runs/' + context.runId + '/artifacts?per_page=100'),
  ])
  const ci = checks.workflow_runs
    .filter(
      (entry) =>
        entry.head_sha === context.sha &&
        entry.head_branch === 'main' &&
        ['push', 'workflow_dispatch'].includes(entry.event),
    )
    .sort((a, b) => b.id - a.id)[0]
  if (!ci || ci.status !== 'completed')
    return { waiting: true, reason: 'Waiting for CI on ' + context.sha }
  trustedRun(ci, context, 'ci.yml')
  if (ci.conclusion !== 'success') throw new Error('CI for this commit did not succeed')
  const selected = platforms.map((platform) => {
    const builds = jobs.jobs.filter((job) => job.name === platform.job)
    if (
      builds.length !== 1 ||
      builds[0].status !== 'completed' ||
      builds[0].conclusion !== 'success'
    )
      throw new Error('Installer build did not succeed: ' + platform.job)
    const files = artifacts.artifacts.filter((artifact) => artifact.name === platform.artifact)
    if (
      files.length !== 1 ||
      files[0].expired ||
      files[0].size_in_bytes <= 0 ||
      !Number.isSafeInteger(files[0].id) ||
      files[0].id <= 0
    )
      throw new Error('Missing, expired or ambiguous artifact: ' + platform.artifact)
    if (files[0].workflow_run && files[0].workflow_run.head_sha !== context.sha)
      throw new Error('Artifact commit does not match the tested commit')
    return { name: platform.artifact, id: files[0].id }
  })
  return {
    ...context,
    version,
    tag,
    prerelease: parsed.prerelease,
    ciRunId: ci.id,
    artifacts: selected,
    publish: true,
  }
}

export async function installerFiles(directory, version) {
  const files = []
  const scan = async (path) => {
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('Release artifacts cannot contain symlinks')
    if (info.isDirectory()) {
      for (const name of await readdir(path)) await scan(join(path, name))
    } else if (info.isFile() && info.size > 0) files.push(path)
    else throw new Error('Invalid or empty release asset: ' + path)
  }
  const names = (await readdir(directory)).sort()
  if (JSON.stringify(names) !== JSON.stringify(platforms.map((p) => p.artifact).sort()))
    throw new Error('Expected exactly the three tested platform artifacts')
  const assets = []
  for (const platform of platforms) {
    files.length = 0
    await scan(join(directory, platform.artifact))
    const name = 'Repeaty_' + version + '_' + platform.suffix
    if (files.length !== 1 || basename(files[0]) !== name)
      throw new Error('Unexpected installer version or architecture: ' + platform.artifact)
    const bytes = await readFile(files[0])
    assets.push({ name, bytes, hash: createHash('sha256').update(bytes).digest('hex') })
  }
  const sums =
    assets
      .map(({ name, hash }) => hash + '  ' + name)
      .sort()
      .join('\n') + '\n'
  const bytes = Buffer.from(sums)
  assets.push({ name: 'SHA256SUMS', bytes, hash: createHash('sha256').update(bytes).digest('hex') })
  return assets
}

async function checkTag(api, tag, sha) {
  let ref = await api('/git/ref/tags/' + tag, { missing: true })
  if (!ref) return
  ref = ref.object
  for (let depth = 0; ref.type === 'tag' && depth < 10; depth++)
    ref = (await api('/git/tags/' + ref.sha)).object
  if (ref.type !== 'commit' || ref.sha !== sha)
    throw new Error('Existing tag points at another commit')
}

export async function publishRelease(api, context, plan, directory) {
  const fresh = await prepareRelease(api, context, plan.version)
  if (!fresh.publish) {
    if (fresh.waiting) throw new Error(fresh.reason)
    return fresh
  }
  for (const key of ['repository', 'sha', 'runId', 'version', 'tag', 'ciRunId', 'prerelease'])
    if (plan[key] !== fresh[key]) throw new Error('Release plan changed; rerun preparation')
  if (JSON.stringify(plan.artifacts) !== JSON.stringify(fresh.artifacts))
    throw new Error('Installer artifacts changed; rerun preparation')
  const assets = await installerFiles(directory, plan.version)
  await checkTag(api, plan.tag, plan.sha)
  const marker = '<!-- repeaty-release:' + plan.sha + ' -->'
  let release = await api('/releases/tags/' + plan.tag, { missing: true })
  if (release) {
    if (!release.draft)
      return { publish: false, url: release.html_url, reason: 'Already published.' }
    if (release.target_commitish !== plan.sha || !release.body?.includes(marker))
      throw new Error('An existing draft was not created by this release run')
  } else {
    const notes = await api('/releases/generate-notes', {
      method: 'POST',
      body: { tag_name: plan.tag, target_commitish: plan.sha },
    })
    release = await api('/releases', {
      method: 'POST',
      body: {
        tag_name: plan.tag,
        target_commitish: plan.sha,
        name: 'Repeaty ' + plan.version,
        draft: true,
        prerelease: plan.prerelease,
        body:
          notes.body +
          '\n\n### 安装包\n\nLinux x86_64（.deb）、Windows x64（.exe）、macOS Apple Silicon（.dmg）。Windows / macOS 安装包未配置代码签名或公证。\n\n升级前请导出完整备份；账户服务另备份数据目录。已知限制见 [发布清单](https://github.com/' +
          plan.repository +
          '/blob/' +
          plan.sha +
          '/docs/RELEASE_1_0.md)。\n\nSHA256SUMS 用于校验下载文件。构建与测试提交：[' +
          plan.sha.slice(0, 7) +
          '](https://github.com/' +
          plan.repository +
          '/commit/' +
          plan.sha +
          ')。\n\n' +
          marker,
      },
    })
  }
  const prior = await api('/releases/' + release.id + '/assets?per_page=100')
  if (prior.some((entry) => !assets.some((asset) => asset.name === entry.name)))
    throw new Error('Draft contains unrelated assets; leave them for manual review')
  for (const entry of prior) await api('/releases/assets/' + entry.id, { method: 'DELETE' })
  const upload = release.upload_url.replace(/\{.*$/, '')
  for (const asset of assets) {
    const uploaded = await api(upload + '?name=' + encodeURIComponent(asset.name), {
      method: 'POST',
      binary: asset.bytes,
    })
    if (uploaded.size !== asset.bytes.length || uploaded.digest !== 'sha256:' + asset.hash)
      throw new Error('Uploaded asset checksum does not match: ' + asset.name)
    console.log('Verified upload: ' + asset.name)
  }
  const uploaded = await api('/releases/' + release.id + '/assets?per_page=100')
  if (
    uploaded.length !== assets.length ||
    assets.some(
      (asset) =>
        !uploaded.some(
          (entry) =>
            entry.name === asset.name &&
            entry.state === 'uploaded' &&
            entry.size === asset.bytes.length &&
            entry.digest === 'sha256:' + asset.hash,
        ),
    )
  )
    throw new Error('Release assets are incomplete or their checksums differ')
  if ((await api('/git/ref/heads/main')).object.sha !== plan.sha)
    throw new Error('Main advanced during upload; keep this release as a draft')
  await checkTag(api, plan.tag, plan.sha)
  const published = await api('/releases/' + release.id, {
    method: 'PATCH',
    body: {
      draft: false,
      prerelease: plan.prerelease,
      make_latest: plan.prerelease ? 'false' : 'true',
    },
  })
  return { publish: true, url: published.html_url }
}

async function main() {
  const [command, planPath, directory] = process.argv.slice(2)
  const { version } = await checkVersions()
  if (command === 'check') {
    console.log('Release metadata agrees: ' + version)
    return
  }
  if (!['prepare', 'publish', 'plan'].includes(command))
    throw new Error(
      'Usage: release.mjs check | plan | prepare <plan.json> | publish <plan.json> <installers>',
    )
  const context = {
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    runId: Number(process.env.GITHUB_RUN_ID),
  }
  if (
    !/^[a-f0-9]{40}$/.test(context.sha) ||
    !Number.isSafeInteger(context.runId) ||
    context.runId <= 0
  )
    throw new Error('A tested commit and desktop workflow run are required')
  if (
    command !== 'plan' &&
    (process.env.GITHUB_REF !== 'refs/heads/main' ||
      !['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME))
  )
    throw new Error('Only a trusted main push or main workflow dispatch can publish')
  const api = githubApi(context.repository, process.env.GH_TOKEN || process.env.GITHUB_TOKEN)
  let result
  if (command === 'publish') {
    const plan = JSON.parse(await readFile(planPath, 'utf8'))
    if (plan.version !== version) throw new Error('Release metadata changed')
    result = await publishRelease(api, context, plan, directory)
  } else {
    const deadline = Date.now() + 30 * 60_000
    do {
      result = await prepareRelease(api, context, version)
      if (!result.waiting || command === 'plan') break
      if (Date.now() >= deadline) throw new Error('Timed out waiting for CI')
      console.log(result.reason)
      await sleep(15_000)
    } while (true)
    if (command === 'prepare') {
      await writeFile(planPath, JSON.stringify(result), { mode: 0o600 })
      if (process.env.GITHUB_OUTPUT)
        await appendFile(
          process.env.GITHUB_OUTPUT,
          'publish=' +
            Boolean(result.publish) +
            '\nartifact_ids=' +
            (result.artifacts?.map((a) => a.id).join(',') ?? '') +
            '\n',
        )
    }
  }
  console.log(JSON.stringify(result))
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      result.url
        ? '[Release](' + result.url + ')\n'
        : (result.reason ?? 'Verified ' + result.tag) + '\n',
    )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
