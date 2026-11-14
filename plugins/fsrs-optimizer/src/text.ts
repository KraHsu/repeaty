import { locale, t as hostText } from '@repeaty/plugin-api'

const messages = {
  title: ['个人 FSRS 参数', 'Personal FSRS parameters'],
  description: [
    '用自己的复习记录训练参数，让后续排程更贴近记忆习惯。',
    'Train on your review history to personalize future scheduling.',
  ],
  train: ['开始训练', 'Train parameters'],
  cancel: ['取消训练', 'Cancel training'],
  scope: ['训练范围', 'Training scope'],
  library: ['整个学习库', 'Entire library'],
  records: ['条复习记录', 'reviews'],
  threshold: [
    '至少需要 1,024 条记录，并留出足够的跨日复习用于验证。',
    'At least 1,024 reviews and enough held-out reviews across days are required.',
  ],
  current: ['正在使用', 'Currently using'],
  defaults: ['默认参数 / 学习库参数', 'Default / library parameters'],
  unchanged: [
    '只影响之后的评分与排程，不重算已保存的到期时间或历史。',
    'Only future ratings and scheduling change. Existing due dates and history stay intact.',
  ],
  rollback: ['恢复上一套参数', 'Restore previous parameters'],
  comparison: ['训练结果', 'Training results'],
  comparisonHint: [
    '在后 20% 的历史记录上独立验证。两个指标越低越好，均有改善才保留候选。',
    'Independently validated on the latest 20% of history. Both metrics must improve; lower is better.',
  ],
  date: ['训练时间', 'Trained'],
  loss: ['预测误差 · Log loss', 'Prediction error · Log loss'],
  rmse: ['分组校准误差 · RMSE', 'Grouped calibration error · RMSE'],
  beforeAfter: ['原参数 → 候选参数', 'Baseline → candidate'],
  samples: ['训练 / 验证', 'Training / validation'],
  adopt: ['采用参数', 'Use parameters'],
  active: ['使用中', 'Active'],
  empty: ['尚无通过验证的训练结果', 'No validated training results yet'],
  emptyHint: [
    '记录充足时可以开始训练。数据始终留在设备上，训练期间可以取消。',
    'Start training once enough history is available. Data stays on this device; training can be cancelled.',
  ],
  local: ['本机训练 · FSRS-6', 'On-device training · FSRS-6'],
  loading: ['正在读取复习记录…', 'Loading review history…'],
  retry: ['重新读取', 'Retry'],
  preparing: ['正在固定历史快照…', 'Preparing a history snapshot…'],
  training: ['正在训练参数…', 'Training parameters…'],
  validating: ['正在独立验证候选参数…', 'Independently validating parameters…'],
  activating: ['正在采用参数…', 'Applying parameters…'],
  rollbackPhase: ['正在恢复上一套参数…', 'Restoring previous parameters…'],
  candidate: [
    '已生成通过验证的候选参数，可在下方比较后采用。',
    'A validated candidate is ready. Compare it below before applying.',
  ],
  activated: [
    '已采用参数，将用于之后的评分与排程。',
    'Parameters applied for future ratings and scheduling.',
  ],
  'rolled-back': [
    '已恢复上一套参数。已有到期时间和历史保持不变。',
    'Previous parameters restored. Existing due dates and history remain unchanged.',
  ],
  cancelled: [
    '已取消训练，当前参数保持不变。',
    'Training cancelled. Current parameters remain unchanged.',
  ],
  study: ['学习', 'Study'],
  review: ['复习', 'Review'],
  settings: ['个人参数自动训练', 'Automatic parameter training'],
  settingsHint: [
    '按学习库或卡组分别设置。自动训练和自动采用默认关闭。',
    'Configure the library or each deck separately. Both options are off by default.',
  ],
  automatic: ['空闲时自动训练', 'Train automatically when idle'],
  automaticHint: [
    '每新增约 1,024 条记录，在前台空闲 30 秒且未学习时训练；恢复操作即取消。',
    'Train after each additional 1,024 reviews, while foreground, idle for 30 seconds, and not studying. Activity cancels training.',
  ],
  apply: ['自动采用通过验证的参数', 'Automatically apply validated parameters'],
  applyHint: [
    '只有两个验证指标均改善且历史未变化时才采用，否则继续使用当前参数。',
    'Apply only if both validation metrics improve and history has not changed. Otherwise keep current parameters.',
  ],
  automaticOn: ['此范围已开启空闲自动训练', 'Idle training enabled for this scope'],
  autoApplyOn: ['验证通过后自动采用', 'Validated parameters apply automatically'],
  autoCandidate: [
    '自动训练只生成候选，采用前仍需确认',
    'Automatic training only creates candidates for you to apply',
  ],
  fallbackError: [
    '训练未完成，当前参数保持不变。请重试。',
    'Training could not finish. Current parameters are unchanged. Please try again.',
  ],
} as const

export function text(key: keyof typeof messages) {
  return messages[key][!locale.value.startsWith('zh') ? 1 : 0]
}

const errors: Record<string, readonly [string, string]> = {
  'study-service-unavailable': [
    '当前软件版本尚未提供参数训练服务，请更新 Repeaty。',
    'This version of Repeaty does not provide parameter training. Update Repeaty.',
  ],
  'training-submission-in-progress': [
    '这次训练结果正在验证，请等待完成。',
    'This training result is already being validated. Please wait.',
  ],
  'candidate-not-improved': [
    '候选参数未同时改善两个验证指标，继续使用当前参数。',
    'The candidate did not improve both validation metrics. Current parameters remain unchanged.',
  ],
  'stale-training-history': [
    '复习记录或当前参数已变化，请重新训练。',
    'Review history or current parameters have changed. Train again.',
  ],
  'expired-training-snapshot': [
    '本次训练已过期，请重新开始。',
    'This training snapshot expired. Start again.',
  ],
  'stale-workspace-session': [
    '学习库已切换，本次操作已取消。',
    'The library changed. This operation was cancelled.',
  ],
  'invalid-fsrs-weights': [
    '参数不符合 FSRS-6 的范围要求，未采用。',
    'Parameters are outside FSRS-6 bounds and were not applied.',
  ],
  'missing-deck': [
    '卡组已不存在，请选择其他训练范围。',
    'This deck no longer exists. Choose another training scope.',
  ],
  'missing-fsrs-model': [
    '训练结果已不存在，请重新训练。',
    'This training result no longer exists. Train again.',
  ],
  'stale-fsrs-model': [
    '当前参数已变化，请刷新后重试。',
    'Current parameters changed. Refresh and try again.',
  ],
  'missing-baseline-model': [
    '上一套参数已不存在，无法回退。',
    'The previous parameters no longer exist and cannot be restored.',
  ],
  'too-many-training-snapshots': [
    '已有过多训练任务，请取消其他任务后再试。',
    'Too many training snapshots are open. Cancel other tasks and retry.',
  ],
  'fsrs-model-limit': [
    '保存的训练结果已达到上限，未保存新候选。',
    'The saved model limit was reached. No new candidate was saved.',
  ],
  'insufficient-training-history': [
    '跨日复习样本不足，继续复习后再训练。',
    'Not enough reviews across days. Keep reviewing before training again.',
  ],
  'training-limit': [
    '当前历史超过本机训练上限，请选择较小的卡组。',
    'History exceeds the local training limit. Select a smaller deck.',
  ],
  'invalid-training-history': [
    '历史中有不完整或不支持的记录，未启动训练。',
    'History contains incomplete or unsupported records. Training was not started.',
  ],
  'unsupported-model': ['此训练器只支持 FSRS-6。', 'This trainer supports FSRS-6 only.'],
  'optimizer-asset-missing': [
    '训练器文件缺失，请重新安装此插件。',
    'Optimizer files are missing. Reinstall this plugin.',
  ],
  'optimizer-asset-invalid': [
    '训练器文件无法读取，请重新安装此插件。',
    'Optimizer files could not be read. Reinstall this plugin.',
  ],
  'optimizer-worker-failed': [
    '训练进程未能启动，请重试或重新安装插件。',
    'The training worker could not start. Retry or reinstall the plugin.',
  ],
  'optimizer-timeout': [
    '训练超过两分钟，已释放资源。请选择较小的卡组重试。',
    'Training exceeded two minutes and was stopped. Try a smaller deck.',
  ],
  'invalid-trained-parameters': [
    '训练结果无效，当前参数保持不变。',
    'Training returned invalid parameters. Current parameters are unchanged.',
  ],
  'optimizer-settings-failed': [
    '设置保存失败，请重试。',
    'Settings could not be saved. Please retry.',
  ],
}

export function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const entry = errors[message]
  if (entry) return entry[!locale.value.startsWith('zh') ? 1 : 0]
  const translated = hostText(error instanceof Error ? error : message)
  return translated || text('fallbackError')
}
