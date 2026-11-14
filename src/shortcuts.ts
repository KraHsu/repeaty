/** Match the actual editing host, including editors inside a shadow tree. */
export function isTextEditing(event: KeyboardEvent): boolean {
  return event.composedPath().some((target) => {
    if (!(target instanceof HTMLElement)) return false
    if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled
    if (target instanceof HTMLInputElement)
      return (
        !target.readOnly &&
        !target.disabled &&
        !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file', 'color'].includes(
          target.type,
        )
      )
    return target.isContentEditable || target instanceof HTMLSelectElement
  })
}
export function shortcutBlocked(event: KeyboardEvent) {
  return (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229 ||
    Boolean(document.querySelector('dialog[open], [data-app-modal-content]')) ||
    Boolean(
      event
        .composedPath()
        .some(
          (target) =>
            target instanceof HTMLElement &&
            target.matches('[role="combobox"], [role="listbox"], [role="menu"], [role="slider"]'),
        ),
    ) ||
    isTextEditing(event)
  )
}
