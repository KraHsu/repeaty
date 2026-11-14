import {
  AssistantError,
  emptyContext,
  uid,
  type Attachment,
  type ImageInput,
  type Message,
  type Thread,
  type ThreadSummary,
} from './model'

export interface DataStore {
  get(id: string): Promise<unknown>
  set(id: string, value: unknown): Promise<void>
}
export interface FileStore {
  read(path: string): Promise<string | null>
  write(path: string, value: string): Promise<void>
}
interface StoredThread extends Omit<Thread, 'messages'> {
  messageIds: string[]
}
interface ChunkedMessage {
  kind: 'chunked-message-v1'
  id: string
  revision: string
  parts: number
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const summary = (thread: Thread): ThreadSummary => ({
  id: thread.id,
  title: thread.title,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
  status: thread.status,
  providerId: thread.providerId,
  providerThreadId: thread.providerThreadId,
  continuedFrom: thread.continuedFrom,
})
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value)

export class SessionStore {
  private queue: Promise<void> = Promise.resolve()
  private savedMessages = new Map<string, string>()
  constructor(
    private data: DataStore,
    private files?: FileStore,
  ) {}

  async list(): Promise<ThreadSummary[]> {
    const value = await this.data.get('sessions-v1')
    if (value === undefined || value === null) return []
    if (
      !Array.isArray(value) ||
      !value.every(
        (item) =>
          item &&
          validId(item.id) &&
          typeof item.title === 'string' &&
          ['active', 'archived', 'deleted'].includes(item.status),
      )
    )
      throw new AssistantError('storage')
    return value as ThreadSummary[]
  }

  async load(id: string): Promise<Thread> {
    if (!validId(id)) throw new AssistantError('storage')
    const stored = (await this.data.get(`thread-${id}`)) as StoredThread | undefined
    if (
      !stored ||
      stored.id !== id ||
      !Array.isArray(stored.messageIds) ||
      !stored.messageIds.every(validId)
    )
      throw new AssistantError('storage')
    const messages: Message[] = []
    for (const messageId of stored.messageIds) {
      const storedMessage = (await this.data.get(`message-${messageId}`)) as
        Message | ChunkedMessage | undefined
      let message: Message | undefined
      if (storedMessage && 'kind' in storedMessage && storedMessage.kind === 'chunked-message-v1') {
        if (
          !validId(storedMessage.revision) ||
          !Number.isSafeInteger(storedMessage.parts) ||
          storedMessage.parts < 1 ||
          storedMessage.parts > 64
        )
          throw new AssistantError('storage')
        const parts: string[] = []
        for (let index = 0; index < storedMessage.parts; index++) {
          const part = await this.data.get(
            `message-${messageId}-${storedMessage.revision}-${index}`,
          )
          if (typeof part !== 'string') throw new AssistantError('storage')
          parts.push(part)
        }
        try {
          message = JSON.parse(parts.join('')) as Message
        } catch {
          throw new AssistantError('storage')
        }
      } else message = storedMessage as Message | undefined
      if (!message || message.id !== messageId || typeof message.text !== 'string')
        throw new AssistantError('storage')
      messages.push(message.status === 'running' ? { ...message, status: 'interrupted' } : message)
    }
    const { messageIds: _, ...thread } = stored
    return { ...thread, messages }
  }

  save(thread: Thread): Promise<void> {
    const snapshot = clone(thread)
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        for (const message of snapshot.messages) {
          const serialized = JSON.stringify(message)
          if (this.savedMessages.get(message.id) === serialized) continue
          if (serialized.length > 1024 * 1024) {
            const revision = uid()
            const size = 256 * 1024
            const parts = Math.ceil(serialized.length / size)
            if (parts > 64) throw new AssistantError('storage')
            for (let index = 0; index < parts; index++)
              await this.data.set(
                `message-${message.id}-${revision}-${index}`,
                serialized.slice(index * size, (index + 1) * size),
              )
            // Publish only after every immutable fragment is durable. Failed writes keep the old message intact.
            await this.data.set(`message-${message.id}`, {
              kind: 'chunked-message-v1',
              id: message.id,
              revision,
              parts,
            } satisfies ChunkedMessage)
          } else await this.data.set(`message-${message.id}`, message)
          this.savedMessages.set(message.id, serialized)
        }
        const { messages, ...metadata } = snapshot
        await this.data.set(`thread-${snapshot.id}`, {
          ...metadata,
          messageIds: messages.map((message) => message.id),
        })
        const index = await this.list()
        await this.data.set('sessions-v1', [
          summary(snapshot),
          ...index.filter((item) => item.id !== snapshot.id),
        ])
      })
      .catch(() => {
        throw new AssistantError('storage')
      })
    this.queue = operation
    return operation
  }

  create(providerId: string, title = ''): Thread {
    const now = new Date().toISOString()
    return {
      id: uid(),
      title,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      providerId,
      messages: [],
      draft: '',
      draftImages: [],
      context: emptyContext(),
    }
  }

  continue(thread: Thread): Thread {
    return {
      ...this.create(thread.providerId, thread.title),
      continuedFrom: thread.id,
      context: clone(thread.context),
      messages: clone(thread.messages).map((message) => ({
        ...message,
        id: uid(),
        proposals: message.proposals?.map((proposal) => ({
          ...proposal,
          status: proposal.status === 'pending' ? 'rejected' : proposal.status,
        })),
      })),
    }
  }

  async addImage(file: File): Promise<Attachment> {
    if (
      !this.files ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 3 * 1024 * 1024 ||
      file.size === 0
    )
      throw new AssistantError('storage')
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    const attachment: Attachment = {
      id: uid(),
      name: file.name.slice(0, 200),
      mime: file.type as Attachment['mime'],
      size: bytes.length,
    }
    const data = btoa(binary)
    const chunks = Math.ceil(data.length / (1024 * 1024))
    for (let index = 0; index < chunks; index++)
      await this.files.write(
        `images/${attachment.id}-${index}.txt`,
        data.slice(index * 1024 * 1024, (index + 1) * 1024 * 1024),
      )
    await this.files.write(
      `images/${attachment.id}.json`,
      JSON.stringify({ ...attachment, chunks }),
    )
    return attachment
  }

  async image(attachment: Attachment): Promise<ImageInput> {
    if (!this.files || !validId(attachment.id)) throw new AssistantError('storage')
    const data = await this.files.read(`images/${attachment.id}.json`)
    if (!data) throw new AssistantError('storage')
    const image = JSON.parse(data) as Attachment & { chunks: number }
    if (
      image.id !== attachment.id ||
      image.mime !== attachment.mime ||
      !Number.isSafeInteger(image.chunks) ||
      image.chunks < 1 ||
      image.chunks > 4
    )
      throw new AssistantError('storage')
    const chunks: string[] = []
    for (let index = 0; index < image.chunks; index++) {
      const chunk = await this.files.read(`images/${attachment.id}-${index}.txt`)
      if (chunk === null) throw new AssistantError('storage')
      chunks.push(chunk)
    }
    return { ...attachment, data: chunks.join('') }
  }
}
