import {
  createTransport,
  fingerprint,
  hasMarker,
  id,
  marked,
  parseXml,
  PartialMutation,
  record,
  RemoteRejected,
  responseError,
  safeUrl,
  xmlCall,
  type Adapter,
  type Catalog,
  type Connection,
  type Draft,
  type Native,
  type Remote,
  type XmlValue,
} from '@repeaty/publishing-client'

export function createWordPress(native: Native, connection: Connection): Adapter {
  const http = createTransport(native, connection)
  const endpoint = '/wp-json/wp/v2'
  const xml = connection.adapter === 'xmlrpc'
  async function rpc(method: string, args: XmlValue[], signal: AbortSignal, credentialsAt = 1) {
    const response = await http.request(
      '/xmlrpc.php',
      'POST',
      signal,
      undefined,
      xmlCall(method, args, credentialsAt),
    )
    if (response.status < 200 || response.status >= 300) throw responseError(response.status)
    return parseXml(response.body)
  }
  const blog = () => Number(id(connection.blogId ?? '1'))
  async function convert(value: unknown): Promise<Remote> {
    const post = record(value)
    const postId = id(xml ? post.post_id : post.id)
    const title = xml ? post.post_title : record(post.title).raw
    const content = xml ? post.post_content : record(post.content).raw
    if (typeof title !== 'string' || typeof content !== 'string')
      throw new Error('invalid-response')
    const categories =
      xml && Array.isArray(post.terms)
        ? post.terms
            .map(record)
            .filter((term) => term.taxonomy === 'category')
            .map((term) => id(term.term_id))
        : Array.isArray(post.categories)
          ? post.categories.map(id)
          : []
    const tags =
      xml && Array.isArray(post.terms)
        ? post.terms
            .map(record)
            .filter((term) => term.taxonomy === 'post_tag')
            .map((term) => id(term.term_id))
        : Array.isArray(post.tags)
          ? post.tags.map(id)
          : []
    const status = String(xml ? post.post_status : post.status)
    const output = {
      id: postId,
      title,
      content,
      status,
      category: categories[0] ?? '',
      tags: tags.sort(),
      url: safeUrl(post.link, connection.site),
    }
    return { ...output, revision: await fingerprint([output, [...categories].sort()]) }
  }
  async function read(postId: string, signal: AbortSignal) {
    try {
      const value = xml
        ? await rpc('wp.getPost', [blog(), Number(id(postId))], signal)
        : await http.json(`${endpoint}/posts/${id(postId)}?context=edit`, 'GET', signal)
      return value === null ? null : convert(value)
    } catch (error) {
      if (error instanceof RemoteRejected && error.status === 404) return null
      throw error
    }
  }
  async function verify(signal: AbortSignal) {
    if (xml) {
      const blogs = await rpc('wp.getUsersBlogs', [], signal, 0)
      if (!Array.isArray(blogs)) throw new Error('site-not-authorized')
      const selected = blogs.map(record).find((entry) => {
        try {
          return (
            safeUrl(entry.url, connection.site).replace(/\/+$/, '') === connection.site &&
            (!connection.blogId || String(entry.blogid) === connection.blogId)
          )
        } catch {
          return false
        }
      })
      if (!selected) throw new Error('site-not-authorized')
      connection.blogId = id(selected.blogid)
    } else {
      const user = record(await http.json(`${endpoint}/users/me?context=edit`, 'GET', signal))
      id(user.id)
    }
  }
  async function catalog(signal: AbortSignal): Promise<Catalog> {
    async function terms(taxonomy: 'category' | 'post_tag') {
      const values: { id: string; name: string }[] = []
      for (let page = 1; page <= 10; page++) {
        let response: unknown
        let finalPage = false
        if (xml)
          response = await rpc(
            'wp.getTerms',
            [blog(), taxonomy, { number: 100, offset: (page - 1) * 100 }],
            signal,
          )
        else {
          const result = await http.request(
            `${endpoint}/${taxonomy === 'category' ? 'categories' : 'tags'}?per_page=100&page=${page}&context=edit`,
            'GET',
            signal,
          )
          if (result.status < 200 || result.status >= 300) throw responseError(result.status)
          try {
            response = JSON.parse(result.body)
          } catch {
            throw new Error('invalid-response')
          }
          const total = Number(result.headers['x-wp-totalpages'])
          finalPage = Number.isSafeInteger(total) && total >= 0 && page >= total
        }
        if (!Array.isArray(response)) throw new Error('invalid-response')
        for (const item of response) {
          const term = record(item)
          if (typeof term.name !== 'string') throw new Error('invalid-response')
          values.push({ id: id(xml ? term.term_id : term.id), name: term.name })
        }
        if (response.length < 100 || finalPage) return values
      }
      throw new Error('catalog-limit')
    }
    return { categories: await terms('category'), tags: await terms('post_tag') }
  }
  async function find(marker: string, signal: AbortSignal): Promise<Remote | null> {
    if (!xml) {
      const items = await http.json(
        `${endpoint}/posts?context=edit&slug=${encodeURIComponent(marker)}&status=publish,draft,private,pending,future,trash`,
        'GET',
        signal,
      )
      if (!Array.isArray(items) || items.length > 1) throw new Error('remote-binding-mismatch')
      return items.length ? convert(items[0]) : null
    }
    // Search the exact marker before pagination. XML-RPC filters edit permissions after
    // paging, so scanning all recent site posts can truncate an author's visible history.
    let found: Remote | null = null
    for (let page = 0; page < 10; page++) {
      const items = await rpc(
        'wp.getPosts',
        [blog(), { post_type: 'post', s: marker, number: 100, offset: page * 100 }],
        signal,
      )
      if (!Array.isArray(items)) throw new Error('invalid-response')
      for (const item of items) {
        const content = record(item).post_content
        if (typeof content === 'string' && hasMarker(content, marker)) {
          if (found) throw new Error('remote-binding-mismatch')
          found = await convert(item)
        }
      }
      if (items.length < 100) return found
    }
    throw new Error('catalog-limit')
  }
  async function save(draft: Draft, marker: string, signal: AbortSignal, postId?: string) {
    const content = marked(draft.content, marker)
    if (xml) {
      const fields = {
        post_title: draft.title,
        post_content: content,
        post_status: draft.status,
        post_type: 'post',
        post_name: marker,
        terms: {
          category: draft.category ? [Number(id(draft.category))] : [],
          post_tag: draft.tags.map((tag) => Number(id(tag))),
        },
      }
      const result = postId
        ? await rpc('wp.editPost', [blog(), Number(id(postId)), fields], signal)
        : await rpc('wp.newPost', [blog(), fields], signal)
      try {
        if (postId && result !== true) throw new Error('invalid-response')
        const remote = await read(postId ?? id(result), signal)
        if (!remote) throw new Error('remote-missing')
        return remote
      } catch {
        throw new PartialMutation()
      }
    }
    const data = {
      title: draft.title,
      content,
      status: draft.status,
      slug: marker,
      categories: draft.category ? [Number(id(draft.category))] : [],
      tags: draft.tags.map((tag) => Number(id(tag))),
    }
    const response = await http.json(
      `${endpoint}/posts${postId ? `/${id(postId)}` : ''}`,
      'POST',
      signal,
      data,
    )
    try {
      if (!response) throw new Error('remote-missing')
      // Creation often returns view-context HTML, so reread edit context for ownership and revision.
      const remote = await read(id(record(response).id), signal)
      if (!remote) throw new Error('remote-missing')
      return remote
    } catch {
      throw new PartialMutation()
    }
  }
  return {
    provider: 'wordpress',
    connection,
    verify,
    catalog,
    find,
    read,
    create: (draft, marker, signal) => save(draft, marker, signal),
    update: (remote, draft, marker, signal) => save(draft, marker, signal, remote.id),
    async remove(remote, signal) {
      if (xml) {
        if ((await rpc('wp.deletePost', [blog(), Number(id(remote.id))], signal)) !== true)
          throw new Error('invalid-response')
      } else {
        const result = await http.json(
          `${endpoint}/posts/${id(remote.id)}?force=false`,
          'DELETE',
          signal,
        )
        if (result === null) throw new Error('remote-missing')
      }
    },
  }
}
