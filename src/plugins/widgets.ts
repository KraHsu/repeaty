import type { Component } from 'vue'

export type PluginWidgetPlacement = 'overview.after-decks' | 'overview.bottom'

/** A mounted extension within one of the host's explicit overview slots. */
export interface PluginWidgetContribution {
  id: string
  title: string
  placement: PluginWidgetPlacement
  component: Component
}

export type RegisterPluginWidget = (contribution: PluginWidgetContribution) => () => void

export function validateWidgetContribution(contribution: PluginWidgetContribution) {
  if (
    !contribution ||
    typeof contribution !== 'object' ||
    typeof contribution.id !== 'string' ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(contribution.id) ||
    typeof contribution.title !== 'string' ||
    !contribution.title.trim() ||
    !['overview.after-decks', 'overview.bottom'].includes(contribution.placement)
  )
    throw new Error('插件组件定义无效。')
  if (
    !contribution.component ||
    Array.isArray(contribution.component) ||
    !['object', 'function'].includes(typeof contribution.component)
  )
    throw new Error('插件组件视图无效。')
}
