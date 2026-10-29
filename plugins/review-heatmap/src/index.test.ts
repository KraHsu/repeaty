import { beforeEach, expect, it, vi } from 'vitest'
import type { PluginWidgetContribution } from '@repeaty/plugin-api'

const boundary = vi.hoisted(() => ({ registerWidget: vi.fn(), locale: { value: 'zh-CN' } }))
vi.mock('@repeaty/plugin-api', () => boundary)
import activate from './index'

beforeEach(() => {
  boundary.registerWidget.mockReset().mockReturnValue(() => {})
  boundary.locale.value = 'zh-CN'
})

it('registers only an overview widget and follows the host language', () => {
  const plugin = activate()
  expect(plugin).toMatchObject({
    id: 'review-heatmap',
    kind: 'frontend',
    type: 'extension',
    version: 1,
  })
  expect(boundary.registerWidget).toHaveBeenCalledTimes(1)
  const contribution = boundary.registerWidget.mock.calls[0]![0] as PluginWidgetContribution
  expect(contribution).toMatchObject({ id: 'daily-reviews', placement: 'overview.after-decks' })
  expect(contribution.component).toBeTruthy()
  expect(plugin.label).toBe('复习热力图')
  expect(contribution.title).toBe('复习热力图')
  boundary.locale.value = 'en'
  expect(plugin.label).toBe('Review heatmap')
  expect(contribution.title).toBe('Review heatmap')
  expect(plugin.description).toContain('365 local calendar days')
})
