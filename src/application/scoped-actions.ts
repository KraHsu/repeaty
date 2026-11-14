import type { DisplayMessage } from '../i18n'
export interface ScopedActionEnvironment {
  scope(): string
  alive(): boolean
  start(): void
  success(message?: DisplayMessage): void
  failure(error: unknown): void
}
/** Delayed work may finish for its repository, but cannot update another view's feedback. */
export function createScopedActionRunner(environment: ScopedActionEnvironment) {
  return async (action: () => Promise<void>, message?: DisplayMessage) => {
    const scope = environment.scope()
    const ownsScope = () => environment.alive() && scope === environment.scope()
    environment.start()
    try {
      await action()
      if (!ownsScope()) return false
      environment.success(message)
      return true
    } catch (error) {
      if (ownsScope()) environment.failure(error)
      return false
    }
  }
}
