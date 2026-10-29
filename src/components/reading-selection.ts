import { characterBoundary } from '../core/source-data'

/** Only renderer-owned spans carry offsets. HTML/KaTeX text remains unmapped. */
export function readingSelection(root: HTMLElement, range: Range, text: string) {
  if (range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer))
    return undefined
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let first: number | undefined, last: number | undefined
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!range.intersectsNode(node)) continue
    const from = node === range.startContainer ? range.startOffset : 0
    const to = node === range.endContainer ? range.endOffset : node.length
    if (from >= to) continue
    if (characterBoundary(node.data, from) !== from || characterBoundary(node.data, to) !== to)
      return undefined
    const anchor = node.parentElement?.closest<HTMLElement>(
      '[data-reading-start][data-reading-stop]',
    )
    if (!anchor || !root.contains(anchor)) {
      if (node.parentElement?.closest('[data-reading-task]')) continue
      if (node.data.slice(from, to).trim()) return undefined
      continue
    }
    const rawStart = Number(anchor.dataset.readingStart),
      rawEnd = Number(anchor.dataset.readingStop)
    if (
      !Number.isInteger(rawStart) ||
      !Number.isInteger(rawEnd) ||
      rawStart < 0 ||
      rawEnd > text.length ||
      rawEnd <= rawStart
    )
      return undefined
    const within = doc.createRange()
    within.selectNodeContents(anchor)
    within.setEnd(node, from)
    const localStart = within.toString().length
    within.setEnd(node, to)
    const localEnd = within.toString().length
    const length = anchor.textContent?.length ?? 0
    const linear = rawEnd - rawStart === length
    const start = linear ? rawStart + localStart : rawStart
    const end = linear ? rawStart + localEnd : rawEnd
    if (characterBoundary(text, start) !== start || characterBoundary(text, end) !== end)
      return undefined
    if (last !== undefined && start < last) return undefined
    first ??= start
    last = end
  }
  return first !== undefined && last !== undefined && last > first
    ? { start: first, end: last }
    : undefined
}
