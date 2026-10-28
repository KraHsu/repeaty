import type { Component } from 'vue'
import type { SettingFieldProps, SettingValue } from '../components/ui/types'

export interface SettingsCategory {
  id: string
  title: string
}

/** Fields are rendered by the host; state and saving remain with their owner. */
export interface SettingsField extends SettingFieldProps {
  key: string
  onChange: (value: SettingValue) => void | Promise<void>
}

/** Getters can read owner-managed reactive state without creating a second preference store. */
export interface SettingsContribution {
  id: string
  title: string
  description?: string
  category?: readonly SettingsCategory[]
  fields?: readonly SettingsField[]
  component?: Component
  error?: string
}

export interface SettingsEntry {
  ownerId: string
  contribution: SettingsContribution
  scope: string
  isCurrent: () => boolean
  pluginId?: string
  /** Existing host views may already render their own SettingGroup. */
  standalone?: boolean
}

export interface SettingsCategoryNode {
  key: string
  title: string
  children: SettingsCategoryNode[]
  /** Contributions assigned directly to this node, excluding descendants. */
  entries: SettingsEntry[]
}
