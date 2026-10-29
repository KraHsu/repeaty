// Test-only host boundary. Production code imports the public SDK exclusively.
import { ref } from 'vue'
export const locale = ref<'zh-CN' | 'en'>('zh-CN')
export function registerWidget(_contribution: unknown): () => void {
  throw new Error('Mock registerWidget explicitly in activation tests')
}
