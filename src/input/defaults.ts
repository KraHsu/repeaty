export type InputContext = 'global' | 'review' | 'material' | 'editor'
export interface InputDefinition {
  id: string
  title: string
  context: InputContext
  defaultShortcuts?: readonly string[]
}
export const inputDefaults: readonly InputDefinition[] = [
  { id: 'app.back', title: '后退', context: 'global', defaultShortcuts: ['Alt+ArrowLeft'] },
  { id: 'app.forward', title: '前进', context: 'global', defaultShortcuts: ['Alt+ArrowRight'] },
  { id: 'document.top', title: '滚动到顶部', context: 'global' },
  { id: 'document.bottom', title: '滚动到底部', context: 'global' },
  { id: 'app.undo', title: '撤销最近操作', context: 'global', defaultShortcuts: ['Mod+Z'] },
  {
    id: 'app.redo',
    title: '重做最近操作',
    context: 'global',
    defaultShortcuts: ['Mod+Shift+Z', 'Mod+Y'],
  },
  { id: 'app.add', title: '添加卡片 / 笔记', context: 'global', defaultShortcuts: ['A'] },
  { id: 'app.search', title: '搜索卡片', context: 'global', defaultShortcuts: ['/'] },
  { id: 'app.cards', title: '浏览卡片', context: 'global', defaultShortcuts: ['B'] },
  { id: 'app.review', title: '开始复习', context: 'global', defaultShortcuts: ['R'] },
  { id: 'app.shortcuts', title: '快捷键', context: 'global', defaultShortcuts: ['Shift+?'] },
  { id: 'review.edit', title: '编辑当前卡片', context: 'review', defaultShortcuts: ['E'] },
  {
    id: 'review.delete',
    title: '删除当前笔记',
    context: 'review',
    defaultShortcuts: ['Mod+Delete'],
  },
  { id: 'review.bury', title: '今天暂缓', context: 'review', defaultShortcuts: ['B'] },
  { id: 'review.suspend', title: '暂停当前卡片', context: 'review', defaultShortcuts: ['S'] },
  { id: 'review.reveal', title: '显示答案', context: 'review', defaultShortcuts: ['Space'] },
  { id: 'review.again', title: '重来', context: 'review', defaultShortcuts: ['1'] },
  { id: 'review.hard', title: '困难', context: 'review', defaultShortcuts: ['2'] },
  { id: 'review.good', title: '良好', context: 'review', defaultShortcuts: ['3'] },
  { id: 'review.easy', title: '简单', context: 'review', defaultShortcuts: ['4'] },
  { id: 'review.close', title: '结束复习', context: 'review', defaultShortcuts: ['Escape'] },
  { id: 'editor.save', title: '保存当前表单', context: 'editor', defaultShortcuts: ['Mod+Enter'] },
  { id: 'editor.cloze', title: '添加挖空', context: 'editor', defaultShortcuts: ['Mod+Shift+C'] },
  { id: 'material.copy', title: '复制选区', context: 'material' },
  { id: 'material.preview', title: '切换阅读视图', context: 'material' },
  { id: 'material.export', title: '导出原文件', context: 'material' },
  { id: 'material.excerpt', title: '摘录选区', context: 'material' },
  { id: 'material.card', title: '选区制卡', context: 'material' },
  { id: 'material.cloze', title: '选区挖空', context: 'material' },
  { id: 'material.annotation', title: '批注选区', context: 'material' },
  { id: 'material.share', title: '分享选区', context: 'material' },
]
