import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('registers every bundled native command in the build manifest and limits its permission to the main window', () => {
  const source = readFileSync('src-tauri/src/main.rs', 'utf8')
  const build = readFileSync('src-tauri/build.rs', 'utf8')
  const capability = JSON.parse(readFileSync('src-tauri/capabilities/main.json', 'utf8')) as {
    windows: string[]
    permissions: string[]
  }
  const commands = source
    .match(/generate_handler!\[([\s\S]*?)\]/)![1]!
    .split(',')
    .map((name) => name.trim().split('::').at(-1)!)
    .filter(Boolean)
    .sort()
  const registered = [...build.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!).sort()
  expect(registered).toEqual(commands)
  expect(capability.windows).toEqual(['main'])
  for (const name of commands)
    expect(capability.permissions).toContain('allow-' + name.replaceAll('_', '-'))
})
