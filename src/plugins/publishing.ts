import type { PublishingApi } from '@repeaty/plugin-api'
export interface PublishingIdentity {
  pluginId: string
  scope: string
  signal: AbortSignal
  assertCurrent(): void
}
export type PluginPublishingHostFactory = (owner: PublishingIdentity) => PublishingApi
export interface PluginNetworkIdentity extends PublishingIdentity {
  label: string
}
export type PluginNetworkConsent = (
  owner: PluginNetworkIdentity,
  origin: string,
) => Promise<boolean>
