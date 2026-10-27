import { createPinia, disposePinia, type Pinia } from 'pinia'
import type { App } from 'vue'

/** Every app root gets its own stores; native handles stay in the application services. */
export function installApplicationState(app: App, pinia: Pinia = createPinia()) {
  app.use(pinia)
  app.onUnmount(() => disposePinia(pinia))
  return pinia
}
