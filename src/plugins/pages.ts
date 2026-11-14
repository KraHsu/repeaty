import type { Component } from 'vue'

/** One independent view and its automatic, plugin-scoped sidebar entry. */
export interface PluginPageContribution {
  id: string
  title: string
  description?: string
  icon?: Component
  component: Component
}

export type RegisterPluginPage = (contribution: PluginPageContribution) => () => void

function isComponent(value: unknown): value is Component {
  return !!value && !Array.isArray(value) && ['object', 'function'].includes(typeof value)
}

export function validatePageContribution(contribution: PluginPageContribution) {
  if (
    !contribution ||
    typeof contribution !== 'object' ||
    typeof contribution.id !== 'string' ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(contribution.id) ||
    typeof contribution.title !== 'string' ||
    !contribution.title.trim() ||
    (contribution.description !== undefined && typeof contribution.description !== 'string')
  )
    throw new Error('插件页面定义无效。')
  if (!isComponent(contribution.component)) throw new Error('插件页面视图无效。')
  if (contribution.icon !== undefined && !isComponent(contribution.icon))
    throw new Error('插件页面图标无效。')
}
