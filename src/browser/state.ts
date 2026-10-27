import { shallowRef } from 'vue'

export const browserWorkspace = shallowRef<{
  scope: string
  id: string
  name: string
  revision: number
  changed: boolean
} | null>(null)
