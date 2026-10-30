import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import {
  file,
  hash,
  escape,
  publicUrl,
  validPath,
  limits,
  encoder,
  type PublishSource,
  type SiteBuild,
  type SiteIndex,
  type SiteOptions,
  type SiteTheme,
  type PublicField,
} from './model'
import { renderSource } from './render'
import { renderTemplate } from './template'

function text(html: string) {
  let result = ''
  const walk = (node: DefaultTreeAdapterMap['node']) => {
    if ('tagName' in node && node.tagName === 'annotation') return
    if (node.nodeName === '#text' && 'value' in node) result += node.value + ' '
    if ('childNodes' in node) node.childNodes.forEach(walk)
  }
  walk(parseFragment(html))
  return result.replace(/\s+/gu, ' ').trim()
}
interface Topic {
  id: string
  path: string
  title: string
  published_at: string
  updated_at: string
  content: string
  excerpt: string
  fields: PublicField[]
  searchText: string
}
function safeFields(input: PublicField[]) {
  if (input.length > 64) throw new Error('公开字段不能超过 64 项。')
  return input.map(({ key, values }) => {
    if (
      !key ||
      key.length > 100 ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      values.length > 100 ||
      values.some((value) => typeof value !== 'string' || value.length > 4000)
    )
      throw new Error('公开字段格式无效。')
    return { key, values: [...values] }
  })
}
export async function generateSite(
  input: {
    sources: PublishSource[]
    index: SiteIndex
    options: SiteOptions
    theme: SiteTheme
    now?: string
  },
  progress: (completed: number, total: number) => void = () => {},
): Promise<SiteBuild> {
  const now = input.now ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(now))) throw new Error('生成时间无效。')
  if (
    input.sources.length > limits.sources ||
    new Set(input.sources.map((item) => item.id)).size !== input.sources.length
  )
    throw new Error('单个站点最多发布 500 篇不同材料。')
  const options = input.options
  if (
    !options.title.trim() ||
    options.title.length > 160 ||
    options.description.length > 1000 ||
    !Number.isInteger(options.pageSize) ||
    options.pageSize < 1 ||
    options.pageSize > 50
  )
    throw new Error('请检查站点标题、说明和每页数量。')
  const address = publicUrl(options.url)
  const theme = input.theme
  for (const [key, value] of Object.entries(theme))
    if (typeof value !== 'string' || encoder.encode(value).length > limits.themeBytes)
      throw new Error(`${key} 超过主题大小限制。`)
  const index: SiteIndex = structuredClone(input.index)
  if (
    index.version !== 1 ||
    !Number.isSafeInteger(index.nextId) ||
    index.nextId < 1 ||
    index.bindings.length > 10_000 ||
    new Set(index.bindings.map((item) => item.publicId)).size !== index.bindings.length ||
    new Set(index.bindings.map((item) => item.sourceId)).size !== index.bindings.length ||
    index.bindings.some(
      (item) =>
        !Number.isSafeInteger(item.publicId) ||
        item.publicId < 1 ||
        item.publicId >= index.nextId ||
        !Number.isFinite(Date.parse(item.publishedAt)) ||
        !Number.isFinite(Date.parse(item.updatedAt)),
    )
  )
    throw new Error('本地发布记录无效，请保留数据并恢复之前的备份。')
  for (const binding of index.bindings) binding.active = false
  const files = new Map<string, ReturnType<typeof file>>()
  let total = 0
  const put = (item: ReturnType<typeof file>) => {
    if (!validPath(item.path) || item.bytes.length > limits.fileBytes || files.size >= limits.files)
      throw new Error('生成文件的路径或大小超出限制。')
    const previous = files.get(item.path)
    if (previous) {
      if (
        previous.type !== item.type ||
        previous.bytes.length !== item.bytes.length ||
        previous.bytes.some((byte, i) => byte !== item.bytes[i])
      )
        throw new Error('发布附件的目标路径冲突。')
      return
    }
    total += item.bytes.length
    if (total > limits.totalBytes) throw new Error('站点超过 64 MiB，请减少材料或附件。')
    files.set(item.path, item)
  }
  const sourceMap = new Map(input.sources.map((item) => [item.id, item]))
  const titles = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const source of input.sources) {
    if (encoder.encode(source.text).length > limits.sourceBytes)
      throw new Error(`「${source.title}」正文超过 4 MiB。`)
    if (titles.has(source.title)) ambiguous.add(source.title)
    else titles.set(source.title, source.id)
    let binding = index.bindings.find((item) => item.sourceId === source.id)
    const contentHash = await hash(
      JSON.stringify({
        title: source.title,
        text: source.text,
        format: source.format,
        fields: safeFields(source.fields),
        resources: await Promise.all(
          source.resources.map(async (item) => ({
            reference: item.reference,
            hash: await hash(item.file.bytes),
          })),
        ),
        links: source.links ?? [],
      }),
    )
    if (!binding) {
      binding = {
        sourceId: source.id,
        publicId: index.nextId++,
        versionId: source.versionId,
        contentHash,
        publishedAt: now,
        updatedAt: now,
        title: source.title,
        active: true,
      }
      index.bindings.push(binding)
      if (index.bindings.length > 10_000) throw new Error('站点历史文章记录超过 10000 条限制。')
    } else {
      if (binding.contentHash !== contentHash) binding.updatedAt = now
      binding.versionId = source.versionId
      binding.contentHash = contentHash
      binding.title = source.title
      binding.active = true
    }
    for (const resource of source.resources) {
      if (
        !resource.file.path.startsWith('assets/') ||
        !/^(image\/(png|jpeg|gif|webp|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/pdf)$/iu.test(
          resource.file.type,
        )
      )
        throw new Error('只允许发布选定材料引用的图片、音视频和 PDF 附件。')
      put(resource.file)
    }
  }
  for (const title of ambiguous) titles.delete(title)
  const active = index.bindings
    .filter((item) => item.active)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.publicId - a.publicId)
  const paths = new Map(
    active.map((item) => [item.sourceId, `articles/${item.publicId}/index.html`]),
  )
  const topics: Topic[] = active.map((binding) => {
    const source = sourceMap.get(binding.sourceId)!
    const content = renderSource(source, paths, titles, '../../')
    const searchText = text(content)
    return {
      id: String(binding.publicId),
      path: paths.get(binding.sourceId)!,
      title: source.title,
      published_at: binding.publishedAt,
      updated_at: binding.updatedAt,
      content,
      excerpt: searchText.slice(0, 180),
      fields: safeFields(source.fields),
      searchText,
    }
  })
  const publicTopics = topics.map(({ searchText: _searchText, ...topic }) => topic)
  const site = {
    title: options.title,
    description: options.description,
    url: address,
    home_url: 'index.html',
    archive_url: 'archive/index.html',
    rss_url: 'feed.xml',
    tags_url: 'tags/index.html',
    categories_url: 'categories/index.html',
    search_url: 'search/index.html',
    topics: publicTopics,
  }
  const pages: SiteBuild['pages'] = []
  const page = (path: string, title: string, values: Record<string, unknown>) => {
    const depth = '../'.repeat(path.split('/').length - 1)
    const scope = {
      site,
      page: {
        kind: 'topic',
        view: 'home',
        id: null,
        title,
        depth,
        is_home: path === 'index.html',
        content: '',
        published_at: null,
        updated_at: null,
        fields: [],
        has_visible_fields: false,
        topics: [],
        groups: [],
        terms: [],
        newer: null,
        older: null,
        newer_url: null,
        older_url: null,
        previous_page_url: null,
        next_page_url: null,
        home_url: depth + site.home_url,
        archive_url: depth + site.archive_url,
        rss_url: depth + site.rss_url,
        tags_url: depth + site.tags_url,
        categories_url: depth + site.categories_url,
        search_url: depth + site.search_url,
        ...values,
      },
    }
    put(
      file(
        path,
        'text/html; charset=utf-8',
        renderTemplate(
          values.view === 'archive' ? theme.archive : theme.page,
          scope,
          values.view === 'archive' ? 'archive.html' : 'page.html',
        ),
      ),
    )
    pages.push({ path, title })
    progress(pages.length, topics.length + Math.ceil(topics.length / options.pageSize) + 6)
  }
  const pageCount = Math.max(1, Math.ceil(topics.length / options.pageSize))
  const home = (number: number) => (number === 1 ? 'index.html' : `page/${number}/index.html`)
  for (let i = 1; i <= pageCount; i++) {
    const depth = i === 1 ? '' : '../../'
    page(home(i), options.title, {
      topics: publicTopics.slice((i - 1) * options.pageSize, i * options.pageSize),
      previous_page_url: i > 1 ? depth + home(i - 1) : null,
      next_page_url: i < pageCount ? depth + home(i + 1) : null,
    })
  }
  topics.forEach((topic, i) =>
    page(topic.path, topic.title, {
      ...publicTopics[i],
      view: 'article',
      has_visible_fields: topic.fields.some((field) => field.values.length),
      newer: topics[i - 1]
        ? { title: topics[i - 1]!.title, url: '../../' + topics[i - 1]!.path }
        : null,
      older: topics[i + 1]
        ? { title: topics[i + 1]!.title, url: '../../' + topics[i + 1]!.path }
        : null,
      newer_url: topics[i - 1] ? '../../' + topics[i - 1]!.path : null,
      older_url: topics[i + 1] ? '../../' + topics[i + 1]!.path : null,
    }),
  )
  page('archive/index.html', '文章归档', {
    kind: 'archive',
    view: 'archive',
    topics: publicTopics,
    groups: [...new Set(topics.map((item) => item.updated_at.slice(0, 4)))].map((year) => ({
      label: year,
      topics: publicTopics.filter((item) => item.updated_at.startsWith(year)),
    })),
  })
  for (const [key, directory, label] of [
    ['tags', 'tags', '标签'],
    ['category', 'categories', '分类'],
  ] as const) {
    const terms = new Map<
      string,
      { name: string; path: string; count: number; topics: typeof publicTopics }
    >()
    for (const topic of publicTopics)
      for (const value of new Set(
        topic.fields
          .filter((field) => field.key.toLowerCase() === key)
          .flatMap((field) => field.values),
      )) {
        const folded = value.trim().normalize('NFKC').toLocaleLowerCase()
        if (!folded) continue
        const term = terms.get(folded) ?? {
          name: value,
          path: `${directory}/${(await hash(folded)).slice(0, 20)}/index.html`,
          count: 0,
          topics: [],
        }
        term.count++
        term.topics.push(topic)
        terms.set(folded, term)
      }
    const ordered = [...terms.values()].sort((a, b) => a.name.localeCompare(b.name))
    page(`${directory}/index.html`, label, {
      view: directory,
      terms: ordered.map(({ topics: _topics, ...term }) => term),
    })
    for (const term of ordered)
      page(term.path, term.name, { view: key === 'tags' ? 'tag' : 'category', topics: term.topics })
  }
  page('search/index.html', '搜索文章', { view: 'search' })
  const search = topics.map((topic) => ({
    title: topic.title,
    path: topic.path,
    text: topic.searchText,
    fields: topic.fields.flatMap((item) => [item.key, ...item.values]).join(' '),
  }))
  put(
    file(
      'search-index.js',
      'text/javascript; charset=utf-8',
      `window.__REPEATY_PUBLIC_SEARCH__=${JSON.stringify(search).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')};`,
    ),
  )
  put(file('style.css', 'text/css; charset=utf-8', theme.css))
  put(file('site.js', 'text/javascript; charset=utf-8', theme.script))
  put(
    file(
      'feed.xml',
      'application/rss+xml; charset=utf-8',
      `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escape(options.title)}</title><link>${escape(address)}</link><description>${escape(options.description)}</description>${topics.map((topic) => `<item><title>${escape(topic.title)}</title><link>${escape(new URL(topic.path, address).href)}</link><guid isPermaLink="true">${escape(new URL(topic.path, address).href)}</guid><pubDate>${new Date(topic.published_at).toUTCString()}</pubDate><description>${escape(topic.excerpt)}</description></item>`).join('')}</channel></rss>`,
    ),
  )
  put(
    file(
      'sitemap.xml',
      'application/xml; charset=utf-8',
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((item) => `<url><loc>${escape(new URL(item.path, address).href)}</loc></url>`).join('')}</urlset>`,
    ),
  )
  const orderedFiles = [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
  const fingerprint = await hash(
    JSON.stringify(
      await Promise.all(
        orderedFiles.map(async (item) => [item.path, item.type, await hash(item.bytes)]),
      ),
    ),
  )
  return { files: orderedFiles, index, pages, generatedAt: now, fingerprint }
}
