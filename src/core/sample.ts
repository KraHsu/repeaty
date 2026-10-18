import { t } from '../i18n'
import { emptyLibrary, saveNote, type Library } from './model'

export function sampleLibrary(): Library {
  const now = new Date()
  const deckId = crypto.randomUUID()
  let library: Library = {
    ...emptyLibrary(),
    decks: [
      {
        id: deckId,
        name: t('学习如何学习'),
        description: t('5 张示例卡片，介绍制卡、评分和间隔复习。'),
        color: 'sage',
        newLimit: 20,
        burySiblings: true,
        leechThreshold: 8,
        desiredRetention: 0.9,
        reviewLimit: 200,
        createdAt: now.toISOString(),
      },
    ],
  }
  const entries = [
    [
      '什么是主动回忆？',
      '暂时不看答案，尝试从记忆中提取信息。比如，先回答卡片上的问题，再翻面核对。',
    ],
    [
      '为什么把复习分散到不同的时间？',
      '在逐渐拉长的间隔中回想同一条知识，可以帮助巩固长期记忆。这就是间隔复习。',
    ],
    [
      '一张好的记忆卡片应该包含多少知识？',
      '尽量只考一个明确的知识点。问题清楚、答案简短，才能准确判断自己是否记住了。',
    ],
    ['忘记一张卡片时，该如何评分？', '选择「重来」，这张卡片会在较短时间内再次出现。'],
    [
      '怎样让每天的复习更容易坚持？',
      '从少量卡片开始，把复习放在一个固定的日常时刻。先处理到期卡片，再逐渐加入新内容。',
    ],
  ]
  for (const [front, back] of entries)
    library = saveNote(
      library,
      {
        deckId,
        type: 'basic',
        front: t(front!),
        back: t(back!),
        tags: [t('入门')],
        frontMedia: [],
        backMedia: [],
      },
      undefined,
      false,
      now,
    )
  return library
}
