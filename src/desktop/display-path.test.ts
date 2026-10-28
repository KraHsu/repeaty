import { expect, it } from 'vitest'
import { displayFilesystemPath } from './display-path'

it('displays extended DOS paths without the Windows namespace prefix', () => {
  expect(displayFilesystemPath(String.raw`\\?\D:\tmp\repeaty-test`)).toBe(
    String.raw`D:\tmp\repeaty-test`,
  )
  expect(displayFilesystemPath(String.raw`\\?\c:\学习库\Repeaty 用户\笔记.md`)).toBe(
    String.raw`c:\学习库\Repeaty 用户\笔记.md`,
  )
  expect(displayFilesystemPath('\\\\?\\D:\\')).toBe('D:\\')
})

it('displays extended UNC paths as ordinary network paths', () => {
  expect(displayFilesystemPath(String.raw`\\?\UNC\server\share\学习库`)).toBe(
    String.raw`\\server\share\学习库`,
  )
  expect(displayFilesystemPath(String.raw`\\?\unc\server\share`)).toBe(String.raw`\\server\share`)
})

it('leaves ordinary, relative and non-Windows paths unchanged', () => {
  for (const path of [
    String.raw`D:\tmp\repeaty-test`,
    String.raw`\\server\share\library`,
    '/home/user/学习库',
    '/tmp/\\?\\D:\\literal',
    'notes/card.md',
    '',
  ])
    expect(displayFilesystemPath(path)).toBe(path)
})

it('preserves device namespaces and incomplete or non-absolute extended paths', () => {
  for (const path of [
    String.raw`\\.\COM1`,
    String.raw`\\?\GLOBALROOT\Device\HarddiskVolume1`,
    String.raw`\\?\Volume{12345678-1234-1234-1234-123456789abc}\library`,
    String.raw`\\?\D:relative`,
    String.raw`\\?\UNC\server`,
    String.raw`\\?\UNC\\share`,
  ])
    expect(displayFilesystemPath(path)).toBe(path)
})
