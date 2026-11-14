import { inject, provide, type InjectionKey } from 'vue'
import type { createApplication } from './createApplication'
export type Application = ReturnType<typeof createApplication>
const key: InjectionKey<Application> = Symbol('Repeaty application')
export function provideApplication(application: Application) {
  provide(key, application)
}
export function useApplication() {
  const application = inject(key)
  if (!application) throw new Error('Repeaty application context is missing')
  return application
}
