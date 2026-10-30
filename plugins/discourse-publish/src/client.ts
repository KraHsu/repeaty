import {
  createTransport,
  fingerprint,
  hasMarker,
  id,
  marked,
  PartialMutation,
  record,
  safeUrl,
  type Adapter,
  type Catalog,
  type Connection,
  type Draft,
  type Native,
  type Remote,
} from '@repeaty/publishing-client'

export function createDiscourse(native: Native, connection: Connection): Adapter {
  const http = createTransport(native, connection)
  async function convert(postValue: unknown, signal: AbortSignal): Promise<Remote> {
    const post = record(postValue)
    const postId = id(post.id)
    const topicId = id(post.topic_id)
    if (typeof post.raw !== 'string' || post.post_number !== 1) throw new Error('invalid-response')
    const topic = record(await http.json(`/t/${topicId}.json`, 'GET', signal))
    if (id(topic.id) !== topicId || typeof topic.title !== 'string')
      throw new Error('invalid-response')
    const tags = Array.isArray(topic.tags)
      ? topic.tags.map((tag) => (typeof tag === 'string' ? tag : String(record(tag).name ?? '')))
      : []
    const result = {
      id: postId,
      topicId,
      title: topic.title,
      content: post.raw,
      status:
        topic.deleted_at || post.deleted_at
          ? 'deleted'
          : topic.visible === false
            ? 'unlisted'
            : 'publish',
      category: topic.category_id ? id(topic.category_id) : '',
      tags: tags.sort(),
      url: safeUrl(`/t/${topicId}`, connection.site),
    }
    return { ...result, revision: await fingerprint([result, post.version, topic.last_posted_at]) }
  }
  async function read(postId: string, signal: AbortSignal) {
    const value = await http.json(`/posts/${id(postId)}.json`, 'GET', signal)
    return value === null ? null : convert(value, signal)
  }
  async function find(marker: string, signal: AbortSignal) {
    // User API keys cannot set external_id (reserved for administrator API keys).
    // Read the owner's topic activity and inspect raw first posts instead of trusting search excerpts.
    const session = record(await http.json('/session/current.json', 'GET', signal))
    const username = record(session.current_user).username
    if (typeof username !== 'string' || !username) throw new Error('site-not-authorized')
    const seen = new Set<string>()
    let found: Remote | null = null
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = record(
        await http.json(
          `/user_actions.json?username=${encodeURIComponent(username)}&filter=4&offset=${offset}&limit=100`,
          'GET',
          signal,
        ),
      )
      if (!Array.isArray(page.user_actions) || page.user_actions.length > 100)
        throw new Error('invalid-response')
      for (const value of page.user_actions) {
        const action = record(value)
        let postId: string
        if (action.post_id == null) {
          const topic = record(await http.json(`/t/${id(action.topic_id)}.json`, 'GET', signal))
          const stream = record(topic.post_stream)
          const first = Array.isArray(stream.posts)
            ? stream.posts.map(record).find((post) => post.post_number === 1)
            : undefined
          if (!first) throw new Error('invalid-response')
          postId = id(first.id)
        } else postId = id(action.post_id)
        if (seen.has(postId)) throw new Error('remote-changed')
        seen.add(postId)
        const remote = await read(postId, signal)
        if (!remote) throw new Error('remote-unconfirmed')
        if (hasMarker(remote.content, marker)) {
          if (found) throw new Error('remote-binding-mismatch')
          found = remote
        }
      }
      if (page.user_actions.length < 100) return found
    }
    throw new Error('catalog-limit')
  }
  async function catalog(signal: AbortSignal): Promise<Catalog> {
    const category = record(
      await http.json('/categories.json?include_subcategories=true', 'GET', signal),
    )
    const tags = record(await http.json('/tags.json', 'GET', signal))
    const output: Catalog = { categories: [], tags: [] }
    const seen = new Set<string>()
    function visit(values: unknown, prefix = '', depth = 0) {
      if (!Array.isArray(values) || depth > 20) return
      for (const value of values) {
        const entry = record(value)
        const categoryId = id(entry.id)
        if (seen.has(categoryId)) continue
        seen.add(categoryId)
        if (typeof entry.name !== 'string') throw new Error('invalid-response')
        const name = `${prefix}${entry.name}`
        output.categories.push({ id: categoryId, name })
        visit(entry.subcategory_list, `${name} / `, depth + 1)
      }
    }
    visit(record(category.category_list).categories)
    if (Array.isArray(tags.tags))
      output.tags = tags.tags.map((entry) => {
        const name = record(entry).name
        if (typeof name !== 'string') throw new Error('invalid-response')
        return { id: name, name }
      })
    return output
  }
  async function create(draft: Draft, marker: string, signal: AbortSignal) {
    const post = record(
      await http.json('/posts.json', 'POST', signal, {
        title: draft.title,
        raw: marked(draft.content, marker),

        ...(draft.category ? { category: Number(id(draft.category)) } : {}),
        tags: draft.tags,
      }),
    )
    try {
      const remote = await read(id(post.id), signal)
      if (!remote) throw new Error('remote-missing')
      return remote
    } catch {
      throw new PartialMutation()
    }
  }
  return {
    provider: 'discourse',
    connection,
    catalog,
    find,
    read,
    create,
    async verify(signal) {
      const value = record(await http.json('/session/current.json', 'GET', signal))
      if (!record(value.current_user).username) throw new Error('site-not-authorized')
    },
    async update(remote, draft, marker, signal) {
      // Either half may commit before failure. The engine's durable pending state requires reconciliation.
      await http.json(`/posts/${id(remote.id)}.json`, 'PUT', signal, {
        post: { raw: marked(draft.content, marker), original_text: remote.content },
      })
      try {
        await http.json(`/t/${id(remote.topicId)}.json`, 'PUT', signal, {
          title: draft.title,
          ...(draft.category ? { category_id: Number(id(draft.category)) } : {}),
          tags: draft.tags,
        })
        const updated = await read(remote.id, signal)
        if (!updated) throw new Error('remote-missing')
        return updated
      } catch {
        throw new PartialMutation()
      }
    },
    async remove(remote, signal) {
      const result = await http.json(`/t/${id(remote.topicId)}.json`, 'DELETE', signal)
      if (result === null) throw new Error('remote-missing')
    },
  }
}
