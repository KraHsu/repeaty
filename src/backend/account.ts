import { ref } from 'vue'
import { apiJson } from './client'
export const account = ref<{ id: string; username: string }>()
export async function refreshAccount() {
  try {
    account.value = (
      await apiJson<{ user: { id: string; username: string } }>('/auth/session')
    ).user
  } catch {
    account.value = undefined
  }
}
