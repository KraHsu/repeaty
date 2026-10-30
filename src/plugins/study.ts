import type { StudyHostApi } from '@repeaty/plugin-api'

export interface StudyPluginIdentity {
  pluginId: string
  scope: string
  signal: AbortSignal
  assertCurrent(): void
}
export type PluginStudyHostFactory = (owner: StudyPluginIdentity) => StudyHostApi
