export const recoveryMessages = {
  '备份未通过完整校验。': 'The backup has not passed full verification.',
  '备份中的路径对应多个版本，请重新搜索并选择具体内容。':
    'This backup path has multiple versions. Search again and select a specific item.',
  '所选内容使用了相同文件路径，请分开恢复。':
    'Selected items use the same file path. Restore them separately.',
  '所选内容引用了同路径的不同附件版本，请分开恢复。':
    'Selected items reference different attachment versions at the same path. Restore them separately.',
  刷新: 'Refresh',
  显示更多: 'Show more',
  已退役: 'Retired',
  快照中的历史版本: 'Historical version in snapshot',
  '规则有未保存的更改；立即备份仍使用已保存的规则。':
    'Your policy has unsaved changes. Back up now uses the saved policy.',
  '此备份中没有匹配的内容。': 'No matching content in this backup.',
  '包含学习材料和原文快照。': 'Includes materials and source snapshots.',
  退役记录: 'Retired records',
  学习附件: 'Learning attachments',
  附件对象: 'Attachment objects',
  材料导入记录: 'Material import receipts',
  设置与插件数据: 'Settings and plugin data',
  学习库与媒体已导出: 'Learning library and media exported',
  '重做：{action}': 'Redo: {action}',
  '已重做：{action}': 'Redone: {action}',
  重做最近操作: 'Redo last operation',
  重做: 'Redo',
  完整工作目录备份: 'Complete workspace backups',
  '包含退役内容、草稿、材料版本、附件和插件。设备凭据与代码信任留在本机。':
    'Includes retired content, drafts, material versions, attachments and plugins. Device credentials and code trust stay on this device.',
  打开完整备份: 'Open workspace backup',
  立即备份: 'Back up now',
  '正在读取或校验备份…': 'Reading or verifying backup…',
  '完整备份已写入并通过校验。': 'The complete backup was saved and verified.',
  '选择独立目录保存完整备份。使用另一块磁盘可减少设备故障造成的损失。':
    'Save complete backups in a separate folder. Using another drive helps protect against device failure.',
  选择备份目录: 'Choose backup folder',
  备份位置与保留规则: 'Destinations and retention',
  自动备份已开启: 'Automatic backups on',
  自动备份未开启: 'Automatic backups off',
  备份目录: 'Backup folder',
  额外副本: 'Additional copy',
  更换: 'Change',
  移除位置: 'Remove destination',
  添加额外副本位置: 'Add another destination',
  应用运行时自动备份: 'Back up automatically while the app is running',
  '间隔（分钟）': 'Interval (minutes)',
  '保留最近 {unit}数': 'Recent {unit} to keep',
  '每个时间段保留最新一份，按 UTC 分组，始终保留最新备份。新备份校验成功后才清理旧备份；移除位置不会删除文件。':
    'Keep the newest copy in each UTC period, always keeping the latest backup. Older copies are removed only after a new backup is verified. Removing a destination does not delete its files.',
  保存规则: 'Save policy',
  '备份规则已保存。': 'Backup policy saved.',
  可恢复的备份: 'Available backups',
  个文件: 'files',
  预览与恢复: 'Preview and restore',
  '此位置还没有完整备份。也可打开其他设备保存的 .repeaty-workspace 文件。':
    'No complete backups here yet. You can also open a .repeaty-workspace file saved on another device.',
  数据库检查与空间整理: 'Database checks and maintenance',
  '检查数据库完整性；整理只回收数据库空闲页，不删除学习内容。操作期间写入会等待。':
    'Check database integrity or reclaim unused database pages. Learning content is preserved. Writes wait during maintenance.',
  检查数据库: 'Check database',
  整理空间: 'Reclaim space',
  数据库: 'Database',
  可回收: 'Reclaimable',
  预览完整备份: 'Preview workspace backup',
  校验通过: 'Verified',
  '恢复会在所选位置创建新目录，不覆盖当前库。完整恢复保留记录与调度，插件需在本设备重新信任。':
    'Restore creates a new folder at the selected location. Your current library stays intact. A full restore retains records and schedules; plugins require trust on this device.',
  搜索备份中的标题或正文: 'Search titles or text in the backup',
  '选择 {title}': 'Select {title}',
  '显示前 100 项，请缩小搜索范围。':
    'Showing the first 100 results. Refine your search to find more.',
  '所选内容恢复为可导入的文件副本及附件，不合并当前库的调度或历史。':
    'Selected content is restored as importable files with attachments. Schedules and history are not merged into your current library.',
  '所选内容已恢复为文件副本，可重新导入；当前学习库保持不变。':
    'Selected content restored as file copies for import. Your current library is unchanged.',
  '已恢复到新工作目录，当前学习库保持不变。':
    'Restored to a new workspace. Your current library is unchanged.',
  打开恢复的工作目录: 'Open restored workspace',
  恢复所选文件副本: 'Restore selected file copies',
  恢复为新工作目录: 'Restore as new workspace',
  导出学习库: 'Export learning library',
  导入学习库: 'Import learning library',
  '包含学习材料和原文快照；完整工作目录请使用上方的备份。':
    'Includes materials and source snapshots. Use complete workspace backups for the whole folder.',
  '库内快照保留最近 10 份学习数据及其附件。它们与当前库在同一目录，请另外保存完整备份。':
    'In-library snapshots retain the latest 10 copies of learning data and attachments. They share the current folder, so save complete backups separately.',
  '使用 FSRS 安排复习，数据保存在工作目录中。':
    'Reviews scheduled with FSRS. Data stored in your workspace folder.',
  '备份已取消，原有备份与当前库保持不变。':
    'Backup cancelled. Existing backups and your library are unchanged.',
  '备份损坏或校验不一致，未恢复任何内容。':
    'The backup is corrupt or failed verification. Nothing was restored.',
  '不支持这个完整备份格式。': 'This workspace backup format is not supported.',
  '备份过程中有外部文件变化，请重试。': 'External files changed during backup. Please try again.',
  '备份目标不能与工作目录重叠。': 'The backup destination must not overlap the workspace.',
  '目标已存在，文件不会被覆盖。': 'The destination exists. No files were overwritten.',
  '备份含有链接或不安全的路径，已停止操作。':
    'The backup contains links or unsafe paths. The operation was stopped.',
  '备份超过支持的大小或文件数量。': 'The backup exceeds supported size or file limits.',
  '已有备份任务正在执行。': 'Another backup task is running.',
  '工作目录仍有待完成的文件写入，请完成后重试备份。':
    'The workspace has unfinished file writes. Complete them before backing up.',
} as const
