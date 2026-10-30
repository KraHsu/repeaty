import type { ContextUsage, Message } from './model'
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: false })
const bytes = (value: string) => encoder.encode(value).length
export function clipUtf8(value: string, maximum: number): string {
  const input = encoder.encode(value)
  if (input.length <= maximum) return value
  // Avoid introducing U+FFFD by ending before a continuation sequence.
  let end = maximum
  while (end > 0 && (input[end]! & 0xc0) === 0x80) end--
  return decoder.decode(input.subarray(0, end))
}

/** Budgets affect only provider input. The complete local transcript remains unchanged. */
export function selectContext(history: Message[]) {
  const selected: Message[] = []
  let imageBudget = 3
  let textBudget = 2 * 1024 * 1024
  let clippedMessages = 0
  for (let index = history.length - 1; index >= 0 && selected.length < 197; index--) {
    const original = history[index]!
    const message = { ...original }
    if (bytes(message.text) > 240 * 1024) {
      message.text = `${clipUtf8(message.text, 240 * 1024)}\n[Content shortened for this model request. Complete content remains in the local conversation. Read long material again using bodyOffset/bodyLimit.]`
      clippedMessages++
    }
    const size = bytes(message.text) + bytes(JSON.stringify(message.toolCalls ?? []))
    if (size > textBudget) break
    textBudget -= size
    const images = original.images ?? []
    const keep = images.slice(Math.max(0, images.length - imageBudget))
    imageBudget -= keep.length
    const omitted = images.length - keep.length
    if (omitted)
      message.text += `\n[${omitted} earlier image(s) omitted from this request; originals remain stored locally. Ask the user to attach a needed image again.]`
    message.images = keep
    selected.unshift(message)
  }
  const usage: ContextUsage = {
    messages: selected.length,
    totalMessages: history.length,
    images: 3 - imageBudget,
    totalImages: history.reduce((count, message) => count + (message.images?.length ?? 0), 0),
    clippedMessages,
  }
  const notice = `Context window: ${usage.messages}/${usage.totalMessages} most recent stored messages and ${usage.images}/${usage.totalImages} most recent images are included; ${clippedMessages} long messages were shortened. Earlier content remains in the local conversation. Do not claim access to omitted content. Ask the user to restate or reattach necessary older context.`
  return { messages: selected, usage, notice }
}
