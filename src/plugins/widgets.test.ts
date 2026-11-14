import { expect, it } from 'vitest'
import { validateWidgetContribution, type PluginWidgetContribution } from './widgets'

const widget = (): PluginWidgetContribution => ({
  id: 'heatmap',
  title: 'Review activity',
  placement: 'overview.after-decks',
  component: { render: () => null },
})

it('accepts both explicit overview placements without requiring a page', () => {
  expect(() => validateWidgetContribution(widget())).not.toThrow()
  expect(() =>
    validateWidgetContribution({
      ...widget(),
      placement: 'overview.bottom',
      component: () => null,
    }),
  ).not.toThrow()
})

it.each([
  { id: '../outside' },
  { id: '' },
  { title: '' },
  { title: 42 },
  { placement: 'document.body' },
  { placement: 'review.answers' },
  { component: undefined },
  { component: '<div />' },
  { component: [] },
])('rejects malformed widget registration %j', (changed) => {
  expect(() =>
    validateWidgetContribution({ ...widget(), ...changed } as PluginWidgetContribution),
  ).toThrow(/插件组件/)
})
