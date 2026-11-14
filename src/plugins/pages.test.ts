import { expect, it } from 'vitest'
import { validatePageContribution, type PluginPageContribution } from './pages'

const page = (): PluginPageContribution => ({
  id: 'dashboard',
  title: 'Dashboard',
  component: { render: () => null },
})

it('accepts object and functional page components and optional component icons', () => {
  expect(() => validatePageContribution(page())).not.toThrow()
  expect(() =>
    validatePageContribution({ ...page(), component: () => null, icon: { render: () => null } }),
  ).not.toThrow()
})

it.each([
  { id: '' },
  { id: '../outside' },
  { id: 'a'.repeat(65) },
  { title: ' ' },
  { title: 42 },
  { description: true },
  { component: undefined },
  { component: '<script>anything</script>' },
  { component: [] },
  { icon: 'https://example.invalid/icon.svg' },
  { icon: [] },
])('rejects malformed page registration %j', (changed) => {
  expect(() =>
    validatePageContribution({ ...page(), ...changed } as PluginPageContribution),
  ).toThrow(/插件页面/)
})
