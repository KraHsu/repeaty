// Chinese source messages are catalog keys. Never translate stored user content.
export const en = {
  '正文引用的附件已变化，接受后保存新的附件版本。':
    'An attachment used in this document has changed. Accept it to save a new version.',
  编辑材料: 'Edit source',
  '正在查看摘录保存时的版本。': 'This is the version saved with the excerpt.',
  '这篇摘录已经编辑，出处保留最初摘录的原文。':
    'This excerpt has been edited. Its origin still points to the original quotation.',
  '接受新版本后，已有摘录继续引用原版。阅读安排保持不变。':
    'Existing excerpts will keep their original version. The reading schedule stays the same.',
  接受材料修改: 'Accept source changes',
  '来源链接（选填）': 'Source URL (optional)',
  '正文或附件变更后，从新版开头阅读；只改标题或文件名会保留当前位置。阅读安排、摘录和卡片进度不变。':
    'Changes to text or attachments start a new version at the beginning. Renaming the title or file keeps your location. Schedules, excerpts and card progress stay the same.',
  历史版本: 'Previous versions',
  '旧版正文和阅读位置保留。查看旧版不会改变当前阅读进度。':
    'Previous text and reading locations are kept. Viewing a previous version leaves your current reading progress unchanged.',
  '版本 {number} · {date}': 'Version {number} · {date}',
  '阅读位置：{offset}': 'Reading location: {offset}',

  '请先创建卡组，再添加或恢复笔记。': 'Create a deck before adding or restoring a note.',
  查找: 'Find',
  '确定删除「{name}」吗？其中的 {count} 张卡片将退出学习队列，笔记与记录仍可在工作目录中恢复。':
    'Delete “{name}”? Its {count} cards will leave study. Notes and history can still be restored from Workspace.',
  '确定移除 {notes} 条笔记及其 {cards} 张关联卡片吗？笔记与学习记录仍可在工作目录中恢复。':
    'Remove {notes} notes and their {cards} cards from study? Notes and history can still be restored from Workspace.',

  查找已移除的笔记: 'Find removed notes',
  '共 {count} 条': '{count} notes',
  '{count} 张卡片': '{count} cards',
  '修改后部分卡片将暂不复习，已有记录会保留。请确认后继续。':
    'Some cards will leave the study queue. Their records will be kept. Confirm to continue.',
  '确认让不再生成的 {p0} 张卡片暂不复习，记录保留，重新添加后恢复。':
    'Retire {p0} cards. Keep their history and restore it when the variants are added again.',
  '题面和答案之间请单独放一行 <!-- repeaty:answer -->。':
    'Separate the question and answer with a line containing <!-- repeaty:answer -->.',
  '文件路径必须位于 notes/ 下，并以 .md 结尾。':
    'The file path must be under notes/ and end with .md.',
  移除这条笔记: 'Remove this note',
  已移除的笔记: 'Removed notes',
  '笔记和学习记录仍保存在目录中，可以恢复后继续学习。':
    'Notes and study history are kept in the folder. Restore them to continue learning.',
  恢复笔记: 'Restore note',
  确认移除笔记: 'Remove note',
  接受文件修改: 'Accept file changes',
  '磁盘文件已不存在。确认后，{count} 张卡片将退出学习队列，笔记和历史记录仍可恢复。':
    'The file is missing. Confirm to remove {count} cards from study. The note and its history can still be restored.',
  '保留 {keep} 张，恢复 {restore} 张，新增 {create} 张，退役 {retire} 张。':
    'Keep {keep}, restore {restore}, create {create}, retire {retire} cards.',
  '退役卡片不再进入复习，历史记录保留；重新添加相同方向或挖空编号时恢复。':
    'Retired cards leave the study queue. Their history returns when the same direction or cloze number is added again.',
  确认接受: 'Accept changes',
  确认恢复: 'Restore',

  '文件中的笔记身份已被移除，请恢复后再接受修改。':
    'The note identity was removed. Restore it before accepting changes.',
  '文件身份与原笔记不同，请检查文件头。':
    'The file identity differs from the original note. Check its frontmatter.',
  '多个文件使用了同一个身份，请保留一份后重新扫描。':
    'Multiple files share the same identity. Keep one and scan again.',
  '文件路径重复，请改名后重新扫描。': 'File paths overlap. Rename the file and scan again.',
  '磁盘上缺少文件，已接受的内容和学习记录仍保留。':
    'The file is missing. Accepted content and study history are still kept.',
  '文件格式或引用无效，请检查后重新扫描。':
    'The file format or a reference is invalid. Check the file and scan again.',
  '文件数：{count}': 'Files: {count}',
  选择文件: 'Select a file',
  工作文件: 'Working file',
  '操作涉及的内容已变化，无法撤销。请刷新后检查学习库。':
    'The affected content has changed. Refresh and check your library before continuing.',
  '撤销所需的媒体已不存在，请从快照恢复。':
    'Media needed for undo is unavailable. Restore it from a snapshot.',
  '没有可撤销的操作。': 'Nothing to undo.',
  '已撤销：{action}': 'Undid: {action}',
  '撤销：{action}': 'Undo: {action}',
  撤销: 'Undo',
  添加: 'Add',
  删除: 'Delete',
  撤销操作前: 'Before undoing an action',
  修改: 'Changes',
  评分: 'Rating',
  阅读安排: 'Reading schedule',
  快捷键: 'Keyboard shortcuts',
  撤销最近操作: 'Undo last action',
  保存当前表单: 'Save current form',
  '添加卡片 / 笔记': 'Add card / note',
  编辑当前卡片: 'Edit current card',
  删除当前笔记: 'Delete current note',
  浏览卡片: 'Browse cards',
  '浏览卡片 / 复习中暂缓': 'Browse cards / bury during review',
  '显示答案 / 评分': 'Show answer / rate',
  暂缓当前卡片: 'Bury current card',
  暂停当前卡片: 'Suspend current card',
  '退出复习 / 关闭弹窗': 'End review / close dialog',
  '输入框保留文字撤销；学习库支持撤销当前会话最近 20 次修改。评分在重启后仍可撤销。':
    'Text fields keep text undo. Library undo covers the last 20 changes in this session; the latest rating can also be undone after restarting.',
  设置分类: 'Settings categories',
  通用: 'General',
  界面: 'Appearance',
  偏好语言: 'Preferred language',
  'AI 制卡': 'AI card authoring',
  弹出通知: 'Pop-up notifications',
  信息通知: 'Information',
  警告通知: 'Warnings',
  错误通知: 'Errors',
  '界面、通知与插件。设置保存在当前浏览器或桌面应用中。':
    'Appearance, notifications and plugins. Settings stay in this browser or desktop app.',
  '关闭弹出后，通知改为在页面内显示。警告和错误仍需手动关闭。':
    'When pop-ups are off, messages appear within the page. Warnings and errors still need to be dismissed.',
  '保存成功和一般提示，5 秒后自动关闭。':
    'Save confirmations and general messages. Dismissed after 5 seconds.',
  '需要留意的情况，手动关闭。': 'Situations that need attention. Dismiss manually.',
  '操作失败和保存错误，手动关闭。': 'Failed actions and save errors. Dismiss manually.',
  '设置已生效，但未能保存；下次打开时可能恢复默认设置。':
    'Settings applied, but could not be saved. Defaults may return next time.',
  '管理此部署已安装的插件。': 'Manage plugins installed in this deployment.',
  '关闭题目插件会暂停相关题目，关闭显示插件会隐藏其界面。内容和进度保留，开关仅影响当前浏览器。':
    'Disabling a question plugin pauses its questions; disabling a display plugin hides its interface. Content and progress stay intact. Switches apply to this browser.',
  答题历史: 'Review history',
  '在当前卡片上方显示最近的评分，虚线圆表示本次作答。':
    'Show recent ratings above the current card. A dashed circle marks this attempt.',
  当前卡片的答题历史: 'Review history for this card',
  本次作答: 'Current attempt',
  显示最近几次评分: 'Number of recent ratings',
  '可显示 1–50 次，仅统计当前卡片已保存的评分。': 'Show 1–50 ratings saved for this card.',
  翻面后才显示历史: 'Show history after revealing the answer',
  更多操作: 'More actions',
  编辑: 'Edit',
  卡组学习状态: 'Deck study status',
  今日可学: 'Available today',
  新卡: 'New',
  '未学 {new} 张 · 稍后到期 {future} 张': '{new} unstudied · {future} due later',
  '另有 {count} 张已达今日额度': '{count} more blocked by today’s limits',
  '暂停 {suspended} 张 · 今日暂缓 {buried} 张': '{suspended} suspended · {buried} buried today',
  '不用 MCP，也可以让 AI 帮忙制卡': 'Make cards with AI, without MCP',
  '复制制卡说明，连同学习材料发给 GPT 网页或其他 AI 聊天工具。':
    'Copy the instructions and share them with your material in GPT on the web or another AI chat.',
  '将生成的 CSV 复制或保存为文件，在卡组中选择「批量导入」。':
    'Copy the CSV or save it as a file, then choose Bulk import in a deck.',
  '检查预览和答案，再确认导入。': 'Check the preview and answers before importing.',
  '只分享本次制卡需要的材料。无需提供账户、Cookie、完整备份或学习进度。':
    'Share only the material needed for these cards. No accounts, cookies, full backups or study progress are required.',
  '正在加载说明…': 'Loading instructions…',
  '未能加载制卡说明，请重新打开此页面。':
    'Could not load the instructions. Please reopen this page.',
  复制制卡说明: 'Copy instructions',
  '下载 SKILL.md': 'Download SKILL.md',
  '制卡说明（可直接粘贴到 AI 聊天中）': 'Instructions (paste into an AI chat)',
  制卡说明已复制: 'Instructions copied',
  '未能复制，请在下方选中说明并手动复制。':
    'Could not copy. Select the instructions below and copy them manually.',
  '制卡说明未能下载，请复制下方内容。':
    'Could not download the instructions. Copy the text below instead.',
  '使用支持 skill 的工具时，将 SKILL.md 放入 repeaty-cards 文件夹，再安装到工具的技能目录。':
    'For tools that support skills, put SKILL.md in a repeaty-cards folder and install it in the tool’s skills directory.',
  间隔方式: 'Interval method',
  固定递增: 'Fixed progression',
  自适应: 'Adaptive',
  '这次理解如何？': 'How well did you understand it?',
  需要再读: 'Need to reread',
  基本理解: 'Understood',
  已经熟悉: 'Familiar',
  '根据这次理解和距上次阅读的天数调整，间隔为 1–365 天。卡片仍由 FSRS 安排。':
    'Adjusts from your feedback and the days since your last reading, from 1 to 365 days. Cards use FSRS.',
  混合学习: 'Mixed study',
  开始混合学习: 'Start mixed study',
  结束混合学习: 'End mixed study',
  本轮混合学习结束: 'Mixed study round complete',
  '已复习 {cards} 次 · 已处理 {sources} 篇':
    'Reviewed {cards} cards · Processed {sources} materials',
  '每 {count} 张卡片穿插 1 篇材料。': 'Read one material after every {count} cards.',
  '本轮材料已处理完，当前没有可复习卡片。':
    'You have finished this round of materials. No cards are due right now.',
  返回学习概览: 'Back to overview',
  '按现有复习额度安排卡片，在其中穿插今天待阅读的材料。':
    'Use your current review limits and include materials ready to read today.',
  '每篇材料之间复习几张卡片？': 'How many cards between materials?',
  '其中一类处理完后继续另一类。结束或刷新页面后，下次重新开始一轮。':
    'Continue with the remaining type when one runs out. Ending or reloading starts a new round next time.',
  开始学习: 'Start study',
  '阅读位置会保存；可安排下次阅读，或直接继续。':
    'Your reading position is saved. Schedule another reading or continue.',
  跳过本篇: 'Skip this material',
  '完成阅读，继续学习': 'Finish reading and continue',
  'MCP 客户端': 'MCP client',
  '通用 HTTP 客户端': 'Generic HTTP client',
  '仅支持本地学习库。每次打开应用后需开启 MCP；切换学习库会关闭连接。':
    'Local library only. Enable MCP each time you open Repeaty. Switching libraries closes the connection.',
  '配置只需添加一次。关闭再开启 MCP 或重启 Repeaty 后，可沿用原配置。':
    'Add the configuration once. It works again when you re-enable MCP or restart Repeaty.',
  '将配置合并到 {file}，保留已有条目。': 'Merge this into {file}, keeping existing entries.',
  '配置不包含访问密钥。客户端仅连接本机运行中的 Repeaty，不会自动启动应用或开启 MCP。':
    'This configuration contains no access key. The client connects to Repeaty running on this computer. It does not launch the app or enable MCP.',
  '无法生成客户端配置，请重试。': 'Cannot generate the client configuration. Try again.',

  '撤销最近一次阅读安排（刷新后清除）': 'Undo the last reading arrangement (cleared on reload)',
  出处路径: 'Source ancestry',
  '摘录出处不能形成循环或引用缺失材料。':
    'Excerpt ancestry cannot contain cycles or missing sources.',
  '摘录层级不能超过 32 层。': 'Excerpts cannot be nested more than 32 levels deep.',
  批量安排: 'Arrange selected sources',
  批量操作: 'Batch action',
  '将更改所选的 {count} 篇材料。': 'This will update the {count} selected sources.',
  '以及另外 {count} 篇。': 'And {count} more.',
  设置优先级: 'Set priority',
  '整批保存后可撤销。卡片和复习进度保持不变。':
    'You can undo this batch after saving. Cards and review progress are unchanged.',
  确认批量安排: 'Apply to selected sources',
  批量选择材料: 'Select sources',
  '已选 {count} 篇材料': '{count} sources selected',
  选择本页: 'Select this page',
  '选择全部筛选结果（{count}）': 'Select all results ({count})',
  取消选择: 'Clear selection',
  '选择材料「{title}」': 'Select source “{title}”',
  选择: 'Select',
  撤销阅读安排: 'Undo reading arrangement',
  阅读安排已撤销: 'Reading arrangement undone',
  去复习卡片: 'Review flashcards',
  今日阅读: 'Today’s reading',
  '待阅读 {count} 篇': '{count} sources to read',
  '{originals} 篇原文 · {excerpts} 篇摘录': '{originals} originals · {excerpts} excerpts',
  开始今日阅读: 'Start today’s reading',
  管理学习材料: 'Manage sources',
  撤销阅读安排前: 'Before undoing reading arrangements',
  '材料或阅读安排已变化，请重新选择。':
    'The materials or reading arrangements have changed. Select them again.',
  编辑材料信息: 'Edit source details',
  保存材料信息: 'Save source details',
  材料信息已保存: 'Source details saved',
  编辑材料信息前: 'Before editing source details',
  '材料信息已变化，请重新打开编辑。': 'Source details have changed. Reopen the editor.',
  '学习库已变化，材料信息未保存。': 'The library has changed. Source details were not saved.',
  开始一轮阅读: 'Start a reading round',
  材料筛选: 'Source filters',
  搜索标题: 'Search titles',
  材料类型: 'Source type',
  全部类型: 'All types',
  原文: 'Original',
  优先级筛选: 'Filter by priority',
  全部优先级: 'All priorities',
  阅读筛选结果: 'Read filtered sources',
  清除筛选: 'Clear filters',
  '本列表 {count} 篇，其中 {ready} 篇待阅读。':
    '{count} sources in this list · {ready} ready to read',
  没有匹配的材料: 'No matching sources',
  本轮阅读: 'Reading round',
  '第 {number} 篇，共 {total} 篇': 'Source {number} of {total}',
  '本轮按开始时的顺序阅读。': 'This round keeps its starting order.',
  下一篇: 'Next source',
  完成本轮: 'Finish round',
  结束本轮: 'End round',
  本轮结束: 'Round finished',
  '已到本轮末尾，阅读位置已保存。':
    'You have reached the end of this round. Reading positions are saved.',
  再读一轮: 'Start another round',
  返回材料: 'Back to sources',
  阅读优先级: 'Reading priority',
  高: 'High',
  普通: 'Normal',
  低: 'Low',
  高优先级: 'High priority',
  普通优先级: 'Normal priority',
  低优先级: 'Low priority',
  '待阅读先按优先级、再按日期排序。': 'To read is sorted by priority, then by date.',
  '阅读安排无效，请重新选择。': 'Invalid reading arrangement. Choose again.',
  '阅读安排已变化，请重新确认下次日期。':
    'The reading schedule has changed. Confirm the next date again.',
  导入材料前: 'Before importing a source',
  删除材料前: 'Before deleting a source',
  摘录制卡前: 'Before creating a card from an excerpt',

  '学习材料和原文快照也包含在完整备份中。':
    'Sources and their snapshots are included in full backups.',
  '还包含 {count} 份学习材料及其原文快照。': 'Also includes {count} sources and their snapshots.',

  关闭: 'Close',
  显示原文与摘录位置: 'Show original text and excerpt position',
  '摘录与原文不一致，请从备份恢复。':
    'The excerpt does not match the source. Restore it from a backup.',
  材料列表分页: 'Source list pages',
  查看原文: 'View source',
  原文快照: 'Source snapshot',
  原文摘录: 'Source excerpt',
  '关联笔记（{count}）': 'Linked notes ({count})',
  '请先新建一个卡组，再用摘录制卡。': 'Create a deck before making cards from excerpts.',
  用摘录制卡: 'Create card from excerpt',
  尚未选取摘录: 'No excerpt selected',
  '已选 {count} 个字符': '{count} characters selected',
  材料正文: 'Source text',
  '阅读 Markdown 预览': 'Read Markdown preview',
  返回原文选取摘录: 'Select from original text',
  '选中原文中的文字，再点击「用摘录制卡」。每次最多 10000 个字符。':
    'Select text, then choose “Create card from excerpt”. Up to 10,000 characters per excerpt.',
  '操作前会保存快照，可在「数据与备份」中恢复。':
    'A snapshot is saved first. Restore it from Data & backups.',
  '将删除「{title}」的原文快照，并解除 {count} 条笔记的来源关联。卡片内容和复习进度保留。':
    'This deletes the snapshot of “{title}” and unlinks {count} notes. Card content and review progress are kept.',
  '删除材料？': 'Delete this source?',
  删除材料: 'Delete source',
  导出原文: 'Export source',
  材料已删除: 'Source deleted',
  材料已保存: 'Source saved',
  保存材料: 'Save source',
  '支持 UTF-8 文本和 Markdown，文件最大 1 MB，正文最多 250000 个字符。':
    'Supports UTF-8 text and Markdown. Up to 1 MB per file and 250,000 characters.',
  粘贴正文: 'Paste text',
  '来源链接（可选）': 'Source URL (optional)',
  材料标题: 'Source title',
  选择材料文件: 'Choose source file',
  '无法读取文件，请使用 UTF-8 编码。': 'Cannot read the file. Use UTF-8 encoding.',
  '请选择 UTF-8 的 .txt、.md 或 .markdown 文件。': 'Choose a UTF-8 .txt, .md or .markdown file.',
  '正在读取原文…': 'Loading source…',
  '保存于 {date}': 'Saved on {date}',
  '没有找到材料。': 'No sources found.',
  搜索材料: 'Search sources',
  '导入文本或 Markdown，也可以直接粘贴。原文会保存在当前学习库中。':
    'Import text or Markdown, or paste it directly. A snapshot is saved in this library.',
  还没有学习材料: 'No sources yet',
  导入材料: 'Import source',
  '保存原文，选取摘录制作卡片。': 'Save a source and turn excerpts into cards.',
  学习材料: 'Sources',
  '摘录与原文不一致，请重新选取。': 'The excerpt no longer matches the source. Select it again.',

  '原文快照缺失或损坏，请从备份恢复。':
    'The source snapshot is missing or damaged. Restore it from a backup.',
  '正文不能为空，且不能超过 250000 个字符。': 'Enter text of up to 250,000 characters.',
  '文本或 Markdown 文件不能超过 1 MB。': 'Text and Markdown files must not exceed 1 MB.',
  '请选取 1–10000 个字符作为摘录。': 'Select 1–10,000 characters for the excerpt.',
  '请完整选中摘录中的字符。': 'Select complete characters in the excerpt.',
  '材料已不存在，请刷新后重试。': 'This source no longer exists. Reload and try again.',

  新笔记: 'New notes',
  内容相同: 'Same content',
  内容不同: 'Different content',
  无法比较: 'Comparison unavailable',
  筛选笔记: 'Filter notes',
  所有笔记: 'All notes',
  选择所有内容不同的笔记: 'Select all different notes',
  保留所有已有笔记: 'Keep all existing notes',
  '没有符合筛选条件的笔记。': 'No notes match this filter.',
  添加此笔记: 'Add this note',
  采用文件内容: 'Use file content',
  '不同之处：{fields}': 'Differences: {fields}',
  '保留 {count} 张卡片及其进度。': 'Keep {count} cards and their progress.',
  '新增卡片：{variants}': 'Cards to add: {variants}',
  '移除卡片：{variants}': 'Cards to remove: {variants}',
  '无法读取已有附件，此笔记不能更新。请检查附件后重新比较。':
    'Existing attachments could not be read. Check them and compare again before updating this note.',
  收起比较: 'Hide comparison',
  查看内容比较: 'Compare content',
  'Anki 文件中的内容': 'Content in the Anki file',
  'Repeaty 中的内容': 'Content in Repeaty',
  笔记比较分页: 'Note comparison pages',
  '支持 Basic、双向和 Cloze。新笔记作为新卡添加；已有笔记可选择更新。不导入 Anki 复习进度。':
    'Supports Basic, reversed, and Cloze notes. Add new notes or choose which existing notes to update. Anki review progress is not imported.',
  '正在比较笔记和附件…': 'Comparing notes and attachments…',
  '已有笔记：{same} 条相同，{changed} 条内容不同，{unavailable} 条无法比较。':
    'Existing notes: {same} identical, {changed} different, {unavailable} unavailable for comparison.',
  '已选择更新 {count} 条笔记。': 'Selected {count} notes to update.',
  '已有笔记默认保留。选择采用文件内容会覆盖当前内容和标签，所属卡组不变；保留的卡片继续使用原进度。':
    'Existing notes are kept by default. Using file content replaces their content and tags, keeps their deck, and preserves progress on surviving cards.',
  确认卡片变化: 'Confirm card changes',
  '更新将新增 {added} 张卡片、移除 {removed} 张卡片。新增卡片从头学习。':
    'This import adds {added} cards and removes {removed} cards. Added cards start as new.',
  '移除的卡片包含 {reviews} 条复习记录、{practices} 次练习和 {attempts} 次提交，将一并移除。':
    'The removed cards have {reviews} reviews, {practices} practices, and {attempts} submissions. These records will also be removed.',
  '导入前会保存快照，可恢复原内容、进度和附件。':
    'A snapshot is saved before import so you can restore the original content, progress, and attachments.',
  我已确认以上卡片变化: 'I have reviewed these card changes',
  '未选择添加或更新任何笔记。': 'No notes selected to add or update.',
  '学习库已变化，请重新比较后再导入。': 'The library has changed. Compare again before importing.',
  '请先确认新增和移除的卡片。': 'Confirm the cards to add and remove before continuing.',
  '最多 5000 条 · 文件最大 256 MB · 单个附件最大 10 MB':
    'Up to 5,000 notes · 256 MB per file · 10 MB per attachment',
  'Anki 文件损坏、格式不受支持或超过导入限制。':
    'The Anki file is damaged, unsupported, or exceeds the import limits.',
  'Anki 文件不能超过 256 MB。': 'Anki files must not exceed 256 MB.',
  '无法启动 Anki 导入器，请重新加载页面后重试。':
    'Could not start the Anki importer. Reload the page and try again.',
  'Anki 文件处理超时，请拆分卡组后重试。':
    'Processing the Anki file timed out. Split the deck and try again.',
  'Anki .apkg': 'Anki .apkg',
  导入格式: 'Import format',
  '选择 Anki 文件': 'Choose Anki file',
  '支持 Basic、双向和 Cloze。导入为新卡，不保留 Anki 的复习进度。':
    'Supports Basic, reversed, and Cloze notes. Imports as new cards without Anki review progress.',
  '内容转为 Markdown，图片和音频作为附件。模板样式不保留。':
    'Content is converted to Markdown, with images and audio as attachments. Template styling is not retained.',
  '正在读取 Anki 文件… {percent}%': 'Reading Anki file… {percent}%',
  '正在读取 Anki 文件…': 'Reading Anki file…',
  '共 {total} 条笔记：可导入 {ready} 条，已存在 {duplicates} 条，跳过 {skipped} 条。':
    '{total} notes: {ready} ready to import, {duplicates} already present, {skipped} skipped.',
  '将添加 {cards} 张新卡和 {media} 个附件。': 'New cards: {cards} · Attachments: {media}',
  '文件含 {count} 条 Anki 复习记录，本次不会导入。':
    'Anki review records: {count}. These will not be imported.',
  '相同 GUID 的笔记会跳过，保留 Repeaty 中已有的内容和进度。':
    'Notes with the same GUID are skipped, keeping the content and progress already in Repeaty.',
  导入报告: 'Import report',
  下载报告: 'Download report',
  查看内容预览: 'Preview content',
  '模板无法转换为问答、双向或挖空卡':
    'Template cannot be converted to a Basic, reversed, or Cloze note',
  字段数量或身份不正确: 'Invalid fields or note identity',
  '内容、标签或挖空格式超出支持范围': 'Unsupported content, tags, or cloze syntax',
  卡片变体不完整或不受支持: 'Incomplete or unsupported card variants',
  '附件缺失、损坏或格式不受支持': 'Missing, damaged, or unsupported attachments',
  已移除脚本或交互内容: 'Scripts or interactive content removed',
  已移除外部图片或音频: 'External images or audio removed',
  已跳过: 'Skipped',
  已调整: 'Adjusted',
  '还有 {count} 项，完整列表见下载报告。':
    '{count} more items are included in the downloaded report.',
  '没有可导入的新笔记。': 'No new notes to import.',
  'Anki 笔记导入完成': 'Anki notes imported',
  导入完成前: 'Before importing',
  桌面版可离线使用本地学习库: 'The desktop app can use its local library offline',
  '桌面版 · 本地学习库': 'Desktop · Local library',
  保存在本机应用中: 'Stored on this device',
  '本地学习库保存在此设备。更换设备或卸载前，请先导出备份。':
    'Your local library stays on this device. Export a backup before switching devices or uninstalling.',

  '请登录；用户名或密码错误时请重新输入。':
    'Please sign in. If your username or password is incorrect, try again.',
  '登录账户已变更，请刷新页面后重试。':
    'The signed-in account has changed. Reload this page before continuing.',
  '用户名已被使用。': 'This username is already taken.',
  '用户名需为 3–32 位字母、数字、下划线或连字符。':
    'Use 3–32 letters, numbers, underscores or hyphens for your username.',
  '密码需为 12–128 字节。': 'Use a password of 12–128 bytes.',
  '此服务已关闭注册，请联系部署者创建账户。':
    'Registration is closed. Ask the server owner to create an account.',
  '操作过于频繁，请稍后重试。': 'Too many attempts. Please try again later.',
  创建账户: 'Create account',
  登录: 'Sign in',
  用户名: 'Username',
  密码: 'Password',
  '已有账户，登录': 'Already have an account? Sign in',
  修改密码: 'Change password',
  退出登录: 'Sign out',
  当前密码: 'Current password',
  新密码: 'New password',
  '修改后需在所有设备重新登录。': 'You will need to sign in again on every device.',
  '本地插件 · 桌面版': 'Local plugin · Desktop',
  '此插件仅在桌面版可用。': 'This plugin is available in the desktop app.',
  'LeetCode 登录已过期或需要验证，请更新本机的登录信息。':
    'Your LeetCode session has expired or needs verification. Update the credentials on this device.',
  '无法连接 LeetCode，请稍后重试。': 'Cannot connect to LeetCode. Please try again later.',
  '无法读取本机插件状态，请重试。': 'Cannot read the local plugin status. Please try again.',
  '本机已保存该站点的登录信息，提交时会验证登录是否仍然有效。':
    'Credentials for this site are saved on this device. Their validity is checked when you submit.',
  '打开力扣网站并登录，不会自动连接 Repeaty。请将登录信息填入下方。':
    'Signing in on LeetCode does not connect Repeaty automatically. Enter your credentials below.',
  '填写 Cookie 的值。保存后立即生效；已保存的值不会回填。':
    'Paste the cookie values. Changes take effect immediately; saved values are never displayed.',
  '登录信息仅保存在本机，由桌面版直接连接力扣，不会发送给上游服务或包含在卡组导出中。':
    'Credentials stay on this device. The desktop app connects directly to LeetCode; credentials are never sent to your upstream server or included in exports.',
  '请输入 HTTPS 服务地址；本机服务可使用 HTTP。地址不应包含路径、账号或参数。':
    'Enter an HTTPS server address. Localhost may use HTTP. Do not include a path, credentials or query parameters.',
  学习库存储: 'Library storage',
  上游后端地址: 'Upstream server address',
  设置: 'Settings',
  '留空使用本地学习库。连接后使用服务端账户的学习库，两者独立保留，不会自动合并。':
    'Leave empty to use the local library. Connecting switches to your server account’s library. Both libraries stay separate and are not merged automatically.',
  'LeetCode 登录信息始终保存在本机，不会发送给上游服务。':
    'LeetCode credentials stay on this device and are never sent to the upstream server.',
  保存并重新打开: 'Save and reload',
  保存: 'Save',
  重新比较: 'Compare again',

  挖空答案: 'Missing text',
  补充说明: 'Extra information',
  '答案来自正面的挖空内容，这里可留空。':
    'The answer comes from the cloze text. You can leave this empty.',
  '将要记住的内容写在 {{c1::答案}} 中，也可写成 {{c1::答案::提示}}。显示答案时会自动还原；同编号一起隐藏，不同编号各生成一张卡片。':
    'Wrap the text to remember in {{c1::answer}} or {{c1::answer::hint}}. Revealing restores it automatically. Matching numbers are hidden together; different numbers create separate cards.',

  '可读取公开题目。提交判题前，请填写下方的登录信息。':
    'Public problems can be loaded. Add your credentials below to submit code.',
  更新登录信息: 'Update credentials',
  配置登录信息: 'Configure credentials',
  '填写 Cookie 的值。保存后立即生效，无需重启服务；已保存的值不会回填。':
    'Paste the cookie values. Changes take effect immediately without restarting the service. Saved values are never shown.',
  '粘贴 Cookie 值': 'Paste cookie value',
  保存登录信息: 'Save credentials',
  清除登录信息: 'Clear credentials',
  确认清除: 'Confirm clear',
  '清除后需重新填写登录信息才能提交判题。':
    'After clearing, add credentials again before submitting code.',
  '登录信息保存在此服务器，仅用于所选站点的判题，不包含在卡组导出中。':
    'Credentials stay on this server for the selected site and are excluded from deck exports.',
  '在哪里找到这两个值？': 'Where do I find these values?',
  '在对应的力扣站点登录，打开浏览器开发者工具 → 应用（Application）或存储（Storage）→ Cookie，复制 LEETCODE_SESSION 和 csrftoken 的值，粘贴到上方。登录过期后重新填写。':
    'Sign in to this LeetCode site, then open your browser’s developer tools → Application or Storage → Cookies. Copy the LEETCODE_SESSION and csrftoken values into the fields above. Replace them when your session expires.',
  '请填写两个 Cookie 的值，不要包含名称、空格或分号。':
    'Enter both cookie values without names, spaces, or semicolons.',
  '登录信息已保存，后续提交立即使用新配置。':
    'Credentials saved. New submissions will use this configuration.',
  '登录信息已清除。': 'Credentials cleared.',
  '登录信息已保存在本机。': 'Credentials saved on this device.',
  'LeetCode 登录': 'LeetCode session',
  '正在验证登录…': 'Verifying session…',
  登录有效: 'Signed in',
  登录已失效: 'Session expired',
  需要网页验证: 'Website verification required',
  网络连接异常: 'Network unavailable',
  验证暂时受限: 'Verification rate limited',
  尚未确认登录状态: 'Session not verified',
  '当前账号：{username}': 'Account: {username}',
  '验证时间：{time}': 'Checked: {time}',
  '力扣要求额外验证，请在网站完成验证后重试。':
    'LeetCode requires additional verification. Complete it on the website and try again.',
  '登录信息已更新，请刷新状态后重试。':
    'The credentials changed. Refresh the status and try again.',
  '无法连接力扣，已保存的登录信息仍然保留。请检查网络后重试。':
    'Could not reach LeetCode. Your saved credentials are kept. Check your network and try again.',
  '力扣暂时限制验证请求，请稍后刷新状态。':
    'LeetCode is limiting verification requests. Refresh the status later.',
  '无法识别力扣返回的验证结果，请稍后重试。':
    'LeetCode returned an unreadable verification result. Try again later.',
  '登录信息无效或已过期，请重新登录力扣并更新下方 Cookie。':
    'Your credentials are invalid or expired. Sign in to LeetCode again and update the cookies below.',
  '正在向力扣验证登录。你可以继续编辑代码或更新登录信息。':
    'Checking your session with LeetCode. You can keep editing code or update your credentials.',
  '操作未确认成功，请刷新状态后重试。':
    'The operation could not be confirmed. Refresh the status before trying again.',

  '正在保存…': 'Saving…',
  判题配置: 'Judge setup',
  状态读取失败: 'Could not read status',
  已配置登录信息: 'Credentials configured',
  未配置登录信息: 'Credentials not configured',
  刷新状态: 'Refresh status',
  '服务已保存该站点的登录信息，提交时会验证登录是否仍然有效。':
    'The service has credentials for this site. Their validity is checked when you submit.',
  '可读取公开题目。提交判题前，需要在 Repeaty 服务中配置该站点的登录信息。':
    'Public problems can be loaded. To submit code, configure credentials for this site in the Repeaty service.',
  '打开力扣网站并登录，不会自动连接 Repeaty。判题使用服务端配置的账号。':
    'Signing in on the LeetCode website does not connect Repeaty. Submissions use the account configured on the server.',
  打开力扣网站: 'Open LeetCode website',
  如何配置判题账号: 'How to configure the judge account',
  '在对应的力扣站点登录，在浏览器开发者工具的 Cookie 中找到 LEETCODE_SESSION 和 csrftoken。':
    'Sign in to this LeetCode site. In your browser’s developer tools, find the LEETCODE_SESSION and csrftoken cookies.',
  '在 Repeaty 服务的环境变量中设置：': 'Set these environment variables for the Repeaty service:',
  '重启 Repeaty 服务，然后点击「刷新状态」。登录过期后需要更新这两个值。':
    'Restart the Repeaty service, then select “Refresh status”. Update both values when the session expires.',
  '登录信息只放在服务的私密配置中，不要提交到 Git 或发到聊天中。':
    'Keep credentials in private server configuration. Do not commit them to Git or send them in chat.',
  完整配置文档: 'Full setup guide',

  '创建自己的卡组，或添加入门卡组。': 'Create your own deck or add the starter deck.',
  添加入门卡组: 'Add starter deck',
  入门卡组已添加: 'Starter deck added',
  'FSRS 与 Repeaty 入门': 'Getting started with FSRS & Repeaty',
  '通过 24 条笔记学习评分、复习和制卡。按当前界面语言添加一份，已有卡片和进度会保留。':
    'Learn ratings, reviews and making cards with 24 notes. Add a copy in the current interface language. Existing cards and progress are kept.',

  'Repeaty 首页': 'Repeaty home',
  间隔复习: 'Spaced repetition',
  主导航: 'Main navigation',
  学习概览: 'Overview',
  全部卡片: 'All cards',
  数据与备份: 'Data & backups',
  我的卡组: 'My decks',
  新建卡组: 'New deck',
  暂无卡组: 'No decks yet',
  本地存储: 'Local storage',
  仅限当前浏览器: 'This browser only',
  关闭提示: 'Dismiss notification',
  本地存储暂不可用: 'Local storage unavailable',
  '正在加载…': 'Loading…',
  卡片与间隔复习: 'Flashcards & spaced repetition',
  添加卡片: 'Add card',
  今日学习: 'Study today',
  '{p0} 张到期卡片 · {p1} 张新卡片': 'Due: {p0} · New: {p1}',
  '还有 {p0} 张卡片因每日上限未加入学习队列。': 'Cards excluded by daily limits: {p0}.',
  '可在卡组设置中调整上限。': 'You can adjust the limits in deck settings.',
  开始复习: 'Start review',
  查看复习安排: 'View review schedule',
  '最近 7 天': 'Last 7 days',
  复习次数: 'Reviews',
  次复习: 'reviews',
  最近七天复习次数: 'Reviews over the last seven days',
  '{p0}：{p1} 次': '{p0}: reviews {p1}',
  '{p0} 次': 'Reviews: {p0}',
  今天: 'Today',
  卡片总数: 'Total cards',
  今日可复习: 'Due today',
  今日可学新卡: 'New today',
  今日复习次数: 'Reviewed today',
  创建卡组: 'Create deck',
  '打开卡组 {p0}': 'Open deck {p0}',
  '编辑卡组 {p0}': 'Edit deck {p0}',
  '{p0} 张卡片': 'Cards: {p0}',
  '{p0} 张待学': '{p0} to study',
  '复习卡组 {p0}': 'Review deck {p0}',
  还没有卡组: 'No decks yet',
  '创建卡组后添加卡片，或加载 5 张示例卡片。':
    'Create a deck and add cards, or load 5 sample cards.',
  加载示例: 'Load sample cards',
  '复习快捷键：空格显示答案，1–4 评分，Esc 退出。':
    'Review shortcuts: Space to show the answer, 1–4 to rate, Esc to exit.',
  '搜索、编辑卡片，或批量调整卡组和标签。':
    'Search and edit cards, or change decks and tags in bulk.',
  编辑当前卡组: 'Edit current deck',
  删除当前卡组: 'Delete current deck',
  批量导入: 'Bulk import',
  '导出、恢复备份，管理本地数据。':
    'Export backups, restore your collection, and manage local data.',
  保存在当前浏览器: 'Saved in this browser',
  '数据仅保存在当前浏览器，不会自动同步。清除网站数据会删除卡片和复习记录。更换浏览器或网址前，请先导出备份。':
    'Data is stored in this browser and does not sync automatically. Clearing site data deletes your cards and review history. Export a backup before switching browsers or site addresses.',
  导出备份: 'Export backup',
  '{p0} 个卡组 · {p1} 张卡片 · {p2} 次复习': 'Decks: {p0} · Cards: {p1} · Reviews: {p2}',
  '导出 JSON': 'Export JSON',
  恢复备份: 'Restore backup',
  导入备份文件: 'Import backup file',
  选择备份文件: 'Choose backup file',
  自动快照: 'Automatic snapshots',
  立即创建快照: 'Create snapshot now',
  '有数据变化时，在打开应用及使用期间每 30 分钟保存快照；编辑、删除、批量操作和恢复前也会保存。保留最近 10 份及其图片和音频。清除网站数据也会删除快照。':
    'When data changes, snapshots are saved on startup and every 30 minutes, plus before edits, deletions, bulk changes, and restores. The latest 10 snapshots and their media are kept. Clearing site data also deletes snapshots.',
  '{p0} · {p1} 条笔记 · {p2} 张卡片': '{p0} · Notes: {p1} · Cards: {p2}',
  恢复此快照: 'Restore snapshot',
  '暂无快照。添加卡片后可手动创建，也会自动保存。':
    'No snapshots yet. Add cards to create one manually or wait for an automatic snapshot.',
  '首次联网加载完成后，可离线打开、制卡和复习。已保存的图片和音频也可离线使用。':
    'Once the app has loaded online, you can reopen it, add cards, and review offline. Saved images and audio are also available offline.',
  刷新以更新版本: 'Reload to update',
  '使用 FSRS 安排复习，数据保存在当前浏览器。':
    'Reviews are scheduled with FSRS. Data is stored in this browser.',
  编辑卡组: 'Edit deck',
  卡组名称: 'Deck name',
  '例如：英语词汇、计算机基础…': 'e.g. Vocabulary, Computer science…',
  描述: 'Description',
  可选: 'Optional',
  卡组内容或用途: 'What this deck covers',
  每日新卡上限: 'Daily new card limit',
  每日复习上限: 'Daily review limit',
  '每日上限按本机日期重置。设为 0 则不安排该类卡片；学习和重学步骤不受此限制。':
    'Limits reset each day using your local date. Set a limit to 0 to exclude that card type. Learning and relearning steps are not limited.',
  评分后自动暂缓同笔记的其他卡片至明天:
    'After rating, bury sibling cards from the same note until tomorrow',
  顽固卡遗忘阈值: 'Leech lapse threshold',
  '目标记忆保留率（%）': 'Desired retention (%)',
  '复习时遗忘达到指定次数，会标记为顽固卡；设为 0 关闭。目标保留率默认 90%，越高则复习越频繁。修改仅影响后续评分。':
    'Cards are marked as leeches after this many review lapses; 0 disables marking. Desired retention defaults to 90%. Higher values mean more frequent reviews. Changes apply to future ratings.',
  卡组颜色: 'Deck color',
  鼠尾草绿: 'Sage',
  暖沙色: 'Sand',
  薰衣草紫: 'Lavender',
  雾蓝色: 'Blue',
  蔷薇粉: 'Rose',
  取消: 'Cancel',
  '保存中…': 'Saving…',
  保存卡组: 'Save deck',
  编辑卡片: 'Edit card',
  批量导入笔记: 'Import notes',
  '恢复此快照？': 'Restore this snapshot?',
  '包含 {p0} 条笔记、{p1} 张卡片。恢复会替换当前数据。操作前会保存当前数据的快照。':
    'Notes: {p0} · Cards: {p1}. Restoring replaces current data. A snapshot of your current data will be saved first.',
  确认恢复快照: 'Confirm restore',
  确认删除: 'Confirm delete',
  '恢复此备份？': 'Restore this backup?',
  '备份包含 {p0} 个卡组、{p1} 张卡片和 {p2} 条复习记录。':
    'Backup contents — Decks: {p0} · Cards: {p1} · Reviews: {p2}.',
  '恢复会替换当前所有卡组、卡片和复习进度。建议先导出当前数据作为备份。':
    'Restoring replaces all current decks, cards, and progress. Export a backup of your current data first.',
  替换并恢复: 'Replace and restore',
  关闭弹窗: 'Close dialog',
  搜索卡片: 'Search cards',
  '关键词、tag:英语、is:due、lapses:>=3…': 'Keywords, tag:English, is:due, lapses:>=3…',
  筛选卡组: 'Filter by deck',
  全部卡组: 'All decks',
  筛选状态: 'Filter by status',
  全部状态: 'All statuses',
  复习: 'Review',
  '高级搜索、常用筛选与专项练习': 'Advanced search, saved filters & focused practice',
  '空格连接的条件需同时满足；双引号包围短语，减号排除条件。例如':
    'All space-separated conditions must match. Use quotes for phrases and a minus to exclude. Example:',
  'tag:英语 -is:suspended lapses:>=3': 'tag:English -is:suspended lapses:>=3',
  '还支持 deck:"卡组名称"、type:cloze、is:leech、due:<=7（距今天的日历天数，负数表示逾期）。is:due 包含所有已到期卡片，不考虑额度。':
    'Also supports deck:"Deck name", type:cloze, is:leech, and due:<=7 (calendar days from today; negative means overdue). is:due includes all due cards regardless of daily limits.',
  常用筛选: 'Saved filters',
  选择已保存筛选: 'Choose a saved filter',
  筛选名称: 'Filter name',
  '例如：英语易忘卡': 'e.g. Tricky vocabulary',
  另存筛选: 'Save as new filter',
  更新筛选: 'Update filter',
  删除筛选: 'Delete filter',
  练习模式: 'Practice mode',
  '只练习，不改进度': 'Practice without changing progress',
  评分并更新进度: 'Rate and update progress',
  卡片数量上限: 'Card limit',
  开始专项练习: 'Start focused practice',
  '包含未到期卡片，不受每日上限限制。评分会更新下次复习时间，并计入今日学习。':
    'Includes cards not yet due and ignores daily limits. Ratings update the next review date and count toward today’s study.',
  '评分仅用于本轮练习，不改变到期时间、每日用量或统计。':
    'Ratings apply only to this session. Due dates, daily counts, and statistics stay unchanged.',
  '可练习 {p0} 张，已排除暂停和今日暂缓的卡片。每张卡片练习一次。{p1}':
    'Available cards: {p0}. Suspended and buried cards are excluded. Each card is shown once. {p1}',
  '{p0} 张卡片 · {p1} 条笔记': 'Cards: {p0} · Notes: {p1}',
  '已选 {p0} 张卡片（{p1} 条笔记）': 'Selected cards: {p0} · Notes: {p1}',
  删除所选笔记: 'Delete selected notes',
  批量修改笔记的卡组与标签: 'Bulk edit decks and tags',
  '同一笔记的所有关联卡片都会更新，复习进度保留。暂停和暂缓仅影响勾选的卡片。':
    'Updates all cards from each selected note while keeping progress. Suspend and bury affect only selected cards.',
  移动到卡组: 'Move to deck',
  保持原卡组: 'Keep current decks',
  添加标签: 'Add tags',
  逗号分隔: 'Comma-separated',
  移除标签: 'Remove tags',
  应用笔记修改: 'Apply note changes',
  选择本页卡片: 'Select cards on this page',
  '问题 / 答案': 'Question / Answer',
  卡组: 'Deck',
  状态: 'Status',
  操作: 'Actions',
  '选择卡片 {p0}': 'Select card {p0}',
  '{p0} 个媒体': 'Media: {p0}',
  顽固卡: 'Leech',
  '正式遗忘 {p0} 次': 'Review lapses: {p0}',
  '编辑卡片 {p0}': 'Edit card {p0}',
  '删除卡片 {p0}': 'Delete card {p0}',
  恢复: 'Resume',
  暂停: 'Suspend',
  没有匹配的卡片: 'No matching cards',
  暂无卡片: 'No cards yet',
  '更换关键词或调整筛选条件。': 'Change the search terms or filters.',
  '点击「添加卡片」，或从 CSV / TSV 文件导入。': 'Add a card or import a CSV / TSV file.',
  上一页: 'Previous',
  下一页: 'Next',
  '支持 UTF-8 CSV / TSV，最多 5000 条。type 为 basic、reversed 或 cloze；tags 用 | 分隔。支持带引号的逗号与多行字段。':
    'Supports UTF-8 CSV / TSV, up to 5,000 notes. Use basic, reversed, or cloze for type; separate tags with |. Quoted commas and multiline fields are supported.',
  '下载 CSV 示例': 'Download CSV example',
  导入到卡组: 'Import into deck',
  '选择 CSV / TSV 文件': 'Choose CSV / TSV file',
  分隔符: 'Delimiter',
  '逗号 CSV': 'Comma (CSV)',
  '制表符 TSV': 'Tab (TSV)',
  或粘贴表格文本: 'Or paste table text',
  '共 {p0} 条笔记，将生成 {p1} 张卡片；其中 {p2} 条重复。':
    'Notes: {p0} · Cards to generate: {p1} · Duplicate notes: {p2}.',
  '跳过同卡组中类型、格式、正面和背面均相同的笔记':
    'Skip notes with the same type, format, front, and back in the same deck',
  检查并预览: 'Check and preview',
  确认导入: 'Confirm import',
  '已保存 {p0} 条笔记。': 'Notes saved: {p0}.',
  笔记类型: 'Note type',
  内容格式: 'Content format',
  'Markdown / 数学公式': 'Markdown / Math',
  纯文本: 'Plain text',
  '支持 **加粗**、列表、代码和 $行内公式$ / $$独立公式$$。图片可直接粘贴到问题或答案输入框。':
    'Supports **bold**, lists, code, and $inline math$ / $$display math$$. Paste images directly into the question or answer field.',
  所属卡组: 'Deck',
  '正面 · 问题': 'Front · Question',
  '法国的首都是 {{c1::巴黎::城市}}。': 'The capital of France is {{c1::Paris::city}}.',
  输入问题: 'Enter the question',
  '选中文字挖空 · Ctrl / ⌘ + Shift + C': 'Cloze selection · Ctrl / ⌘ + Shift + C',
  '使用 {{ c1::答案 }} 或 {{ c1::答案::提示 }}。同编号一起隐藏，不同编号各生成一张卡片；暂不支持嵌套挖空。':
    'Use {{c1::answer}} or {{c1::answer::hint}}. Matching numbers hide together; different numbers generate separate cards. Nested clozes are not supported.',
  '正面图片 / 音频': 'Front images / audio',
  '移除 {p0}': 'Remove {p0}',
  '背面 · 答案': 'Back · Answer',
  '可选，补充解释': 'Optional extra explanation',
  输入答案或补充说明: 'Enter the answer or additional notes',
  '背面图片 / 音频': 'Back images / audio',
  标签: 'Tags',
  '可选，用逗号分隔': 'Optional, comma-separated',
  '英语, 常用词': 'English, common words',
  '将生成 {p0} 张卡片 · 预览': 'Cards to generate: {p0} · Preview',
  '同一笔记生成的卡片共用内容，分别记录复习进度。编辑后保留的卡片会继续沿用原进度。每个附件最大 10 MB。':
    'Cards from one note share content but have separate review progress. Cards kept after editing retain their progress. Each attachment can be up to 10 MB.',
  '确认移除不再生成的 {p0} 张卡片及其复习记录（会先保存快照）。':
    'Confirm removal of obsolete cards ({p0}) and their review history. A snapshot will be saved first.',
  保存并继续: 'Save and add another',
  保存卡片: 'Save card',
  结束专项练习: 'End practice',
  结束复习: 'End review',
  '已复习 {p0} 次 · 当前待学 {p1} 张': 'Reviewed: {p0} · Remaining: {p1}',
  '只练习：不保存评分，也不改变复习进度。':
    'Practice only: ratings are not saved and review progress stays unchanged.',
  '更新进度：评分会更新复习时间并计入今日学习，不受每日上限限制。':
    'Update progress: ratings update review dates and count toward today’s study. Daily limits do not apply.',
  '{p0} 每张卡片本轮练习一次，已暂停或今日暂缓的卡片会跳过。':
    '{p0} Each card is practiced once. Suspended and buried cards are skipped.',
  撤销上次评分: 'Undo last rating',
  今天暂缓: 'Bury for today',
  暂停此卡: 'Suspend card',
  新卡片: 'New',
  复习卡片: 'Review card',
  '顽固卡 · 多次遗忘': 'Leech · Repeated lapses',
  问题: 'Question',
  答案: 'Answer',
  显示答案: 'Show answer',
  或按空格键: 'or press Space',
  根据回答情况评分: 'Rate your answer',
  不改进度: 'Progress unchanged',
  本轮练习结束: 'Practice session finished',
  已达到今日上限: 'Daily limit reached',
  本轮复习结束: 'Review session finished',
  暂无待复习卡片: 'No cards due',
  '还有 {p0} 张卡片因每日上限未加入队列。可明天继续，或调整卡组设置。':
    'Cards excluded by daily limits: {p0}. Continue tomorrow or change the deck settings.',
  '学习进度保持不变。': 'Your progress is unchanged.',
  '已更新复习时间。': 'Review dates have been updated.',
  '已练习 {p0} 张，其中 {p1} 张选择了重来。{p2}': 'Cards practiced: {p0} · Rated Again: {p1}. {p2}',
  '下一张卡片将在约 {p0} 后到期。': 'The next card is due in about {p0}.',
  '本轮完成 {p0} 次复习。{p1}': 'Reviews completed this session: {p0}. {p1}',
  返回: 'Back',
  检查到期卡片: 'Check for due cards',
  '请先选中正面中需要挖空的文字。': 'Select text on the front to turn into a cloze.',
  '暂不支持嵌套挖空，请选择尚未挖空的文字。':
    'Nested clozes are not supported. Select text outside an existing cloze.',
  '最多支持 99 个挖空编号。': 'Up to 99 cloze numbers are supported.',
  '内容超过 10000 字。': 'Content exceeds 10,000 characters.',
  'JSON 备份超过 100 MB，请改用 .repeaty 格式导出。':
    'The JSON backup exceeds 100 MB. Export in .repeaty format instead.',
  '无法导出：附件「{p0}」缺失或损坏。': 'Cannot export: attachment “{p0}” is missing or damaged.',
  'JSON 备份超过 100 MB。': 'The JSON backup exceeds 100 MB.',
  '备份文件不能超过 100 MB。': 'Backup files must not exceed 100 MB.',
  '文件不是有效的 JSON。': 'The file is not valid JSON.',
  媒体数量不匹配: 'Media count mismatch',
  媒体缺失: 'Missing media',
  媒体大小不匹配: 'Media size mismatch',
  完整备份缺少媒体: 'Media missing from full backup',
  '备份格式不正确、媒体不完整或版本不兼容，请使用 Repeaty 导出的 JSON 文件。':
    'Invalid backup format, incomplete media, or incompatible version. Use a JSON file exported by Repeaty.',
  '引号格式不正确：请用双引号包围整个字段。':
    'Invalid quoting: wrap the entire field in double quotes.',
  '结束引号后只能接分隔符或换行。': 'Only a delimiter or newline may follow a closing quote.',
  '每次最多导入 5000 条笔记。': 'Import up to 5,000 notes at a time.',
  '文件存在未闭合的引号。': 'The file contains an unclosed quote.',
  '导入文本不能超过 2 MB。': 'Import text must not exceed 2 MB.',
  '表头须包含 front、back，可选 type、tags、format；请使用示例格式。':
    'Headers must include front and back; type, tags, and format are optional. Follow the example format.',
  '文件须包含 1–5000 条笔记。': 'The file must contain 1–5,000 notes.',
  '第 {p0} 行的列数与表头不一致。': 'Row {p0} has a different number of columns than the header.',
  内容格式不正确: 'Invalid content format',
  '第 {p0} 行：{p1}': 'Row {p0}: {p1}',
  '目标卡组不存在。': 'The target deck does not exist.',
  已学习卡片缺少有效的复习状态: 'A studied card has no valid review state',
  下次复习时间不能早于上次复习: 'The next review cannot precede the last review',
  '存在重复 ID': 'Duplicate IDs found',
  卡片所属卡组不存在: "The card's deck does not exist",
  复习记录对应的卡片不存在: 'A review refers to a missing card',
  '图片或音频文件不能为空，且不能超过 10 MB。':
    'Image and audio files must not be empty or larger than 10 MB.',
  '支持 PNG、JPEG、WebP、GIF 图片及 MP3、WAV、OGG、M4A、WebM、FLAC、AAC 音频。':
    'Supported images: PNG, JPEG, WebP, GIF. Audio: MP3, WAV, OGG, M4A, WebM, FLAC, AAC.',
  待复习: 'Due',
  学习中: 'Learning',
  复习中: 'Reviewing',
  已暂停: 'Suspended',
  今日暂缓: 'Buried today',
  正反面: 'Basic',
  双向卡: 'Basic and reversed',
  挖空卡: 'Cloze',
  '挖空格式应为 {{c1::答案}} 或 {{c1::答案::提示}}，编号为 1–99，不支持嵌套挖空。':
    'Use {{c1::answer}} or {{c1::answer::hint}}, with numbers 1–99. Nested clozes are not supported.',
  '挖空答案不能为空。': 'A cloze answer cannot be empty.',
  答案不能为空: 'The answer cannot be empty',
  卡片所属笔记不存在: "The card's note does not exist",
  笔记所属卡组不存在: "The note's deck does not exist",
  笔记引用的媒体不存在: 'A note refers to missing media',
  卡片与笔记生成规则不匹配: "Cards do not match their note's generation rules",
  挖空格式不正确: 'Invalid cloze format',
  '笔记已不存在，请刷新页面。': 'This note no longer exists. Refresh the page.',
  '修改后部分卡片将不再生成，请确认移除这些卡片及其复习记录。':
    'Some cards will no longer be generated. Confirm removal of those cards and their review history.',
  学习如何学习: 'Learning how to learn',
  '5 张示例卡片，介绍制卡、评分和间隔复习。':
    '5 sample cards about creating cards, rating answers, and spaced repetition.',
  '什么是主动回忆？': 'What is active recall?',
  '暂时不看答案，尝试从记忆中提取信息。比如，先回答卡片上的问题，再翻面核对。':
    "Try to retrieve information from memory without looking at the answer. For example, answer a card's question before revealing the back.",
  '为什么把复习分散到不同的时间？': 'Why space reviews over time?',
  '在逐渐拉长的间隔中回想同一条知识，可以帮助巩固长期记忆。这就是间隔复习。':
    'Recalling the same idea at gradually longer intervals can strengthen long-term memory. This is spaced repetition.',
  '一张好的记忆卡片应该包含多少知识？': 'How much should a good flashcard test?',
  '尽量只考一个明确的知识点。问题清楚、答案简短，才能准确判断自己是否记住了。':
    'Aim for one clear idea. A precise question and a short answer make it easier to judge whether you remembered it.',
  '忘记一张卡片时，该如何评分？': 'How should you rate a forgotten card?',
  '怎样让每天的复习更容易坚持？': 'How can you make daily reviews easier to maintain?',
  '从少量卡片开始，把复习放在一个固定的日常时刻。先处理到期卡片，再逐渐加入新内容。':
    'Start with a few cards and review at a regular time each day. Review due cards first, then gradually add new material.',
  入门: 'Getting started',
  '卡片已不存在。': 'This card no longer exists.',
  '这张卡片尚未到期、已暂停或已达到今日额度。':
    "This card is not due, is suspended, or has reached today's limit.",
  '当前时间早于上次复习，请检查本机时间。':
    'The current time is earlier than the last review. Check your device clock.',
  '没有可撤销的评分。旧版导入的记录不支持撤销。':
    'No rating can be undone. Imported legacy reviews do not support undo.',
  '卡片进度已变化，无法撤销这次评分。':
    "The card's progress has changed. This rating cannot be undone.",
  '搜索条件最多 1000 字。': 'Search queries may contain up to 1,000 characters.',
  '搜索中的双引号未闭合。': 'A double quote in the search query is not closed.',
  '{p0} 应为数字条件，例如 {p1}:>=3。': '{p0} requires a numeric condition, such as {p1}:>=3.',
  '{p0} 数值超出范围。': '{p0} is out of range.',
  '减号后需要搜索条件。': 'Add a search condition after the minus sign.',
  '{p0} 后需要填写条件。': 'Add a condition after {p0}.',
  'type 支持 basic、reversed、cloze。': 'type supports basic, reversed, and cloze.',
  'is 支持 new、due、review、learning、suspended、buried、leech。':
    'is supports new, due, review, learning, suspended, buried, and leech.',
  '筛选状态不正确。': 'Invalid filter status.',
  '筛选卡组已不存在。': 'The filtered deck no longer exists.',
  '最多保存 100 个常用筛选。': 'Save up to 100 filters.',
  升级前快照: 'Before upgrade',
  自动备份: 'Automatic backup',
  '数据已在另一个标签页更新，请刷新页面后重试。':
    'Data was updated in another tab. Refresh the page and try again.',
  '媒体内容与文件信息不一致。': 'Media contents do not match the file metadata.',
  '媒体 ID 冲突，未覆盖已有文件。': 'Media ID conflict. Existing files were not overwritten.',
  '媒体「{p0}」缺失，未保存修改。': 'Media “{p0}” is missing. Changes were not saved.',
  手动快照: 'Manual snapshot',
  '该快照已被清理，请重新打开备份列表。': 'This snapshot was removed. Reopen the backup list.',
  '数据库升级正在等待旧版本标签页关闭。请关闭其他 Repeaty 页面，完成后会自动继续。':
    'The database upgrade is waiting for older tabs to close. Close other Repeaty pages; the upgrade will continue automatically.',
  '无法读取本地数据库。请确认浏览器允许本站使用存储，再刷新页面。已有数据不会被自动覆盖。':
    'Cannot read the local database. Allow storage for this site and refresh. Existing data will not be overwritten automatically.',
  '正在保存，请稍候。': 'Saving. Please wait.',
  '本地数据库尚未准备好。': 'The local database is not ready yet.',
  '请检查必填字段。': 'Check the required fields.',
  '内容格式不正确：{p0}': 'Invalid content: {p0}',
  '浏览器存储空间不足，未保存本次修改。请先导出备份。':
    'Browser storage is full. Changes were not saved. Export a backup first.',
  '本地数据库版本已更新，请刷新当前页面后重试。':
    'The local database version changed. Refresh the page and try again.',
  '卡组已不存在。': 'This deck no longer exists.',
  删除卡组前: 'Before deleting a deck',
  编辑笔记前: 'Before editing a note',
  删除笔记前: 'Before deleting notes',
  批量编辑前: 'Before bulk editing',
  导入笔记前: 'Before importing notes',
  恢复备份前: 'Before restoring a backup',
  恢复快照前: 'Before restoring a snapshot',
  '操作失败，请重试。': 'The operation failed. Please try again.',
  卡组已保存: 'Deck saved',
  笔记与卡片已保存: 'Note and cards saved',
  常用筛选已保存: 'Filter saved',
  常用筛选已删除: 'Filter deleted',
  笔记导入完成: 'Notes imported',
  笔记已批量更新: 'Notes updated',
  已撤销上次评分: 'Last rating undone',
  删除卡组: 'Delete deck',
  删除笔记: 'Delete notes',
  已删除: 'Deleted',
  包含媒体的完整备份已生成: 'Full backup with media created',
  快照已恢复: 'Snapshot restored',
  备份已恢复: 'Backup restored',
  '每一面最多添加 8 个媒体文件。': 'Add up to 8 media files per side.',
  '最多 20 个标签，每个不超过 40 字。': 'Use up to 20 tags, each no longer than 40 characters.',
  '请检查挖空格式，例如 {{c1::巴黎::城市}}。':
    'Check the cloze format, for example {{c1::Paris::city}}.',
  'CSV / TSV 文件不能超过 2 MB。': 'CSV / TSV files must not exceed 2 MB.',
  'type,front,back,tags\nbasic,hello,你好,英语|问候':
    'type,front,back,tags\nbasic,bonjour,hello,French|greetings',
  界面语言: 'Interface language',
  '字段「{field}」格式不正确，请检查必填内容和取值范围。':
    'Invalid field “{field}”. Check required values and allowed ranges.',
  内容: 'Content',
  '使用 Repeaty 创建卡片，通过间隔复习学习。支持图片、音频和离线使用。':
    'Create flashcards and study with spaced repetition. Supports images, audio, and offline use.',
  '确定删除「{name}」吗？其中的 {count} 张卡片及对应复习记录也会被删除。会先自动保存快照。':
    'Delete “{name}”? Its cards ({count}) and review history will also be deleted. A snapshot will be saved first.',
  '确定删除 {notes} 条笔记及其 {cards} 张关联卡片和复习记录吗？会先自动保存快照。':
    'Delete the selected notes ({notes}), their cards ({cards}), and review history? A snapshot will be saved first.',
  '同笔记的 {count} 张关联卡片已自动暂缓至明天。': 'Sibling cards buried until tomorrow: {count}.',
  '这张卡已标记为顽固卡，可在卡片列表中筛选并改写问题。':
    'This card is now a leech. Find it in the card list and try rewriting the question.',
  暂停所选: 'Suspend selected',
  恢复所选: 'Resume selected',
  取消暂缓: 'Unbury',
  清除顽固标记: 'Clear leech flag',
  '部分媒体无法读取，请从完整备份恢复。':
    'Some media could not be loaded. Restore from a complete backup.',
  重来: 'Again',
  未能答对: 'Incorrect',
  困难: 'Hard',
  '答对，但有困难': 'Correct with difficulty',
  良好: 'Good',
  正确回答: 'Correct',
  简单: 'Easy',
  轻松答对: 'Correct without effort',
  '正在准备离线资源…': 'Preparing offline resources…',
  '开发模式：未启用离线启动': 'Development mode: offline startup disabled',
  '当前环境不支持离线启动，请使用 HTTPS 或 localhost':
    'Offline startup unavailable. Use HTTPS or localhost.',
  '离线资源准备失败，请联网刷新重试': 'Offline setup failed. Connect to the internet and reload.',
  离线已就绪: 'Ready offline',
  示例卡组已添加: 'Sample deck added',
  '快照已保存；未变化的数据不会重复备份': 'Snapshot saved; unchanged data is not backed up again',
  '[图片：{name} · 请使用附件]': '[Image: {name} · Use an attachment]',
  '备份包损坏、内容不完整或版本不兼容。':
    'The backup archive is damaged, incomplete, or incompatible.',
  '备份包不能超过 2 GB。': 'The backup archive and its expanded contents must not exceed 2 GB.',
  '导出 .repeaty': 'Export .repeaty',
  '导出旧版 JSON': 'Export legacy JSON',
  '导出全部学习数据，包含卡组、卡片、复习记录、图片和音频。':
    'Export all study data, including decks, cards, review history, images, and audio.',
  '支持 .repeaty 备份包和旧版 JSON。检查完成并确认后才会替换当前数据。':
    'Supports .repeaty archives and legacy JSON. Your collection is replaced only after validation and confirmation.',
  '.repeaty 最大 2 GB · 旧版 JSON 最大 100 MB': '.repeaty up to 2 GB · Legacy JSON up to 100 MB',
  '正在导出备份…': 'Exporting backup…',
  '正在检查备份…': 'Checking backup…',
  取消传输: 'Cancel transfer',
  已取消备份操作: 'Backup operation canceled',
  '自动备份未能完成，请导出备份并检查存储空间。':
    'Automatic backup failed. Export a backup and check storage space.',
  直接保存到文件: 'Save directly to file',
  '大备份可直接写入文件，减少内存占用。':
    'Save large backups directly to a file to reduce memory use.',
  '复习记录已达到 50 万条上限，请先导出备份。':
    'The limit of 500,000 reviews has been reached. Export a backup first.',
  '待学习 {count} 张': 'Cards to study: {count}',
  暂无待学习卡片: 'No cards ready to study',
  尚未添加卡片: 'No cards added yet',
  '添加卡片后即可开始学习。': 'Add cards to start studying.',
  '可添加新卡片，或稍后查看复习安排。': 'Add new cards or check the review schedule later.',
  '选择「重来」，这张卡片会在较短时间内再次出现。':
    'Choose Again. The card will appear again after a short interval.',
  '挖空 {number}': 'Cloze {number}',
  '正面 → 背面': 'Front → Back',
  '背面 → 正面': 'Back → Front',
  插件题目: 'Plugin question',
  题目插件: 'Question plugin',
  '请选择题目插件。': 'Choose a question plugin.',
  '普通卡片不能包含插件数据。': 'Standard cards cannot contain plugin data.',
  '插件数据不能超过 200,000 字符。': 'Plugin data cannot exceed 200,000 characters.',
  '题目插件不可用：{id}。请更新 Repeaty 后重试，题目数据仍会保留。':
    'Question plugin unavailable: {id}. Update Repeaty and try again. The question data is preserved.',
  '请填写 LeetCode 题目链接或英文标识。': 'Enter a LeetCode problem URL or slug.',
  '未找到题目，请检查链接。': 'Problem not found. Check the URL.',
  '无法读取题面，请在 LeetCode 检查该题的访问权限。':
    'The problem statement is unavailable. Check your access on LeetCode.',
  通过: 'Accepted',
  答案错误: 'Wrong answer',
  内存超限: 'Memory limit exceeded',
  输出超限: 'Output limit exceeded',
  运行超时: 'Time limit exceeded',
  运行错误: 'Runtime error',
  内部错误: 'Internal error',
  编译错误: 'Compile error',
  未通过: 'Not accepted',
  '判题服务未返回有效结果，请稍后重新查询。':
    'The judge did not return a valid result. Check again later.',
  '提交过于频繁，请稍后重试。': 'Too many submissions. Try again later.',
  '上一次提交尚未完成，请稍候。': 'The previous submission is still in progress.',
  '未取得提交编号，请先在 LeetCode 检查提交记录，避免重复提交。':
    'No submission ID was received. Check your LeetCode submissions before trying again to avoid submitting twice.',
  '连接 LeetCode': 'Connect LeetCode',
  'LeetCode 站点': 'LeetCode site',
  '中国站 · leetcode.cn': 'China · leetcode.cn',
  '国际站 · leetcode.com': 'International · leetcode.com',
  题目链接或英文标识: 'Problem URL or slug',
  '读取中…': 'Loading…',
  读取题目: 'Load problem',
  '已读取：{title}': 'Loaded: {title}',
  题目预览: 'Problem preview',
  '读取题目后再保存。题面保存在服务数据库中，提交判题需要联网。':
    'Load a problem before saving. The statement is saved in the server database; judging requires an internet connection.',
  解题笔记: 'Solution notes',
  '题目数据不完整，请编辑卡片并重新读取题目。':
    'Problem data is incomplete. Edit the card and load the problem again.',
  '判题尚未结束，可稍后继续查询，无需重新提交。':
    'Judging has not finished. Check again later without resubmitting.',
  '在 LeetCode 打开': 'Open in LeetCode',
  编程语言: 'Programming language',
  '尝试 {count} 次 · 用时 {time}': 'Attempts: {count} · Time: {time}',
  继续计时: 'Resume timer',
  暂停计时: 'Pause timer',
  '该题没有可用的代码模板，请在 LeetCode 作答。':
    'No code templates are available for this problem. Solve it on LeetCode.',
  代码: 'Code',
  '判题中…': 'Judging…',
  '提交到 LeetCode': 'Submit to LeetCode',
  继续查询结果: 'Check result again',
  '提交编号：{id}': 'Submission ID: {id}',
  '运行时间：{value}': 'Runtime: {value}',
  '内存：{value}': 'Memory: {value}',
  查看提交记录: 'View submission',
  复习评分: 'Review rating',
  手动评分: 'Manual rating',
  自动评分: 'Automatic rating',
  '自动评分：{grade}': 'Automatic rating: {grade}',
  评分规则: 'Rating rules',
  '通过且一次完成、用时不超过 {minutes} 分钟：简单；通过且不超过两次、用时不超过 {double} 分钟：良好；其余通过：困难。未通过或提前查看答案：重来。':
    'Accepted on the first attempt within {minutes} minutes: Easy. Accepted within two attempts and {double} minutes: Good. Other accepted solutions: Hard. Not accepted, or answer viewed first: Again.',
  '只统计取得提交编号的正式提交。计时可暂停，切换到其他标签页时自动暂停。':
    'Only submissions with a confirmed ID count as attempts. You can pause the timer; it pauses automatically when you switch tabs.',
  '草稿未能保存，请复制代码后再离开页面。':
    'The draft could not be saved. Copy your code before leaving this page.',
  '代码已通过 LeetCode 判题。': 'Your code was accepted by LeetCode.',
  '尚未通过 LeetCode 判题，本次可记为“重来”。':
    'Your code has not been accepted by LeetCode. You can rate this attempt Again.',
  '尚未添加解题笔记。可在编辑卡片时补充思路或参考代码。':
    'No solution notes yet. Edit the card to add an explanation or reference code.',
  结束作答并查看答案: 'Finish attempt and show answer',
  '尚无判题结果。可以继续作答，或将本次记为“重来”。':
    'No judge result yet. Continue solving or rate this attempt Again.',
  '保存评分：{grade}': 'Save rating: {grade}',
  'type 支持 basic、reversed、cloze、plugin、leetcode。':
    'type supports basic, reversed, cloze, plugin, and leetcode.',
  '有一次提交未取得编号，尝试次数可能不完整。本轮请手动评分，再次提交前请先检查 LeetCode 提交记录。':
    'A submission ID was not received, so the attempt count may be incomplete. Use a manual rating this round and check your LeetCode history before resubmitting.',
  插件: 'Plugins',
  内置: 'Built in',
  '将 LeetCode 题目加入卡组，编写代码并提交判题，按结果安排复习。':
    'Add LeetCode problems to a deck, submit code for judging, and schedule reviews from the results.',
  '添加卡片时点击「添加 LeetCode 题目」，或将笔记类型设为「插件题目」。':
    'In Add card, choose “Add LeetCode problem” or set the note type to “Plugin question.”',
  '添加 LeetCode 题目': 'Add LeetCode problem',
  '支持 Markdown 和数学公式，图片可直接粘贴到输入框。':
    'Supports Markdown and math. Paste images directly into either field.',
  '图片可直接粘贴到输入框。': 'Paste images directly into either field.',
  '添加图片 / 音频': 'Add image / audio',
  '每面最多 8 个附件，每个不超过 10 MB。': 'Up to 8 attachments per side, 10 MB each.',
  挖空: 'Cloze',
  '开启或关闭此部署已安装的题目插件。': 'Enable or disable installed question plugins.',
  '关闭插件后，相关题目暂停出现在复习队列中，内容和进度保留。开关仅影响当前浏览器。':
    'Disabled plugins are excluded from review. Their content and progress are kept. These preferences apply to this browser.',
  '插件开关已生效，但未能保存；下次打开时可能恢复默认设置。':
    'The setting is active but could not be saved. It may reset next time.',
  '启用 {name}': 'Enable {name}',
  已安装: 'Installed',
  已开启: 'Enabled',
  已关闭: 'Disabled',
  '此部署尚未安装题目插件。普通卡片可正常使用。':
    'No question plugins are installed. Standard flashcards are available.',
  '请先在插件页面启用对应插件，再编辑或保存题目。':
    'Enable the matching plugin on the Plugins page before editing or saving this question.',
  纯前端插件: 'Frontend plugin',
  需要后端: 'Requires backend',
  '服务返回了无法读取的数据，请刷新后重试。':
    'The service returned unreadable data. Reload and try again.',
  '请输入正确的服务访问密钥。': 'Enter a valid service access key.',
  '服务地址与后端配置不一致，请检查 REPEATY_ORIGIN。':
    'The service URL does not match its configuration. Check REPEATY_ORIGIN.',
  '数据已在另一个页面更新，请刷新页面后重试。':
    'Data changed in another page. Reload before trying again.',
  '服务拒绝了无效数据，本次修改未保存。':
    'The service rejected invalid data. Your changes were not saved.',
  '服务数据库操作失败，请检查后端日志。': 'The database operation failed. Check the server logs.',
  '请求的数据已不存在，请刷新页面。': 'The requested data no longer exists. Reload the page.',
  '无法连接服务，请检查后端是否正在运行。': 'Cannot connect. Check that the service is running.',
  服务访问密钥: 'Service access key',
  连接服务: 'Connect',
  '填写部署时设置的访问密钥。密钥仅保存在当前标签页会话中。':
    'Enter the access key configured for this deployment. It is kept only for this tab session.',
  'SQLite 存储': 'SQLite storage',
  后端版: 'Server edition',
  无法连接服务: 'Service unavailable',
  '导出、恢复备份，管理服务中的数据。': 'Export and restore backups of the data on your service.',
  '保存在服务的 SQLite 数据库中': 'Stored in SQLite on your service',
  '卡组、卡片、复习记录和附件保存在部署的服务中。定期导出备份，或备份服务器上的 SQLite 数据库。':
    'Decks, cards, review history, and attachments are stored on your service. Export backups regularly or back up its SQLite database.',
  '有数据变化时每 30 分钟保存快照；编辑、删除和恢复前也会保存。服务保留最近 10 份快照及其附件。':
    'Snapshots are saved every 30 minutes when data changes, and before edits, deletion, or restoration. The service keeps the latest 10 snapshots and their attachments.',
  '此版本需要连接服务才能读取和保存学习数据。需要离线使用时，可导出备份并导入静态版。':
    'This edition requires a connection to read and save study data. For offline use, export a backup and import it into the static edition.',
  '使用 FSRS 安排复习，数据保存在服务中。': 'Reviews use FSRS. Data is stored on your service.',
  后端版需要连接服务: 'Server connection required',
  '请先在插件页面填写该站点的 LeetCode 登录信息。':
    'Add credentials for this LeetCode site on the Plugins page first.',
  'LeetCode 登录已过期或需要验证，请部署者更新连接配置。':
    'LeetCode sign-in expired or requires verification. Ask the deployer to update the connection.',
  '服务无法连接 LeetCode，请稍后重试。': 'The service cannot connect to LeetCode. Try again later.',
  'LeetCode 判题服务': 'LeetCode judge service',
  '该站点已配置判题连接。': 'Judging is configured for this site.',
  '该站点尚未配置登录信息。可读取公开题目，提交判题需要部署者完成配置。':
    'Credentials are not configured for this site. Public problems can be loaded; submissions require configuration by the deployer.',
  '无法读取连接状态，请检查服务。': 'Cannot read connection status. Check the service.',
  '正在读取连接状态…': 'Checking connection\u2026',
  '提交使用部署者配置的 LeetCode 账号，并写入该账号的提交记录。登录信息只保留在服务端。':
    'Code is submitted using the LeetCode account configured by the deployer and appears in that account\u2019s history. Credentials stay on the server.',
  '后端未安装或未开启此插件。': 'This plugin is not installed or enabled on the service.',
  '练习记录已变化，请重新打开题目后重试。':
    'Practice data changed. Reopen the problem and try again.',
  '无法保存提交记录，请重试。': 'Cannot save the submission record. Try again.',
  正在提交: 'Submitting',
  等待判题: 'Waiting for judge',
  判题结束: 'Judging finished',
  提交状态未知: 'Submission status unknown',
  提交失败: 'Submission failed',
  提交历史: 'Submission history',
  '历史代码可展开查看。复习时查看往次代码会计为查看答案。':
    'Expand a submission to view its code. Viewing code from a previous practice counts as revealing the answer.',
  本次练习: 'Current practice',
  评分已撤销: 'Rating undone',
  '复习评分：{grade}': 'Review rating: {grade}',
  仅练习: 'Practice only',
  尚未评分: 'Not rated',
  '暂无提交记录。': 'No submissions yet.',
  '第 {count} 次提交': 'Submission {count}',
  '服务版本不兼容，请同时更新前端和后端。':
    'Incompatible service version. Update both the frontend and backend.',
  当时的题目: 'Problem at submission',
  '无法读取该提交，请检查编号和当前 LeetCode 登录信息。':
    'Cannot read this submission. Check its ID and your current LeetCode credentials.',
  '该提交不属于当前登录的 LeetCode 账号。':
    'This submission does not belong to the signed-in LeetCode account.',
  '该提交的题目、语言、代码或时间与本次记录不符。':
    'The problem, language, code, or time does not match this attempt.',
  '该提交已关联其他记录，不能重复关联。': 'This submission is already linked to another attempt.',
  '请填写当前站点的提交编号，或本题的提交详情链接。':
    'Enter a submission ID from this site, or a submission detail link for this problem.',
  恢复未确认的提交: 'Recover an unconfirmed submission',
  '在 LeetCode 找到这次提交，粘贴编号或详情链接。恢复只查询结果，不会重新提交代码。':
    'Find this attempt on LeetCode and paste its ID or detail link. Recovery only checks the result; it does not resubmit code.',
  核对本次提交的代码: 'Check the submitted code',
  提交编号或详情链接: 'Submission ID or detail link',
  粘贴提交编号或链接: 'Paste a submission ID or link',
  关联并查询: 'Link and check',
  练习历史: 'Practice history',
  '按题目查看历次代码、判题结果和复习评分。':
    'Browse code, judge results, and review ratings by problem.',
  搜索练习历史: 'Search practice history',
  搜索题目: 'Search problems',
  筛选题目: 'Filter problems',
  全部题目: 'All problems',
  全部结果: 'All results',
  尚未确认: 'Unconfirmed',
  题目: 'Problem',
  判题结果: 'Judge result',
  '有未完成的同题练习时，查看往次代码会计为查看答案。':
    'Viewing past code counts as revealing the answer for unfinished practices of the same problem.',
  '{count} 次练习': '{count} practices',
  '没有符合筛选条件的练习。': 'No practices match these filters.',
  '还没有练习记录。提交题目后可在这里查看。':
    'No practice history yet. Submit a problem to start a record.',
  练习历史分页: 'Practice history pages',
  '提交记录已不存在，请刷新后重试。': 'This submission no longer exists. Reload and try again.',
  '无法读取这次提交，请重试。': 'Cannot load this submission. Please try again.',
  '正在读取提交…': 'Loading submission…',
  重试: 'Retry',
  '第 {page} / {pages} 页': 'Page {page} of {pages}',
  '查看 {title} 的练习历史': 'View practice history for {title}',
  '有一次提交未取得编号，自动评分暂不可用。请先核对并关联 LeetCode 提交记录。':
    'One attempt has no confirmed submission ID, so automatic rating is unavailable. Check and link the attempt on LeetCode first.',
  桌面设置: 'Desktop settings',
  'MCP 连接': 'MCP connection',
  '允许本机的 AI 客户端查询待复习题目、学习统计和练习摘要。连接仅提供读取权限。':
    'Let an AI client on this computer read due questions, study statistics, and practice summaries. Access is read-only.',
  '仅支持本地学习库。退出应用或切换学习库后连接关闭，需要重新开启并更新客户端配置。':
    'Available for the local library. Quitting the app or switching libraries closes the connection. Enable it again and update your client configuration to reconnect.',
  '学习库正在处理数据，查询暂不可用。':
    'The library is processing data. Queries are temporarily unavailable.',
  '开启 MCP': 'Enable MCP',
  '关闭 MCP': 'Disable MCP',
  显示连接配置: 'Show connection configuration',
  隐藏连接配置: 'Hide connection configuration',
  客户端连接配置: 'Client configuration',
  '配置包含本次连接的访问密钥。只交给你信任的客户端；关闭连接后密钥失效。':
    'This configuration includes the access key for this connection. Share it only with a trusted client. Disabling the connection revokes the key.',
  复制配置: 'Copy configuration',
  已复制: 'Copied',
  'MCP 连接不可用，请重新打开应用。': 'MCP is unavailable. Please reopen the app.',
  '无法读取 MCP 状态，请重新打开设置。': 'Cannot read MCP status. Please reopen settings.',
  '无法更新 MCP 连接，请重试。': 'Cannot update the MCP connection. Please try again.',
  'MCP 连接已关闭，请重新开启。': 'The MCP connection is closed. Enable it to reconnect.',
  '未能复制，请选中配置后手动复制。': 'Copy failed. Select the configuration and copy it manually.',
  '可查询待复习题目、学习统计和练习摘要。在材料中分享摘录后，还可接收制卡草稿。':
    'Use read-only queries for due questions, study statistics, and practice summaries. Share an excerpt from Materials to receive card drafts.',
  '制卡草稿（{count}）': 'Card drafts ({count})',
  制卡草稿: 'Card drafts',
  '通过 MCP 制卡': 'Create cards with MCP',
  '将这段摘录分享给已连接的客户端，供它生成制卡草稿。草稿保存前由你确认。':
    'Share this excerpt with your connected client to generate card drafts. You review them before saving.',
  草稿默认卡组: 'Default deck for drafts',
  '客户端可能将摘录发送给它使用的模型服务。请确认选区中包含的内容。':
    'Your client may send the excerpt to its model provider. Check the content you have selected.',
  '正在分享…': 'Sharing…',
  分享这段摘录: 'Share this excerpt',
  当前分享的摘录: 'Shared excerpt',
  停止分享: 'Stop sharing',
  '在 MCP 客户端请求生成卡片草稿。收到后会显示在这里。':
    'Ask your MCP client to create card drafts. They will appear here when received.',
  '待确认草稿保存在本机，重启后可继续处理。草稿不进入复习或备份；确认保存卡片后才会加入。':
    'Drafts are saved on this device so you can continue after restarting. They enter reviews and backups only after you confirm and save them as cards.',
  保存草稿: 'Save draft',
  '尚未完成时可先保存草稿，下次继续编辑。': 'Save an unfinished draft to continue editing later.',
  重新读取草稿: 'Reload drafts',
  '无法读取制卡草稿，已有草稿未被覆盖。请重试或重新打开应用。':
    'Cannot load card drafts. Existing drafts have not been overwritten. Try again or reopen the app.',
  '存储空间不足，草稿未保存。请释放空间后重试。':
    'Not enough storage to save drafts. Free some space and try again.',
  '无法保存制卡草稿，请重试。': 'Cannot save card drafts. Please try again.',
  '待确认草稿已达 50 条，请先保存或丢弃一些草稿。':
    'You have reached the limit of 50 drafts. Save or discard some drafts first.',
  '还没有待确认的草稿。': 'No drafts awaiting review.',
  待确认草稿: 'Drafts awaiting review',
  '材料或卡组已不存在，请丢弃草稿后重新选取。':
    'The source or deck is no longer available. Discard the draft and select an excerpt again.',
  检查并编辑: 'Review and edit',
  丢弃草稿: 'Discard draft',
  确认制卡草稿: 'Review card draft',
  确认并保存卡片: 'Confirm and save card',
  '材料或学习库已变化，请重新选取摘录。':
    'The source or library has changed. Please select the excerpt again.',
  '学习库已变化，阅读位置未保存。': 'The library has changed. Your reading position was not saved.',
  '材料已变化，请重新打开后继续阅读。': 'The material has changed. Reopen it to continue reading.',
  '阅读位置与材料不匹配。': 'The reading position does not match this material.',
  材料阅读预览: 'Reading preview',
  '上次阅读 {date}': 'Last read {date}',
  继续阅读: 'Continue reading',
  '正在保存阅读位置…': 'Saving reading position…',
  阅读位置已保存: 'Reading position saved',
  '阅读位置会自动保存。': 'Your reading position is saved automatically.',
  重试保存位置: 'Retry saving position',
  保存阅读位置: 'Save reading position',
  从头阅读: 'Read from beginning',
  '学习库已变化，阅读安排未保存。': 'The library has changed. Your reading schedule was not saved.',
  '请选择有效的阅读日期。': 'Choose a valid reading date.',
  '请选择今天之后的阅读日期。': 'Choose a date after today.',
  更改阅读安排前: 'Before changing the reading schedule',
  阅读安排已保存: 'Reading schedule saved',
  '修改已保存，但暂时无法读取快照列表。':
    'Your changes were saved, but the snapshot list could not be loaded.',
  阅读队列: 'Reading queue',
  待阅读: 'To read',
  稍后阅读: 'Read later',
  已归档: 'Archived',
  全部材料: 'All materials',
  归档材料: 'Archive',
  加入待阅读: 'Read now',
  下次阅读日期: 'Next reading date',
  快捷安排: 'Quick schedule',
  明天: 'Tomorrow',
  '3 天后': 'In 3 days',
  '1 周后': 'In 1 week',
  保存阅读安排: 'Save reading schedule',
  '读过，安排下次': 'Read and schedule next',
  '上次间隔：{interval}': 'Last interval: {interval}',
  '本次间隔：{interval}': 'Next interval: {interval}',
  '下次阅读：{date}': 'Next reading: {date}',
  阅读间隔: 'Reading intervals',
  重置间隔: 'Reset interval',
  '下次从 1 天开始，已安排的阅读日期保持不变。':
    'Start again at 1 day next time. The currently scheduled date stays the same.',
  '每次确认后依次使用 1、3、7、14、30 天，之后保持 30 天。':
    'The intervals are 1, 3, 7, 14 and 30 days. Further reads stay at 30 days.',
  '按本机日期安排，到这一天会自动加入待阅读列表。':
    'The material returns to your to-read list on this date, using your local time.',
  '安排于 {date}': 'Scheduled for {date}',
  暂无待阅读材料: 'Nothing to read today',
  '切换到稍后阅读或已归档查看材料。': 'Check Read later or Archived to find your materials.',
  选择一篇材料开始阅读: 'Choose something to read',
  '当前列表为空。': 'This list is empty.',
  '学习库已变化，摘录未保存。': 'The library has changed. Your excerpt was not saved.',
  '请从原文保存摘录。': 'Save excerpts from the original material.',
  保存摘录前: 'Before saving an excerpt',
  '摘录与来源不匹配。': 'The excerpt does not match its source.',
  摘录: 'Excerpt',
  查看出处: 'View original',
  返回摘录: 'Back to excerpt',
  用此摘录制卡: 'Make a card from this excerpt',
  保存为摘录: 'Save as excerpt',
  摘录标题: 'Excerpt title',
  选中的原文: 'Selected text',
  保存摘录: 'Save excerpt',
  摘录已保存: 'Excerpt saved',
  '摘录会加入待阅读列表，可单独阅读和制卡。':
    'The excerpt will join your to-read list. Read it separately or use it to make cards.',
  '原文已删除，摘录内容仍保留。': 'The original was deleted. This excerpt is still available.',
  '由此保存的摘录仍保留，出处关联会解除。':
    'Saved excerpts will remain, with their links to this original removed.',
  '选中原文中的文字，保存为摘录或直接制卡。每次最多 10000 个字符。':
    'Select text to save an excerpt or make a card. Up to 10,000 characters per selection.',
  本篇摘录: 'Excerpts from this source',
  '本篇摘录（{count}）': 'Excerpts from this source ({count})',
  '按原文位置排列，包含稍后阅读和已归档的摘录。':
    'In source order, including deferred and archived excerpts.',
  '{count} 张关联卡片': '{count} linked cards',
  当前选区: 'Current selection',
  定位原文: 'Locate in source',
  '定位「{title}」的原文': 'Locate “{title}” in source',
  打开摘录: 'Open excerpt',
  '打开摘录「{title}」': 'Open excerpt “{title}”',
  本篇摘录分页: 'Excerpt pages',
  '第 {page} 页，共 {pages} 页': 'Page {page} of {pages}',
  '这段原文已有 {count} 份摘录。': 'Existing excerpts for this selection: {count}.',
  查看已有摘录: 'Show saved excerpts',
  工作目录: 'Workspace',
  预览: 'Preview',
  打开目录: 'Open folder',
  创建预览目录: 'Create preview folder',
  重新扫描: 'Rescan',
  关闭目录: 'Close folder',
  当前预览目录: 'Current preview folder',
  目录文件: 'Workspace files',
  查找文件: 'Find a file',
  文件路径: 'File path',
  '{p0} 个文件': '{p0} files',
  最近打开: 'Recently opened',
  文件版本: 'File version',
  文件原文: 'Working file',
  已接受版本: 'Accepted version',
  未变化: 'Unchanged',
  文件已修改: 'Modified',
  文件已改名: 'Renamed',
  改名并修改: 'Renamed and modified',
  尚未接受: 'Not yet accepted',
  '普通 Markdown': 'Plain Markdown file',
  缺少身份: 'Missing identity',
  需要检查: 'Needs attention',
  存在冲突: 'Conflict',
  文件缺失: 'Missing file',
  '查看外部 Markdown 与已接受版本。当前学习库不会随预览切换。':
    'Inspect external Markdown and accepted versions. Your study library stays separate.',
  '此预览使用独立的实验目录，尚不用于日常复习。旧库迁移与自动接收文件修改尚未开放。':
    'This preview uses a separate experimental folder. Daily study, migration, and automatic acceptance of file changes are not available here yet.',
  '正在读取工作目录…': 'Reading workspace…',
  '扫描未完成。缺失文件不会据此认定为已删除。':
    'The scan is incomplete. Missing files will not be treated as deleted.',
  '没有匹配的文件。': 'No matching files.',
  '目录中还没有 Markdown 文件。': 'There are no Markdown files in this folder yet.',
  '文件内容为空。': 'The file is empty.',
  '没有可预览的正文。': 'No text is available to preview.',
  '选择文件查看原文。预览不会执行 HTML 或插件。':
    'Select a file to read its text. The preview does not execute HTML or plugins.',
  '请选择一个空文件夹。目录中已有的文件不会被覆盖。':
    'Choose an empty folder. Existing files will be kept.',
  '暂不支持这个目录格式。请选择由工作目录预览创建的文件夹。':
    'This folder format is not supported yet. Choose a folder created by Workspace Preview.',
  '这个工作目录已在使用中。请先关闭另一会话，再重新打开。':
    'This workspace is already open. Close the other session before opening it here.',
  '目录已被移动或替换。请通过“打开目录”重新选择。':
    'The folder was moved or replaced. Use “Open folder” to select it again.',
  '找不到目录或必要文件。请检查位置，再重新打开。':
    'The folder or a required file could not be found. Check its location and open it again.',
  '目录会话已变化。请重新扫描或打开目录。':
    'The workspace session changed. Rescan or open the folder again.',
  '无法访问这个目录。请检查文件夹权限。': 'This folder cannot be accessed. Check its permissions.',
  '文件数量或总大小超出本次预览范围，扫描结果不完整。':
    'The file count or total size exceeds the preview limit. The scan is incomplete.',
  '文件不是有效的 UTF-8 文本。请保留原文件，检查编码后重新扫描。':
    'This file is not valid UTF-8. Keep the original, check its encoding, and rescan.',
  '文件超过 2 MiB，未读取其正文。': 'The file exceeds 2 MiB. Its text was not read.',
  '读取期间文件发生变化。请保存后重新扫描。':
    'The file changed while being read. Save it and rescan.',
  '已跳过链接或不支持的文件。扫描结果不完整。':
    'Links or unsupported files were skipped. The scan is incomplete.',
  '暂时无法读取工作目录。请检查文件和权限后重试。':
    'The workspace could not be read. Check its files and permissions, then try again.',
  '多个文件使用了同一个身份。请保留各份内容，检查后再处理。':
    'Several files share the same identity. Keep every copy and review them before proceeding.',
  '文件名存在大小写或 Unicode 冲突。请分别保留并检查。':
    'File names conflict by case or Unicode spelling. Keep each file and review the names.',
  '这个位置的笔记身份已变化。原已接受版本仍保留。':
    'The note identity at this path changed. The original accepted version is retained.',
  '工作文件暂时缺失，已接受的正文仍保留。':
    'The working file is missing. Its accepted text is retained.',
  '文件内容尚未通过校验。请检查元数据、题面与答案分隔，再重新扫描。':
    'The file has not passed validation. Check its metadata and question/answer separator, then rescan.',
  '浏览目录中的 Markdown 与已接受版本。': 'Browse Markdown files and accepted versions.',
  '预览目录独立于当前学习库，暂不用于复习或旧库迁移。':
    'Preview folders stay separate from your study library. Study and migration are not available here yet.',
  '文件：{p0}': 'Files: {p0}',
  文件分页: 'File pages',
  '最近记录已变化。请通过“打开目录”重新选择。':
    'Recent folders changed. Use “Open folder” to choose it again.',
  '请先创建或打开工作目录。': 'Create or open a workspace first.',
  '请选择空文件夹。已有文件不会被覆盖。': 'Choose an empty folder. Existing files will be kept.',
  '不支持这个工作目录格式。': 'This workspace format is not supported.',
  '这个学习库已在另一窗口中打开。': 'This workspace is already open in another window.',
  '找不到工作目录或必要文件。': 'The workspace or a required file could not be found.',
  '工作目录已被移动或替换，请重新打开。': 'The workspace was moved or replaced. Open it again.',
  '学习库已切换，请重新打开当前内容。': 'The workspace changed. Open this item again.',
  '文件已在外部修改，请先在工作目录页面检查并接受修改。':
    'This file was edited externally. Review and accept the change in Workspace first.',
  '学习库内容已变化，请重新载入。': 'The workspace changed. Reload it before continuing.',
  '无法访问工作目录，请检查文件夹权限。':
    'Cannot access the workspace. Check the folder permissions.',
  '目录中包含链接或不支持的文件，操作已停止。':
    'The workspace contains a link or an unsupported file. The operation was stopped.',
  '本次文件检查超过范围，请减少文件数量或大小。': 'This scan exceeds the file count or size limit.',
  '内容无效，修改未保存。': 'The content is invalid. Changes were not saved.',
  '内容已不存在，请重新载入。': 'This item no longer exists. Reload the workspace.',
  '无法读写工作目录，请检查磁盘空间和文件权限。':
    'Cannot read or write the workspace. Check free space and folder permissions.',
  '卡片、材料、附件和学习进度保存在同一个文件夹中。':
    'Cards, sources, attachments and study progress live in one folder.',
  创建学习库: 'Create workspace',
  当前学习库: 'Current workspace',
  '打开文件夹，开始学习': 'Open a folder to start learning',
  '首次使用请选择空文件夹创建学习库，入门卡组会自动添加。':
    'Choose an empty folder to create a workspace. A starter deck will be added.',
  '已有学习库请选择包含 workspace.json 的文件夹。':
    'To open an existing workspace, choose the folder containing workspace.json.',
  '部分正文文件需要检查。已保存的学习进度仍保留在当前目录。':
    'Some content files need attention. Your saved study progress remains in this workspace.',
  '卡片方向或挖空编号已变化，请在应用内编辑确认。':
    'Card directions or cloze numbers changed. Edit the note in the app to confirm these changes.',
  '材料快照的外部修改暂不自动接受，原有摘录与出处保持不变。':
    'External changes to source snapshots are not accepted automatically. Existing excerpts and references are preserved.',
  接受修改: 'Accept changes',
  '在侧边栏“工作目录”中创建、打开或关闭学习库。':
    'Use Workspace in the sidebar to create, open or close a workspace.',
  保存在工作目录中: 'Saved in your workspace folder',
} as const
