import { createPinia } from 'pinia'
import { effectScope } from 'vue'
import { expect, it } from 'vitest'
import { useAppNavigation } from './useAppNavigation'

it('travels between ordinary pages and preserves filters and plugin routes', async () => {
  const navigation = useAppNavigation(createPinia())
  navigation.navigate('cards')
  navigation.selectedDeck.value = 'deck-one'
  navigation.searchQuery.value = 'tag:reading'
  navigation.openPluginPage('stats', 'summary')
  expect(navigation.canGoBack.value).toBe(true)
  navigation.goBack()
  expect(navigation.tab.value).toBe('cards')
  expect(navigation.selectedDeck.value).toBe('deck-one')
  expect(navigation.searchQuery.value).toBe('tag:reading')
  navigation.goForward()
  expect(navigation.pluginPage.value).toEqual({ pluginId: 'stats', pageId: 'summary' })
  navigation.goBack()
  navigation.navigate('settings')
  expect(navigation.canGoForward.value).toBe(false)
})
it('does not restore active review sessions and resets history when switching libraries', () => {
  const navigation = useAppNavigation(createPinia())
  navigation.navigate('cards')
  navigation.review.value = { deckId: 'one' }
  expect(navigation.canGoBack.value).toBe(false)
  expect(navigation.goBack()).toBe(false)
  expect(navigation.review.value).toEqual({ deckId: 'one' })
  navigation.navigate('sources')
  navigation.goBack()
  expect(navigation.tab.value).toBe('overview')
  expect(navigation.review.value).toBeNull()
  navigation.resetLibrary()
  expect(navigation.canGoBack.value).toBe(false)
  expect(navigation.canGoForward.value).toBe(false)
})
it('waits for the reading leave guard and rejects stale or rejected navigation', async () => {
  const approvals: ((value: boolean) => void)[] = []
  const navigation = useAppNavigation(
    createPinia(),
    () => new Promise<boolean>((resolve) => approvals.push(resolve)),
  )
  const cards = navigation.navigate('cards')
  approvals.shift()!(true)
  await cards
  const back = navigation.goBack()
  expect(navigation.tab.value).toBe('cards')
  approvals.shift()!(false)
  await back
  expect(navigation.tab.value).toBe('cards')
  expect(navigation.canGoBack.value).toBe(true)
  const old = navigation.goBack(),
    newer = navigation.navigate('settings')
  approvals.shift()!(true)
  await old
  expect(navigation.tab.value).toBe('cards')
  approvals.shift()!(true)
  await newer
  expect(navigation.tab.value).toBe('settings')
  const previous = navigation.goBack()
  navigation.resetLibrary()
  approvals.shift()!(true)
  await previous
  expect(navigation.tab.value).toBe('settings')
  expect(navigation.canGoBack.value).toBe(false)
})
it('keeps instances isolated and ignores a leave approval after disposal', async () => {
  let finish!: (allowed: boolean) => void
  const scope = effectScope()
  const first = scope.run(() =>
    useAppNavigation(
      createPinia(),
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        }),
    ),
  )!
  const second = useAppNavigation(createPinia())
  const pending = first.navigate('cards')
  second.navigate('sources')
  scope.stop()
  finish(true)
  await pending
  expect(first.tab.value).toBe('overview')
  expect(second.tab.value).toBe('sources')
})
