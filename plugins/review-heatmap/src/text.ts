import { locale } from '@repeaty/plugin-api'

const messages = {
  title: ['复习热力图', 'Review heatmap'],
  description: ['过去365天 · 按本地日期统计', 'Past 365 local calendar days'],
  accessible: ['过去365天复习次数', 'Ratings in the past 365 days'],
  ratingCount: ['次复习', 'ratings'],
  empty: [
    '过去365天还没有复习记录，完成一次复习就会点亮今天。',
    'No reviews in the past 365 days. Complete a review to light up today.',
  ],
  less: ['少', 'Less'],
  more: ['多', 'More'],
  legend: [
    '颜色由浅到深：0、1–2、3–5、6–9、10次及以上复习',
    'Color levels: 0, 1–2, 3–5, 6–9, and 10 or more ratings',
  ],
  keyboard: [
    '复习日历，方向键切换日期，Home 跳到最早，End 跳到今天',
    'Review calendar. Use arrow keys to move between dates, Home for the first day, End for today.',
  ],
} as const

export function text(key: keyof typeof messages) {
  return messages[key][locale.value === 'en' ? 1 : 0]
}
