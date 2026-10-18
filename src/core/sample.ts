import { locale, type Locale } from '../i18n'
import { emptyLibrary, saveNote, type Library, type MediaUpload } from './model'
import { content } from './starter/content'
import { starterMedia } from './starter/media'

export function createStarterDeck(
  language: Locale = locale.value,
  now = new Date(),
): { library: Library; assets: MediaUpload[] } {
  const deckId = crypto.randomUUID(),
    copy = content[language]
  const media = starterMedia(now),
    assets = Object.values(media)
  let library: Library = {
    ...emptyLibrary(),
    decks: [
      {
        id: deckId,
        name: copy.name,
        description: copy.description,
        color: 'sage',
        newLimit: 30,
        reviewLimit: 200,
        burySiblings: true,
        leechThreshold: 8,
        desiredRetention: 0.9,
        createdAt: now.toISOString(),
      },
    ],
  }
  copy.entries.forEach((entry, index) => {
    // Distinct, already-due timestamps preserve the teaching order without fake reviews.
    const createdAt = new Date(now.getTime() - (copy.entries.length - index) * 1000)
    library = saveNote(
      {
        ...library,
        media: entry.media ? [...library.media, media[entry.media].meta] : library.media,
      },
      {
        deckId,
        type: entry.type ?? 'basic',
        format: entry.format ?? 'markdown',
        front: entry.front,
        back: entry.back,
        tags: ['starter', entry.topic],
        frontMedia: entry.media ? [media[entry.media].meta.id] : [],
        backMedia: [],
      },
      undefined,
      false,
      createdAt,
    )
  })
  return { library, assets }
}
