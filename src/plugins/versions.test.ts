import { expect, it } from 'vitest'
import { comparePluginVersions } from './versions'

it.each([
  ['1.0.0', '1.0.0', 0],
  ['1.10.0', '1.2.0', 1],
  ['2.0.0', '2.0.0-beta.1', 1],
  ['1.0.0-beta.10', '1.0.0-beta.2', 1],
  ['1.0.0-beta.1', '1.0.0', -1],
  ['1.0.0-beta.1', '1.0.0-beta.2', -1],
  ['1.0.0', '1.0.1', -1],
  ['1.0.0-alpha', '1.0.0-alpha.1', -1],
  ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
  ['1.0.0-alpha.beta', '1.0.0-beta', -1],
  ['1.0.0-beta.11', '1.0.0-rc.1', -1],
  ['9007199254740993.0.0', '9007199254740992.0.0', 1],
  ['1.0.0-beta.9007199254740993', '1.0.0-beta.9007199254740992', 1],
  ['1.0.0-beta.9007199254740993', '1.0.0-beta.9007199254740993', 0],
])('compares %s with %s without an accidental downgrade', (left, right, order) => {
  expect(comparePluginVersions(left, right)).toBe(order)
  expect(comparePluginVersions(right, left)).toBe(order === 0 ? 0 : -order)
})
