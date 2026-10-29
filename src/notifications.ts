import { readonly } from 'vue'
import { storeToRefs, type Pinia } from 'pinia'
import { useNotificationStore } from './stores/notifications'
export type { Notification } from './stores/notifications'
export function useNotifications(pinia?: Pinia) {
  const store = useNotificationStore(pinia)
  return {
    notifications: readonly(storeToRefs(store).entries),
    notify: store.notify,
    dismissNotification: store.dismissNotification,
    clearNotifications: store.clearNotifications,
    dismissInfoNotifications: store.dismissInfoNotifications,
    dismissNotificationContext: store.dismissNotificationContext,
  }
}
