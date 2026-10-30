export interface PluginNetworkIdentity {
  pluginId: string
  scope: string
  signal: AbortSignal
  assertCurrent(): void
  label: string
}
export type PluginNetworkConsent = (
  owner: PluginNetworkIdentity,
  origin: string,
) => Promise<boolean>
