import { z } from 'zod'
import { siteSchema, type LeetCodeSite } from './model'
export const configurationSchema = z.object({ configured: z.array(siteSchema) })

export const accountSchema = z.discriminatedUnion('state', [
  z.object({ site: siteSchema, state: z.literal('unconfigured') }),
  z.object({ site: siteSchema, state: z.literal('expired') }),
  z.object({
    site: siteSchema,
    state: z.literal('authenticated'),
    username: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\x00-\x1f\x7f]+$/),
  }),
])
export type AccountStatus = z.infer<typeof accountSchema>
export interface AccountIssue {
  site: LeetCodeSite
  code: string
}
const listeners = new Set<(issue: AccountIssue) => void>()
/** Session health is transient; it never enters study records or browser storage. */
export function onAccountIssue(listener: (issue: AccountIssue) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function reportAccountIssue(site: LeetCodeSite, code: string) {
  if (
    [
      'login-required',
      'verification-required',
      'request-failed',
      'submission-unknown',
      'rate-limit',
      'credentials-changed',
    ].includes(code)
  )
    for (const listener of listeners) listener({ site, code })
}
