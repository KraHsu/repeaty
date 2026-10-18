import curve from './recall.png?inline'
import type { MediaUpload } from '../model'

function tones(): Blob {
  const rate = 22050,
    duration = 1.4
  const samples = Math.round(rate * duration)
  const bytes = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(bytes)
  const text = (offset: number, value: string) =>
    [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, bytes.byteLength - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) {
    const time = i / rate,
      local = time < 0.7 ? time : time - 0.7
    const envelope = Math.max(0, Math.min(local / 0.02, (0.5 - local) / 0.02, 1))
    view.setInt16(
      44 + i * 2,
      Math.round(6000 * envelope * Math.sin(2 * Math.PI * (time < 0.7 ? 440 : 880) * local)),
      true,
    )
  }
  return new Blob([bytes], { type: 'audio/wav' })
}

export function starterMedia(now: Date): Record<'curve' | 'tones', MediaUpload> {
  const make = (name: string, blob: Blob): MediaUpload => ({
    meta: {
      id: crypto.randomUUID(),
      name,
      type: blob.type as MediaUpload['meta']['type'],
      size: blob.size,
      createdAt: now.toISOString(),
    },
    blob,
  })
  return {
    curve: make(
      'recall-curves.png',
      new Blob([Uint8Array.from(atob(curve.split(',')[1]!), (char) => char.charCodeAt(0))], {
        type: 'image/png',
      }),
    ),
    tones: make('ascending-tones.wav', tones()),
  }
}
