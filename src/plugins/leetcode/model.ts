import { z } from 'zod'
import type { Grade } from '../../core/model'

export const siteSchema = z.enum(['leetcode.cn', 'leetcode.com'])
export type LeetCodeSite = z.infer<typeof siteSchema>
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(160)
export const problemSchema = z.object({
  site: siteSchema,
  slug: slugSchema,
  questionId: z.string().regex(/^\d{1,30}$/),
  frontendId: z.string().max(60),
  title: z.string().min(1).max(300),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  // Store the original statement; render it with a strict HTML allowlist.
  content: z.string().min(1).max(100_000),
  snippets: z
    .array(
      z.object({
        lang: z.string().max(80),
        langSlug: z.string().regex(/^[a-z0-9-]{1,40}$/),
        code: z.string().max(20_000),
      }),
    )
    .max(60),
})
export type LeetCodeProblem = z.infer<typeof problemSchema>
export function problemUrl(problem: Pick<LeetCodeProblem, 'site' | 'slug'>) {
  return `https://${problem.site}/problems/${problem.slug}/`
}
export function parseProblemInput(value: string, site: LeetCodeSite) {
  const input = value.trim()
  if (!input.includes('://')) return { site, slug: slugSchema.parse(input) }
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new Error('请填写 LeetCode 题目链接或英文标识。')
  const match = url.pathname.match(
    /^\/problems\/([^/]+)(?:\/(?:description|editorial|solutions|submissions))?\/?$/,
  )
  if (!match) throw new Error('请填写 LeetCode 题目链接或英文标识。')
  return { site: siteSchema.parse(url.hostname), slug: slugSchema.parse(match[1]) }
}
export function parseProblemResponse(
  raw: unknown,
  site: LeetCodeSite,
  slug: string,
): LeetCodeProblem {
  const response = z
    .object({
      data: z.object({
        question: z
          .object({
            questionId: z.string(),
            questionFrontendId: z.string(),
            title: z.string(),
            titleSlug: z.string(),
            translatedTitle: z.string().nullish(),
            content: z.string().nullish(),
            translatedContent: z.string().nullish(),
            difficulty: z.string(),
            codeSnippets: z
              .array(z.object({ lang: z.string(), langSlug: z.string(), code: z.string() }))
              .nullish(),
          })
          .nullable(),
      }),
    })
    .parse(raw)
  const question = response.data.question
  if (!question || question.titleSlug !== slug) throw new Error('未找到题目，请检查链接。')
  const content = (site === 'leetcode.cn' && question.translatedContent) || question.content
  if (!content) throw new Error('无法读取题面，请在 LeetCode 检查该题的访问权限。')
  return problemSchema.parse({
    site,
    slug,
    questionId: question.questionId,
    frontendId: question.questionFrontendId,
    title: (site === 'leetcode.cn' && question.translatedTitle) || question.title,
    difficulty: question.difficulty,
    content,
    snippets: question.codeSnippets ?? [],
  })
}

export interface JudgeResult {
  outcome: 'accepted' | 'rejected'
  status: string
  runtime: string
  memory: string
  detail: string
}
const statusLabels: Record<number, string> = {
  10: '通过',
  11: '答案错误',
  12: '内存超限',
  13: '输出超限',
  14: '运行超时',
  15: '运行错误',
  16: '内部错误',
  20: '编译错误',
}
export function parseJudgeResult(raw: unknown): JudgeResult | undefined {
  const result = z
    .object({
      state: z.string(),
      status_code: z.number().optional(),
      status_msg: z.string().nullish(),
      compare_result: z.string().nullish(),
      status_runtime: z.string().nullish(),
      status_memory: z.string().nullish(),
      full_compile_error: z.string().nullish(),
      compile_error: z.string().nullish(),
      full_runtime_error: z.string().nullish(),
      runtime_error: z.string().nullish(),
      last_testcase: z.string().nullish(),
    })
    .parse(raw)
  if (['PENDING', 'STARTED'].includes(result.state)) return undefined
  if (
    result.state !== 'SUCCESS' ||
    result.status_code === undefined ||
    result.status_code === 16 ||
    !Object.hasOwn(statusLabels, result.status_code)
  )
    throw new Error('判题服务未返回有效结果，请稍后重新查询。')
  const accepted = result.status_code === 10 && !result.compare_result?.includes('0')
  return {
    outcome: accepted ? 'accepted' : 'rejected',
    status: accepted
      ? '通过'
      : (statusLabels[result.status_code === 10 ? 11 : result.status_code] ?? '未通过'),
    runtime: result.status_runtime ?? '',
    memory: result.status_memory ?? '',
    detail: (
      result.full_compile_error ||
      result.compile_error ||
      result.full_runtime_error ||
      result.runtime_error ||
      result.last_testcase ||
      ''
    ).slice(0, 10000),
  }
}
export const targetMinutes = { Easy: 10, Medium: 20, Hard: 35 } as const
/** Heuristic, not a LeetCode difficulty estimate or trained FSRS parameter. */
export function automaticGrade(
  outcome: JudgeResult['outcome'],
  attempts: number,
  elapsedMs: number,
  difficulty: LeetCodeProblem['difficulty'],
  revealed = false,
): Grade {
  if (
    outcome !== 'accepted' ||
    revealed ||
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0
  )
    return 1
  const target = targetMinutes[difficulty] * 60_000
  if (attempts === 1 && elapsedMs <= target) return 4
  if (attempts <= 2 && elapsedMs <= target * 2) return 3
  return 2
}

export function defaultSite(): LeetCodeSite {
  try {
    return siteSchema.parse(localStorage.getItem('repeaty.leetcode.site') ?? 'leetcode.cn')
  } catch {
    return 'leetcode.cn'
  }
}
export function rememberSite(site: LeetCodeSite) {
  try {
    localStorage.setItem('repeaty.leetcode.site', site)
  } catch {
    /* Preference is optional. */
  }
}
