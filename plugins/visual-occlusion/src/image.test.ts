import { describe, it, expect } from 'vitest'
import { png } from '../test/fixtures'
import { imageInfo, inspectImage } from './image'
describe('image import bounds', () => {
  it('inspects PNG, GIF and JPEG dimensions without decoding pixels', () => {
    expect(imageInfo(png())).toEqual({ width: 600, height: 400, type: 'image/png' })
    expect(imageInfo(new Uint8Array([71, 73, 70, 56, 57, 97, 120, 0, 80, 0]))).toEqual({
      width: 120,
      height: 80,
      type: 'image/gif',
    })
    expect(imageInfo(new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 80, 0, 120, 3]))).toEqual({
      width: 120,
      height: 80,
      type: 'image/jpeg',
    })
  })
  it('rejects corrupt, huge, missing and cancelled inputs', async () => {
    expect(() => imageInfo(png(20001, 1))).toThrow('20000')
    expect(() => imageInfo(png(10000, 10000))).toThrow('4000')
    expect(() => imageInfo(new Uint8Array(24))).toThrow('无法读取')
    expect(() => imageInfo(new Uint8Array([255, 216, 0, 1, 2, 3]))).toThrow('损坏')
    await expect(inspectImage(new Blob())).rejects.toThrow('10 MiB')
    const controller = new AbortController()
    controller.abort()
    await expect(
      inspectImage(new Blob([png().buffer as ArrayBuffer]), controller.signal),
    ).rejects.toThrow()
  })
})
