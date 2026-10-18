// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { statementHtml } from './content'

it('preserves statement structure and diagrams without executing imported HTML', () => {
  const html = statementHtml(
    '<p onclick="evil()">Hello <strong>world</strong></p><pre>x &lt; y</pre><img src="https://assets.leetcode.com/test.png" onerror="evil()"><script>evil()</script><iframe src="https://evil.test"></iframe><svg onload="evil()"></svg><img src="https://evil.test/track"><a href="javascript:evil()">link</a><style>body{display:none}</style>',
  )
  expect(html).toContain('<strong>world</strong>')
  expect(html).toContain('<pre>x &lt; y</pre>')
  expect(html).toContain('https://assets.leetcode.com/test.png')
  expect(html).toContain('referrerpolicy="no-referrer"')
  expect(html).not.toMatch(/evil|onclick|onerror|script|iframe|svg|style|javascript/)
})
