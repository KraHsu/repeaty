import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { t, type DisplayMessage } from '../i18n'
import type { NotificationLevel } from '../preferences'
export interface Notification {
  id: number
  text: DisplayMessage
  level: NotificationLevel
  context?: string
}
export const useNotificationStore = defineStore('notifications', () => {
  const entries = shallowRef<Notification[]>([])
  let id = 0
  function notify(text: DisplayMessage, level: NotificationLevel = 'info', context?: string) {
    const duplicate = entries.value.find(
      (entry) => entry.level === level && entry.context === context && t(entry.text) === t(text),
    )
    if (duplicate) return duplicate.id
    const entry = { id: ++id, text, level, context }
    entries.value = [
      ...(level === 'info'
        ? entries.value.filter((entry) => entry.level !== 'info')
        : entries.value),
      entry,
    ]
    return entry.id
  }
  function dismissNotification(id: number) {
    entries.value = entries.value.filter((entry) => entry.id !== id)
  }
  function clearNotifications() {
    entries.value = []
  }
  function dismissInfoNotifications() {
    entries.value = entries.value.filter((entry) => entry.level !== 'info')
  }
  function dismissNotificationContext(context: string) {
    entries.value = entries.value.filter((entry) => entry.context !== context)
  }
  return {
    entries,
    notify,
    dismissNotification,
    clearNotifications,
    dismissInfoNotifications,
    dismissNotificationContext,
  }
})
