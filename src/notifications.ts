import { readonly, shallowRef } from 'vue'
import { t, type DisplayMessage } from './i18n'
import type { NotificationLevel } from './preferences'

export interface Notification {
  id: number
  text: DisplayMessage
  level: NotificationLevel
  context?: string
}
const entries = shallowRef<Notification[]>([])
export const notifications = readonly(entries)
let id = 0
export function notify(text: DisplayMessage, level: NotificationLevel = 'info', context?: string) {
  const duplicate = entries.value.find(
    (entry) => entry.level === level && entry.context === context && t(entry.text) === t(text),
  )
  if (duplicate) return duplicate.id
  const entry = { id: ++id, text, level, context }
  // Persistent warnings/errors are never evicted by transient success messages.
  entries.value = [
    ...(level === 'info' ? entries.value.filter((entry) => entry.level !== 'info') : entries.value),
    entry,
  ]
  return entry.id
}
export function dismissNotification(id: number) {
  entries.value = entries.value.filter((entry) => entry.id !== id)
}
export function clearNotifications() {
  entries.value = []
}
export function dismissInfoNotifications() {
  entries.value = entries.value.filter((entry) => entry.level !== 'info')
}
export function dismissNotificationContext(context: string) {
  entries.value = entries.value.filter((entry) => entry.context !== context)
}
