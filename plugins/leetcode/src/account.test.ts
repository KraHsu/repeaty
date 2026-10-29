import { expect, it } from 'vitest'
import { accountSchema } from './account'

it('accepts only explicit account states with a bounded username for authenticated sessions', () => {
  for (const site of ['leetcode.cn', 'leetcode.com']) {
    expect(accountSchema.parse({ site, state: 'expired' })).toEqual({ site, state: 'expired' })
    expect(
      accountSchema.parse({
        site,
        state: 'authenticated',
        username: 'learner',
        ignored: 'private',
      }),
    ).toEqual({ site, state: 'authenticated', username: 'learner' })
    for (const raw of [
      { site, state: 'authenticated' },
      { site, state: 'authenticated', username: '' },
      { site, state: 'authenticated', username: 'bad\nname' },
      { site, state: 'authenticated', username: 'x'.repeat(201) },
      { site, state: 'unknown', username: 'learner' },
      { site: 'evil.test', state: 'authenticated', username: 'learner' },
      { configured: [site] },
    ])
      expect(accountSchema.safeParse(raw).success).toBe(false)
  }
})
