import { describe, expect, it } from 'vitest'
import { automaticGrade, parseJudgeResult, parseProblemInput, parseProblemResponse } from './model'

describe('LeetCode grading', () => {
  it.each([
    [1, 600000, 'Easy', 4],
    [1, 600001, 'Easy', 3],
    [2, 1200000, 'Easy', 3],
    [2, 1200001, 'Easy', 2],
    [3, 1, 'Easy', 2],
    [1, 1200000, 'Medium', 4],
    [1, 2100000, 'Hard', 4],
  ] as const)('rates %i attempts in %i ms on %s as %i', (attempts, ms, difficulty, grade) => {
    expect(automaticGrade('accepted', attempts, ms, difficulty)).toBe(grade)
    expect(automaticGrade('rejected', attempts, ms, difficulty)).toBe(1)
    expect(automaticGrade('accepted', attempts, ms, difficulty, true)).toBe(1)
  })
  it('requires an explicit accepted result and keeps infrastructure failures pending', () => {
    expect(parseJudgeResult({ state: 'STARTED' })).toBeUndefined()
    expect(parseJudgeResult({ state: 'SUCCESS', status_code: 10 })?.outcome).toBe('accepted')
    expect(
      parseJudgeResult({ state: 'SUCCESS', status_code: 10, compare_result: '101' })?.status,
    ).toBe('答案错误')
    expect(
      parseJudgeResult({
        state: 'SUCCESS',
        status_code: 20,
        compile_error: '<script>bad</script>',
      }),
    ).toMatchObject({ outcome: 'rejected', status: '编译错误', detail: '<script>bad</script>' })
    for (const result of [
      { state: 'FAILURE' },
      { state: 'SUCCESS' },
      { state: 'SUCCESS', status_code: 16 },
      { state: 'SUCCESS', status_code: 999 },
    ])
      expect(() => parseJudgeResult(result)).toThrow()
  })
})

it('uses the configured site for slugs and the explicit site in problem links', () => {
  expect(parseProblemInput('two-sum', 'leetcode.cn')).toEqual({
    site: 'leetcode.cn',
    slug: 'two-sum',
  })
  expect(
    parseProblemInput('https://leetcode.com/problems/two-sum/description/?x=1', 'leetcode.cn'),
  ).toEqual({ site: 'leetcode.com', slug: 'two-sum' })
  for (const input of [
    'https://leetcode.cn.evil.test/problems/two-sum/',
    'javascript:alert(1)',
    'https://user@leetcode.cn/problems/a/',
    '../graphql',
    'https://leetcode.cn:444/problems/a/',
  ])
    expect(() => parseProblemInput(input, 'leetcode.cn')).toThrow()
})

it('loads translated content for China and rejects missing or mismatched problems', () => {
  const question = {
    questionId: '1',
    questionFrontendId: '1',
    title: 'Test',
    titleSlug: 'test',
    content: '<p>Test</p>',
    translatedContent: '<p>题目</p>',
    translatedTitle: '测试',
    difficulty: 'Easy',
    codeSnippets: [],
  }
  expect(parseProblemResponse({ data: { question } }, 'leetcode.cn', 'test')).toMatchObject({
    title: '测试',
    content: '<p>题目</p>',
  })
  expect(parseProblemResponse({ data: { question } }, 'leetcode.com', 'test')).toMatchObject({
    title: 'Test',
    content: '<p>Test</p>',
  })
  expect(() => parseProblemResponse({ data: { question } }, 'leetcode.cn', 'different')).toThrow()
  expect(() => parseProblemResponse({ data: { question: null } }, 'leetcode.cn', 'test')).toThrow()
})
