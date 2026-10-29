import { locale } from '@repeaty/plugin-api'

const messages = {
  title: ['复习热力图', 'Review heatmap'],
  description: [
    '最近28天，按本地日期统计正式评分。',
    'Formal ratings over the last 28 local calendar days.',
  ],
  accessible: ['最近28天复习次数', 'Ratings in the last 28 days'],
  ratingCount: ['次复习', 'ratings'],
  empty: ['最近28天还没有正式复习记录。', 'No formal reviews in the last 28 days.'],
} as const

export function text(key: keyof typeof messages) {
  return messages[key][locale.value === 'en' ? 1 : 0]
}
