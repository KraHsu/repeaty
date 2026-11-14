// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { createPinia, disposePinia } from 'pinia'
import { effectScope, nextTick, ref } from 'vue'
import { useAppNavigation } from './useAppNavigation'
import { usePluginViews } from './usePluginViews'
import { createPluginManager, type PluginManager } from '../plugins/manager'
import type { RegisterPluginPage, PluginPageContribution } from '../plugins/pages'
import type { PluginBundle } from '../plugins/package'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function application(scope = 'local:library') {
  const pinia = createPinia()
  const manager = createPluginManager({
    seedOfficial: false,
    readSetting: () => null,
    writeSetting: () => {},
  })
  manager.pluginScope.value = scope
  const workspaceScope = ref(scope)
  const navigation = useAppNavigation(pinia)
  const owner = effectScope()
  const views = owner.run(() => usePluginViews(navigation, workspaceScope, manager))!
  cleanups.push(async () => {
    owner.stop()
    disposePinia(pinia)
    await manager.dispose()
  })
  return { manager, workspaceScope, navigation, views, owner }
}
const contribution = (id = 'dashboard'): PluginPageContribution => ({
  id,
  title: 'Dashboard',
  component: { render: () => null },
})
async function install(manager: PluginManager, id = 'example') {
  let register!: RegisterPluginPage
  let remove!: () => void
  const bundle: PluginBundle = {
    manifest: { id, name: id, version: '1.0.0', apiVersion: 1, dataVersion: 1, kind: 'frontend' },
    main: 'test extension',
  }
  const installed = await manager.pluginRuntime.load(
    bundle,
    async (_code, _disposers, _settings, page, widget) => {
      register = page
      remove = page(contribution())
      widget({
        id: 'activity',
        title: 'Activity',
        placement: 'overview.bottom',
        component: { render: () => null },
      })
      return { default: { id, type: 'extension', kind: 'frontend', label: id, version: 1 } }
    },
  )
  return { installed, register, remove }
}

it('resolves page IDs within their plugin namespace and ignores unavailable navigation targets', async () => {
  const { manager, navigation, views } = application()
  const first = await install(manager, 'first')
  const second = await install(manager, 'second')
  expect(views.pluginPages.value).toHaveLength(2)
  expect(views.pluginPages.value[0]!.key).not.toBe(views.pluginPages.value[1]!.key)
  views.openPluginPage('first', 'dashboard')
  await nextTick()
  expect(navigation.tab.value).toBe('plugin-page')
  expect(views.activePluginPage.value?.contribution).toBe(first.installed.pages![0])
  views.openPluginPage('second', 'dashboard')
  await nextTick()
  expect(views.activePluginPage.value?.contribution).toBe(second.installed.pages![0])
  views.openPluginPage('missing', 'dashboard')
  views.openPluginPage('first', 'missing')
  await nextTick()
  expect(views.activePluginPage.value?.pluginId).toBe('second')
})

it('gives reused page IDs a new view lifetime while preserving an existing route during replacement', async () => {
  const { manager, navigation, views } = application()
  const initial = await install(manager)
  views.openPluginPage('example', 'dashboard')
  await nextTick()
  const firstKey = views.activePluginPage.value!.key
  expect(views.activePluginPage.value!.key).toBe(firstKey)
  initial.remove()
  initial.register(contribution())
  await nextTick()
  expect(navigation.tab.value).toBe('plugin-page')
  expect(views.activePluginPage.value!.key).not.toBe(firstKey)
  const secondKey = views.activePluginPage.value!.key
  const updated = await install(manager)
  await nextTick()
  expect(views.activePluginPage.value?.contribution).toBe(updated.installed.pages![0])
  expect(views.activePluginPage.value!.key).not.toBe(secondKey)
  expect(initial.installed.pages).toHaveLength(0)
})

it('hides old page and widget content immediately on a workspace mismatch and falls back to overview', async () => {
  const { manager, workspaceScope, navigation, views } = application()
  const old = await install(manager)
  views.openPluginPage('example', 'dashboard')
  await nextTick()
  const key = views.activePluginPage.value!.key
  expect(views.pluginWidgets.value).toHaveLength(1)
  workspaceScope.value = 'local:next-library'
  expect(views.activePluginPage.value).toBeUndefined()
  expect(views.pluginPages.value).toHaveLength(0)
  expect(views.pluginWidgets.value).toHaveLength(0)
  await nextTick()
  expect(navigation.tab.value).toBe('overview')
  expect(navigation.pluginPage.value).toBeUndefined()
  await manager.pluginRuntime.close()
  manager.pluginScope.value = workspaceScope.value
  const fresh = await install(manager)
  views.openPluginPage('example', 'dashboard')
  await nextTick()
  expect(views.activePluginPage.value?.contribution).toBe(fresh.installed.pages![0])
  expect(views.activePluginPage.value?.scope).toBe(workspaceScope.value)
  expect(views.activePluginPage.value!.key).not.toBe(key)
  expect(old.installed.pages).toHaveLength(0)
})

it('removes disabled or unregistered pages and widgets without leaving an invalid active route', async () => {
  const { manager, navigation, views } = application()
  const plugin = await install(manager)
  views.openPluginPage('example', 'dashboard')
  await nextTick()
  manager.savePluginPreference('example', false)
  expect(views.pluginPages.value).toHaveLength(0)
  expect(views.pluginWidgets.value).toHaveLength(0)
  await nextTick()
  expect(navigation.tab.value).toBe('overview')
  manager.savePluginPreference('example', true)
  views.openPluginPage('example', 'dashboard')
  await nextTick()
  plugin.remove()
  await nextTick()
  expect(navigation.tab.value).toBe('overview')
  expect(navigation.pluginPage.value).toBeUndefined()
  expect(views.pluginWidgets.value).toHaveLength(1)
  await manager.pluginRuntime.unload('example')
  expect(views.pluginWidgets.value).toHaveLength(0)
})

it('keeps app navigation and cleanup independent and stops its fallback watcher with the owner', async () => {
  const first = application(),
    second = application()
  await install(first.manager)
  await install(second.manager)
  first.views.openPluginPage('example', 'dashboard')
  second.views.openPluginPage('example', 'dashboard')
  await nextTick()
  first.owner.stop()
  first.workspaceScope.value = 'local:other'
  await nextTick()
  // The stopped owner no longer navigates a mounted application.
  expect(first.navigation.tab.value).toBe('plugin-page')
  expect(first.views.activePluginPage.value).toBeUndefined()
  expect(second.navigation.tab.value).toBe('plugin-page')
  expect(second.views.pluginPages.value).toHaveLength(1)
  expect(second.views.pluginWidgets.value).toHaveLength(1)
  await first.manager.dispose()
  expect(second.views.activePluginPage.value?.pluginId).toBe('example')
})
