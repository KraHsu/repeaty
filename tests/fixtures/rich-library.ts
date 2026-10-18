import { fixture, input, now } from '../../src/core/test-fixtures'
import { saveNote, type MediaUpload } from '../../src/core/model'

export function richLibrary(large = true) {
  const front = (
    '长文本，保持原样。 Long text with spaces and line breaks.\n' +
    'unbroken'.repeat(60) +
    '\n'
  )
    .repeat(30)
    .slice(0, 10_000)
    .trim()
  const back = '答案与解释。 **Markdown** $x^2$\n'.repeat(500).slice(0, 10_000).trim()
  let library = fixture({ front, back, format: 'plain' })
  const png = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    ),
    (char) => char.charCodeAt(0),
  )
  const size = large ? 8 * 1024 * 1024 : 16_044
  const wav = new Uint8Array(size),
    view = new DataView(wav.buffer)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) wav[offset + i] = value.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, size - 8, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 16000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, size - 44, true)
  for (let i = 44; i + 1 < size; i += 2) view.setInt16(i, Math.round(Math.sin(i / 20) * 1000), true)
  const assets: MediaUpload[] = Array.from({ length: 17 }, (_, i) => {
    const blob = new Blob([i ? wav : png], { type: i ? 'audio/wav' : 'image/png' })
    return {
      blob,
      meta: {
        id: `media-${i}`,
        name: i ? `audio-${i}.wav` : 'pixel.png',
        type: i ? 'audio/wav' : 'image/png',
        size: blob.size,
        createdAt: now.toISOString(),
      },
    }
  })
  library.media = assets.map((asset) => asset.meta)
  library.notes[0]!.frontMedia = assets.slice(0, 8).map((asset) => asset.meta.id)
  library.notes[0]!.backMedia = assets.slice(8, 16).map((asset) => asset.meta.id)
  library = saveNote(
    library,
    {
      ...input,
      front: 'Second media card',
      back: 'Audio attached',
      frontMedia: [assets[16]!.meta.id],
    },
    undefined,
    false,
    now,
  )
  return { library, assets, front, back }
}
