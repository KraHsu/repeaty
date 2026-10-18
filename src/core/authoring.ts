import { msg, LocalizedError } from '../i18n'
import { clozes } from './model'

export function insertCloze(
  text: string,
  start: number,
  end: number,
): { text: string; cursor: number } {
  if (start >= end) throw new LocalizedError(msg('请先选中正面中需要挖空的文字。'))
  const selected = text.slice(start, end)
  if (
    selected.includes('{{c') ||
    /\{\{c\d+::[^]*$/.test(text.slice(0, start).split('}}').at(-1) ?? '')
  )
    throw new LocalizedError(msg('暂不支持嵌套挖空，请选择尚未挖空的文字。'))
  const used = new Set([...text.matchAll(/\{\{c([1-9]\d?)::/g)].map((match) => Number(match[1])))
  let number = 1
  while (used.has(number)) number++
  if (number > 99) throw new LocalizedError(msg('最多支持 99 个挖空编号。'))
  const replacement = `{{c${number}::${selected}}}`
  const result = text.slice(0, start) + replacement + text.slice(end)
  if (result.length > 10000) throw new LocalizedError(msg('内容超过 10000 字。'))
  clozes(result)
  return { text: result, cursor: start + replacement.length }
}
