import { locale } from '@repeaty/plugin-api'

const messages = {
  title: ['学习统计', 'Study statistics'],
  description: [
    '分清已完成的学习与接下来的安排。',
    'Recorded learning and what is currently scheduled.',
  ],
  refresh: ['刷新统计', 'Refresh statistics'],
  loading: ['正在读取学习记录…', 'Loading study records…'],
  failed: ['未能读取统计', 'Could not load statistics'],
  retained: ['上次结果仍保留，可以重试。', 'The previous result is kept. You can retry.'],
  retry: ['重试', 'Retry'],
  month: ['查看月份', 'Choose month'],
  previous: ['上个月', 'Previous month'],
  next: ['下个月', 'Next month'],
  today: ['今天', 'Today'],
  recorded: ['已记录', 'Recorded'],
  scheduled: ['当前计划', 'Scheduled'],
  reviews: ['正式评分', 'Ratings'],
  readings: ['阅读完成', 'Readings completed'],
  practices: ['纯练习', 'Practice only'],
  foreground: ['前台使用', 'Active use'],
  scheduledCards: ['计划卡片', 'Scheduled cards'],
  scheduledReadings: ['计划阅读', 'Scheduled readings'],
  monthRecord: ['本月已记录', 'Recorded this month'],
  dayRecord: ['当日记录', 'Daily activity'],
  dailyDetails: ['日期明细', 'Daily details'],
  detailKind: ['明细类别', 'Detail category'],
  unknown: ['未记录', 'Not recorded'],
  noDetails: ['这一天没有此类记录。', 'No entries of this kind on this day.'],
  noPlanned: ['这一天没有已保存的安排。', 'Nothing is currently scheduled for this day.'],
  detailsLoading: ['正在读取明细…', 'Loading details…'],
  more: ['加载更多', 'Load more'],
  changed: [
    '记录已变化，请刷新统计后继续查看。',
    'Records changed. Refresh statistics to continue.',
  ],
  scopeChanged: ['学习库已切换，请重新打开统计。', 'The library changed. Reopen statistics.'],
  keyboard: [
    '学习日历，方向键切换日期，PageUp 和 PageDown 切换月份',
    'Study calendar. Arrow keys change day; Page Up and Page Down change month.',
  ],
  planNote: [
    '计划来自当前保存的日期，不预测未来评分，也不扣除每日额度。逾期项目合并到今天。',
    'Plans use saved due dates, not predicted ratings or daily quotas. Overdue items appear today.',
  ],
  coverageNote: [
    '未记录时期显示“—”。阅读与纯练习按完成次数统计；评分撤销后会移除对应次数。',
    'Unrecorded periods show “—”. Readings and practice count completions; undone ratings are removed.',
  ],
  activityNote: [
    '仅累计前台活跃时间；阅读、复习和练习时间包含在前台总时长中。',
    'Only active foreground time is counted. Reading, review and practice time are part of the total.',
  ],
  readingTime: ['阅读时间', 'Reading time'],
  reviewTime: ['复习时间', 'Review time'],
  practiceTime: ['练习时间', 'Practice time'],
  noHistory: [
    '开始学习后，实际记录会出现在日历中。',
    'Your recorded activity will appear here as you study.',
  ],
  completionUnit: ['次', 'events'],
  planUnit: ['项计划', 'planned'],
  items: ['项', 'items'],
  dayStarts: ['学习日开始于', 'Study day starts at'],
  futureNote: [
    '这些是当前保存的安排，会随后续学习而变化。',
    'These saved plans will change as you continue studying.',
  ],
} as const

export function text(key: keyof typeof messages) {
  return messages[key][!locale.value.startsWith('zh') ? 1 : 0]
}
export function duration(value: number | null) {
  if (value === null) return '—'
  if (value === 0) return !locale.value.startsWith('zh') ? '0 min' : '0 分钟'
  const minutes = Math.floor(value / 60_000)
  if (minutes === 0) return !locale.value.startsWith('zh') ? '< 1 min' : '不足 1 分钟'
  const hours = Math.floor(minutes / 60)
  if (!hours) return !locale.value.startsWith('zh') ? `${minutes} min` : `${minutes} 分钟`
  return !locale.value.startsWith('zh')
    ? `${hours} h ${minutes % 60} min`
    : `${hours} 小时 ${minutes % 60} 分钟`
}
