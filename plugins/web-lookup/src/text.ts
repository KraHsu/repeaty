import { locale } from '@repeaty/plugin-api'
const english: Record<string, string> = {
  '查询目标已保存。': 'Lookup targets saved.',
  选区查询: 'Selection lookup',
  工具: 'Tools',
  查询选中文字: 'Look up selected text',
  查询目标: 'Lookup targets',
  '查询目标无法读取，当前使用默认目标。':
    'Saved targets could not be read. Default targets are shown.',
  '查询目标未保存，请重试。': 'Targets were not saved. Please retry.',
  '使用搜索、词典和问答网站查询选中文字。':
    'Look up selected text in search engines, dictionaries and question-answering sites.',
  '仅在点击网站后发送下面的选区。不会自动发送整篇材料、学习记录或附件。':
    'Only the selection below is sent when you click a site. Entire materials, study history and attachments are not sent automatically.',
  '请先在阅读器中选中文字。': 'Select text in the reader first.',
  '没有启用的查询目标，请到设置中添加。': 'No lookup targets are enabled. Add one in Settings.',
  '在网址中用 {text} 表示选中文字。文字会编码后填入链接，在浏览器中打开。':
    'Use {text} in the URL for selected text. It is URL-encoded before the link opens in your browser.',
  恢复默认: 'Restore defaults',
  名称: 'Name',
  查询网址: 'Lookup URL',
  上移: 'Move up',
  下移: 'Move down',
  删除: 'Delete',
  新查询目标: 'New lookup target',
  添加目标: 'Add target',
  保存: 'Save',
  关闭: 'Close',
  '请选择 1 至 10000 个字符。': 'Select between 1 and 10,000 characters.',
  '网址必须包含 {text} 占位符。': 'The URL must contain the {text} placeholder.',
  '请使用固定网站的 HTTPS 网址，不要填写登录信息。':
    'Use an HTTPS URL with a fixed host and no login information.',
  '查询内容过长，请缩短选区。': 'The query is too long. Select less text.',
  '查询目标无效，最多可配置 32 项。': 'Invalid lookup targets. You can configure up to 32.',
  '请填写有效且不重复的查询目标。': 'Enter valid targets with distinct IDs.',
}
export function text(key: string) {
  return locale.value === 'zh-CN' ? key : (english[key] ?? key)
}
