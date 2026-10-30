/** Map DOM endpoints through generated spans, never through ambiguous quote matching. */
function point(root: HTMLElement, node: Node, offset: number): number | undefined {
  const element = node instanceof Element ? node : node.parentElement
  const span = element?.closest<HTMLElement>('[data-doc-start][data-doc-end]')
  if (span && root.contains(span)) {
    const range = document.createRange()
    range.selectNodeContents(span)
    try {
      range.setEnd(node, offset)
    } catch {
      return undefined
    }
    return Number(span.dataset.docStart) + range.toString().length
  }
  // Browser selections can end between block elements rather than in a text node.
  if (!root.contains(node) && node !== root) return undefined
  const probe = document.createRange()
  try {
    probe.setStart(node, offset)
    probe.collapse(true)
  } catch {
    return undefined
  }
  const spans = [...root.querySelectorAll<HTMLElement>('[data-doc-start][data-doc-end]')]
  for (const item of spans) {
    if (probe.comparePoint(item, 0) >= 0) return Number(item.dataset.docStart)
  }
  return spans.length ? Number(spans.at(-1)!.dataset.docEnd) : undefined
}
export function selectionOffsets(
  root: HTMLElement,
  range: Range,
): { start: number; end: number } | undefined {
  const start = point(root, range.startContainer, range.startOffset),
    end = point(root, range.endContainer, range.endOffset)
  return start !== undefined && end !== undefined && end > start ? { start, end } : undefined
}
export function spanAt(root: HTMLElement, offset: number): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('[data-doc-start][data-doc-end]')].find(
    (span) => Number(span.dataset.docEnd) > offset,
  )
}
export function pointRange(text: string, offset: number) {
  let start = Math.max(0, Math.min(offset, text.length - 1))
  const after = text.slice(start).search(/\S/)
  if (after >= 0) start += after
  else while (start > 0 && /\s/.test(text[start]!)) start--
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start]!)) start--
  const end = start + ((text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1)
  return { start, end }
}
