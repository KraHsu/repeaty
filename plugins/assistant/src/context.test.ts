import { describe, expect, it } from 'vitest'
import { clipUtf8, selectContext } from './context'
import type { Message } from './model'
const message = (index: number): Message => ({
  id: String(index),
  role: 'user',
  text: `消息 ${index}`,
  createdAt: '',
})
describe('provider context budget', () => {
  it('keeps only the latest 3 images with explicit omission markers, preserving originals', () => {
    const history = [message(1), message(2)]
    history[0]!.images = [
      { id: 'old1', name: 'older.png', mime: 'image/png', size: 1 },
      { id: 'old2', name: 'old.png', mime: 'image/png', size: 1 },
    ]
    history[1]!.images = [
      { id: 'new1', name: 'current1.png', mime: 'image/png', size: 1 },
      { id: 'new2', name: 'current2.png', mime: 'image/png', size: 1 },
    ]
    const selected = selectContext(history)
    expect(selected.messages.flatMap((item) => item.images ?? []).map((item) => item.id)).toEqual([
      'old2',
      'new1',
      'new2',
    ])
    expect(selected.messages[0]?.text).toContain('1 earlier image(s) omitted')
    expect(history[0]?.images).toHaveLength(2)
    expect(history[0]?.text).toBe('消息 1')
    expect(selected.usage).toMatchObject({ images: 3, totalImages: 4 })
  })
  it('caps provider input while keeping complete local history and records the omission', () => {
    const history = Array.from({ length: 250 }, (_, index) => message(index))
    const selected = selectContext(history)
    expect(selected.messages).toHaveLength(197)
    expect(selected.messages[0]?.id).toBe('53')
    expect(selected.notice).toContain('197/250')
    expect(history).toHaveLength(250)
  })
  it('clips by UTF-8 bytes without splitting Chinese or emoji code points', () => {
    expect(clipUtf8('记忆🙂复习', 9)).toBe('记忆')
    expect(clipUtf8('记忆🙂复习', 10)).toBe('记忆🙂')
    const original = message(1)
    original.text = '记忆🙂'.repeat(60000)
    const selected = selectContext([original])
    expect(selected.usage.clippedMessages).toBe(1)
    expect(selected.messages[0]!.text).not.toContain('�')
    expect(original.text).toHaveLength(240000)
    expect(new TextEncoder().encode(selected.messages[0]!.text).length).toBeLessThan(512 * 1024)
  })
})
