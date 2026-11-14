import type {
  AutomationApi,
  AutomationGrant,
  AutomationPreview,
  AutomationScope,
} from '@repeaty/plugin-api'
export interface AutomationIdentity {
  actorId: string
  label: string
  scope: string
  signal: AbortSignal
  assertCurrent(): void
}
export interface PluginAutomationIdentity extends Omit<AutomationIdentity, 'actorId'> {
  pluginId: string
}
export type PluginAutomationHostFactory = (owner: PluginAutomationIdentity) => AutomationApi
export interface AutomationConsent {
  authorize(
    owner: AutomationIdentity,
    input: { scope: AutomationScope; write: boolean },
  ): Promise<boolean>
  apply?(owner: AutomationIdentity, preview: AutomationPreview): Promise<boolean>
  grant?(): AutomationGrant | undefined
}
