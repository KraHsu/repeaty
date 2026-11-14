import type { Directive } from 'vue'

export interface UiControlOptions {
  monospace?: boolean
  reading?: boolean
  swatch?: boolean
}
export type UiButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'rating'
export type UiButtonTone = 'again' | 'hard' | 'good' | 'easy'
export interface UiButtonOptions {
  variant?: UiButtonVariant
  icon?: boolean
  tone?: UiButtonTone
}

const controlClasses = new WeakMap<HTMLElement, string[]>()
const buttonClasses = new WeakMap<HTMLElement, string[]>()

function replaceClasses(
  owners: WeakMap<HTMLElement, string[]>,
  element: HTMLElement,
  classes: string[],
) {
  for (const name of owners.get(element) ?? []) element.classList.remove(name)
  element.classList.add(...classes)
  owners.set(element, classes)
}
function release(owners: WeakMap<HTMLElement, string[]>, element: HTMLElement) {
  for (const name of owners.get(element) ?? []) element.classList.remove(name)
  owners.delete(element)
}
function control(element: HTMLElement, options: UiControlOptions = {}) {
  const tag = element.tagName.toLowerCase()
  const type = element.getAttribute('type')?.toLowerCase() ?? 'text'
  const classes: string[] = []
  if (
    ['input', 'select', 'textarea', 'progress'].includes(tag) &&
    !element.hidden &&
    !element.classList.contains('sr-only') &&
    type !== 'hidden'
  ) {
    classes.push('ui-control')
    if (options.swatch) classes.push('ui-control--swatch')
    else if (['select', 'textarea', 'progress'].includes(tag)) classes.push(`ui-control--${tag}`)
    else if (['checkbox', 'radio', 'range', 'file'].includes(type))
      classes.push(`ui-control--${type}`)
    if (options.monospace) classes.push('ui-control--mono')
    if (options.reading) classes.push('ui-control--reading')
  }
  replaceClasses(controlClasses, element, classes)
}
function inferVariant(element: HTMLElement): UiButtonVariant {
  if (element.classList.contains('primary') || element.classList.contains('dark')) return 'primary'
  if (element.classList.contains('danger')) return 'danger'
  if (
    element.classList.contains('text-button') ||
    element.classList.contains('icon-button') ||
    element.getAttribute('role') === 'menuitem'
  )
    return 'ghost'
  return 'secondary'
}
function button(element: HTMLElement, value?: UiButtonVariant | UiButtonOptions) {
  const options = typeof value === 'string' ? { variant: value } : (value ?? {})
  const variant = options.variant ?? inferVariant(element)
  const classes = ['ui-button', `ui-button--${variant}`]
  if (options.icon || element.classList.contains('icon-button')) classes.push('ui-button--icon')
  if (options.tone) classes.push(`ui-button--${options.tone}`)
  if (element.classList.contains('danger-text')) classes.push('ui-button--destructive')
  replaceClasses(buttonClasses, element, classes)
}

/** Style native controls without replacing refs, v-model, IME, selection or DOM events. */
export const vUiControl: Directive<HTMLElement, UiControlOptions | undefined> = {
  mounted: (element, binding) => control(element, binding.value),
  updated: (element, binding) => control(element, binding.value),
  beforeUnmount: (element) => release(controlClasses, element),
}

/** Also supports native summary and link actions while preserving their semantics. */
export const vUiButton: Directive<HTMLElement, UiButtonVariant | UiButtonOptions | undefined> = {
  mounted: (element, binding) => button(element, binding.value),
  updated: (element, binding) => button(element, binding.value),
  beforeUnmount: (element) => release(buttonClasses, element),
}
