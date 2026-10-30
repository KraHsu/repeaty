import { describe, expect, it, vi } from 'vitest'
import { SessionStore } from './store'
describe('session and attachment persistence', () => {
  it('stores a long provider reply in bounded immutable fragments without corrupting the old reply on failure', async () => {
    const values = new Map<string, unknown>()
    let fail = false
    const store = new SessionStore({
      async get(id) {
        return structuredClone(values.get(id))
      },
      async set(id, value) {
        if (fail && id.endsWith('-1')) throw new Error('Disk full')
        expect(JSON.stringify(value).length).toBeLessThan(2 * 1024 * 1024)
        values.set(id, structuredClone(value))
      },
    })
    const thread = store.create('profile')
    thread.messages.push({
      id: 'long-message',
      role: 'assistant',
      text: 'A'.repeat(4 * 1024 * 1024),
      createdAt: '',
    })
    await store.save(thread)
    expect((await store.load(thread.id)).messages[0]?.text).toHaveLength(4 * 1024 * 1024)
    fail = true
    thread.messages[0]!.text = 'B'.repeat(4 * 1024 * 1024)
    await expect(store.save(thread)).rejects.toThrow('storage')
    expect((await store.load(thread.id)).messages[0]?.text.startsWith('A')).toBe(true)
  })
  it('splits a 3 MiB image into bounded files and reloads exact bytes', async () => {
    const files = new Map<string, string>()
    const store = new SessionStore(
      {
        async get() {
          return undefined
        },
        async set() {},
      },
      {
        async read(path) {
          return files.get(path) ?? null
        },
        async write(path, value) {
          files.set(path, value)
        },
      },
    )
    const bytes = new Uint8Array(3 * 1024 * 1024).fill(123)
    const attachment = await store.addImage(
      new File([bytes], '复习图示.png', { type: 'image/png' }),
    )
    expect(files.size).toBe(5)
    expect(Math.max(...[...files.values()].map((value) => value.length))).toBeLessThanOrEqual(
      1024 * 1024,
    )
    const restored = await store.image(attachment)
    expect(atob(restored.data)).toHaveLength(bytes.length)
    expect(atob(restored.data).charCodeAt(bytes.length - 1)).toBe(123)
    files.delete(`images/${attachment.id}-2.txt`)
    await expect(store.image(attachment)).rejects.toThrow('storage')
  })
  it('refuses oversize and unsupported attachments before writing files', async () => {
    const write = vi.fn()
    const store = new SessionStore(
      {
        async get() {
          return undefined
        },
        async set() {},
      },
      {
        async read() {
          return null
        },
        write,
      },
    )
    await expect(
      store.addImage(new File(['data'], 'script.svg', { type: 'image/svg+xml' })),
    ).rejects.toThrow('storage')
    await expect(
      store.addImage(
        new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
      ),
    ).rejects.toThrow('storage')
    expect(write).not.toHaveBeenCalled()
  })
  it('does not rewrite unchanged history during draft and streaming checkpoints', async () => {
    const data = new Map<string, unknown>()
    const set = vi.fn(async (id: string, value: unknown) => {
      data.set(id, value)
    })
    const store = new SessionStore({
      async get(id) {
        return data.get(id)
      },
      set,
    })
    const thread = store.create('profile')
    thread.messages.push({
      id: 'old-message',
      role: 'assistant',
      text: 'Existing history',
      createdAt: '',
    })
    await store.save(thread)
    thread.draft = 'Next message'
    await store.save(thread)
    expect(set.mock.calls.filter(([id]) => id === 'message-old-message')).toHaveLength(1)
    expect((await store.load(thread.id)).draft).toBe('Next message')
  })
})
