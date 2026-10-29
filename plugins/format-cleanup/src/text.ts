import { locale } from '@repeaty/plugin-api'
const english: Record<string, string> = {
  格式清理: 'Formatting cleanup',
  预览规则后清理材料正文: 'Preview rules before cleaning material text',
  工具: 'Tools',
  '保护代码与链接，预览差异后应用可撤销的正文清理。':
    'Protect code and links, then preview and apply undoable text cleanup.',
  '选择材料，检查差异，再应用。规则在「设置 → 工具 → 格式清理」中配置。':
    'Choose material, compare the result, then apply. Configure rules under Settings → Tools → Formatting cleanup.',
  预览清理: 'Preview cleanup',
  预览格式清理: 'Preview formatting cleanup',
  材料: 'Material',
  选择要清理的材料: 'Choose material to clean',
  '还没有可清理的文本或 Markdown 材料。': 'No editable text or Markdown material yet.',
  '代码、链接地址和 YAML 属性保持原样。清理在后台执行，可随时取消。':
    'Code, link destinations and YAML properties are preserved. Cleanup runs in the background and can be cancelled.',
  取消预览: 'Cancel preview',
  '当前规则没有产生变化。': 'These rules produce no changes.',
  清理前: 'Before',
  清理后: 'After',
  清理前的完整正文: 'Full original text',
  清理后的完整正文: 'Full cleaned text',
  字符: 'characters',
  应用清理: 'Apply cleanup',
  清理行尾空白: 'Trim trailing whitespace',
  '保留 Markdown 的两个空格换行标记。':
    'Preserve the two spaces used for Markdown hard line breaks.',
  合并连续空行: 'Collapse blank lines',
  '段落之间最多保留一个空行。': 'Keep at most one blank line between paragraphs.',
  统一缩进: 'Normalize indentation',
  '可编辑段落中的制表符转换为四个空格；代码缩进保持原样。':
    'Convert indentation tabs in editable text to four spaces; preserve code indentation.',
  自定义替换: 'Replacement rules',
  '按顺序执行，始终保护代码、链接地址与 YAML。正则支持捕获组替换，如 $1。':
    'Run in order while protecting code, link destinations and YAML. Regex replacements support captures such as $1.',
  规则: 'Rule',
  删除: 'Delete',
  匹配方式: 'Match type',
  文字: 'Literal text',
  正则表达式: 'Regular expression',
  查找: 'Find',
  替换为: 'Replace with',
  留空表示删除: 'Leave blank to remove',
  正则标志: 'Regex flags',
  'i 忽略大小写；m 多行': 'i: ignore case; m: multiline',
  启用此规则: 'Enable rule',
  添加规则: 'Add rule',
  '已保存为新版本。可使用应用的撤销操作恢复原文；已有卡片和阅读历史保持不变。':
    'Saved as a new version. Use the application’s Undo action to restore the original. Existing cards and reading history are preserved.',
  '保存的规则无法读取，请重新配置。': 'Saved rules could not be read. Configure them again.',
  '保存规则失败。': 'Could not save rules.',
  '学习库已变化，请重新打开。': 'The library changed. Reopen this page.',
  '请选择材料。': 'Choose material first.',
  '学习库内容已变化，请重新预览。': 'The library changed. Preview again.',
  '当前环境不支持安全的后台清理任务。':
    'This environment does not support safe background cleanup.',
  '清理超过 2 秒，已停止。请简化正则或缩小规则范围。':
    'Cleanup exceeded two seconds and was stopped. Simplify the regular expressions.',
  '后台清理失败。': 'Background cleanup failed.',
  '清理失败。': 'Cleanup failed.',
  '文档或规则超过限制。': 'The document or rules exceed the supported limits.',
  '清理结果超过 250000 字符。': 'The result exceeds 250,000 characters.',
  '替换规则无效；查找内容不能为空，每项最多 1000 字符。':
    'Invalid rule. Find text cannot be empty; each field is limited to 1,000 characters.',
  '正则标志仅支持 g、i、m、u。': 'Only g, i, m and u regex flags are supported.',
  '清理结果为空，请调整规则。': 'The result is empty. Adjust the rules.',
}
export function text(value: string) {
  return locale.value === 'en' ? (english[value] ?? value) : value
}
