import { reactive } from 'vue'

export const storageKey = 'repeaty-design-b-v1'
const decks = [
  { id: 'fsrs', name: 'FSRS 与 Repeaty', count: 3, due: 2, fresh: 1 },
  { id: 'algorithms', name: '数据结构与算法', count: 3, due: 2, fresh: 1 },
  { id: 'english', name: '英语 · 常用表达', count: 3, due: 2, fresh: 1 },
  { id: 'systems', name: '分布式系统', count: 3, due: 2, fresh: 1 },
]
const records = {
  fsrs: [
    [
      '为什么主动回忆比反复阅读更有效？',
      '主动回忆需要从记忆中提取信息，而反复阅读容易把熟悉感误认为已经掌握。\n\n先尝试回答，再查看答案，并根据实际回忆情况评分。',
      ['学习方法', '主动回忆'],
    ],
    [
      'FSRS 在 Repeaty 中负责决定什么？',
      'FSRS 根据每次评分和实际间隔更新记忆状态，再安排下次复习。卡片的内容仍由你决定。',
      ['FSRS'],
    ],
    [
      '什么时候应该选择「重来」？',
      '翻面之前没有回忆出答案时选择「重来」。翻面后觉得熟悉，不代表已经成功回忆。',
      ['评分'],
    ],
  ],
  algorithms: [
    [
      '二分查找为什么要求有序数据？',
      '有序性保证比较中间元素后，可以排除不可能包含目标的一半区间。',
      ['查找'],
    ],
    ['栈与队列的主要区别是什么？', '栈遵循后进先出；队列遵循先进先出。', ['数据结构']],
    [
      '哈希冲突可以怎样处理？',
      '常见方式是链地址法和开放寻址法。它们为映射到同一位置的不同键安排存储位置。',
      ['哈希'],
    ],
  ],
  english: [
    [
      'take something for granted 是什么意思？',
      '把某事视为理所当然；也可以表示没有充分珍惜。',
      ['常用表达'],
    ],
    [
      '如何区分 affect 与 effect？',
      'affect 常作动词，表示影响；effect 常作名词，表示结果或效果。',
      ['词义'],
    ],
    ['「提前安排」可以怎样表达？', 'plan ahead 或 arrange in advance。', ['表达']],
  ],
  systems: [
    ['幂等操作有什么性质？', '重复执行同一操作，对系统产生的效果与执行一次相同。', ['接口设计']],
    [
      '复制与分片分别解决什么问题？',
      '复制使同一份数据存在多个副本；分片把数据分散到不同节点。',
      ['存储'],
    ],
    [
      '为什么分布式系统需要超时？',
      '调用方不能无限等待未知结果。超时使调用方能够恢复控制并采取后续措施。',
      ['可靠性'],
    ],
  ],
}
const initial = {
  decks,
  cards: Object.entries(records).flatMap(([deckId, rows]) =>
    rows.map(([question, answer, tags], i) => ({
      id: `${deckId}-${i + 1}`,
      deckId,
      question,
      answer,
      tags,
      status: i === 2 ? 'new' : 'due',
    })),
  ),
  settings: {
    language: 'zh-CN',
    information: true,
    warning: true,
    error: true,
    historyLimit: 12,
    historyAfterAnswer: true,
  },
  enabledPlugins: { history: true, leetcode: true, typed: true },
  reviewCount: 0,
}
let loaded
try {
  loaded = JSON.parse(localStorage.getItem(storageKey) || 'null')
} catch {
  /* fresh isolated prototype */
}
const data =
  loaded?.version === 1 && Array.isArray(loaded.data?.cards) && Array.isArray(loaded.data?.decks)
    ? loaded.data
    : structuredClone(initial)
for (const card of data.cards) {
  if (card.resumeStatus && !card.previousStatus) card.previousStatus = card.resumeStatus
  delete card.resumeStatus
}
// Keep earlier prototype edits while reconciling its illustrative deck totals.
for (const deck of data.decks) {
  const cards = data.cards.filter((card) => card.deckId === deck.id)
  deck.count = cards.length
  deck.due = cards.filter((card) => card.status === 'due').length
  deck.fresh = cards.filter((card) => card.status === 'new').length
}
const allowed = new Set([
  'home',
  'cards',
  'review',
  'settings',
  'plugins',
  'sources',
  'workspace',
  'backup',
  'controls',
])
const query = new URLSearchParams(location.search)
export const demo = reactive({
  view: allowed.has(query.get('view')) ? query.get('view') : 'home',
  selectedDeck: 'fsrs',
  cardsDeckFilter: 'all',
  selectedPlugin: 'history',
  settingsCategory: query.get('category') || 'general',
  data,
  saveError: '',
  toast: null,
})
let toastTimer
let navigationGuard = null
export function setNavigationGuard(guard) {
  navigationGuard = guard
  return () => {
    if (navigationGuard === guard) navigationGuard = null
  }
}
export function notice(message, severity = 'success') {
  clearTimeout(toastTimer)
  demo.toast = { message, severity }
  toastTimer = setTimeout(
    () => {
      demo.toast = null
    },
    severity === 'error' ? 12000 : 4500,
  )
}
export function navigate(view, options = {}) {
  if (!allowed.has(view)) return
  if (navigationGuard && navigationGuard(view, options) === false) return
  Object.assign(demo, options, { view, saveError: '' })
  const url = new URL(location.href)
  url.searchParams.set('view', view)
  if (view === 'settings') url.searchParams.set('category', demo.settingsCategory)
  else url.searchParams.delete('category')
  history.replaceState(null, '', url)
}
export function commit(mutator, successMessage = '已保存') {
  const next = JSON.parse(JSON.stringify(demo.data))
  try {
    mutator(next)
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, data: next }))
    demo.data = next
    demo.saveError = ''
    if (successMessage) notice(successMessage)
    return true
  } catch {
    demo.saveError = '保存失败，输入内容仍保留。请检查浏览器存储后重试。'
    notice(demo.saveError, 'error')
    return false
  }
}
export function saveSettings(patch) {
  return commit((next) => {
    Object.assign(next.settings, patch)
  }, '设置已保存')
}
