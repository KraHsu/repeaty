export const studySchedulingMessages = {
  '每 {cards} 张卡片穿插 {readings} 篇材料。':
    'Alternate {cards} cards with {readings} reading items.',
  '每轮先复习几张卡片？': 'How many cards should each cycle start with?',
  '新卡或学习安排已变化，请重新预览。':
    'New cards or study scheduling changed. Preview the plan again.',
  '安排窗口或新卡额度不足，请扩大窗口或减少选择后重新预览。':
    'The window or new-card allowance is too small. Extend the window or select fewer cards, then preview again.',
  '学习日开始时间需为 0–23 时。': 'The study day must start between 00:00 and 23:00.',
  '学习日期无效。': 'The study date is invalid.',
  '学习间隔需为 0–36500 天。': 'The study interval must be between 0 and 36,500 days.',
  '学习优先级或权重无效。': 'The study priority or weight is invalid.',
  '学习优先级需为 0–9。': 'The study priority must be between 0 and 9.',
  '阅读增长范围的最小值不能超过最大值。':
    'The minimum reading growth factor cannot exceed the maximum.',
  '阅读初始间隔不能超过最大间隔。': 'The initial reading interval cannot exceed the maximum.',
} as const
