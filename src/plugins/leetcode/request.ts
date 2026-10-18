export type Site = 'leetcode.cn' | 'leetcode.com'
export type Request =
  | { action: 'ping' }
  | { action: 'question'; site: Site; slug: string }
  | { action: 'submit'; site: Site; slug: string; questionId: string; lang: string; code: string }
  | { action: 'check'; site: Site; submissionId: string }
  | {
      action: 'recover'
      site: Site
      slug: string
      questionId: string
      submissionId: string
      lang: string
      code: string
      submittedAt: number
    }
