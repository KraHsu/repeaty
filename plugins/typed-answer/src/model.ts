import { z } from 'zod'
export const dataSchema = z.object({ answer: z.string().trim().min(1).max(1000) })
export function matches(answer: string, expected: string) {
  return answer.trim().normalize('NFC').toLowerCase() === expected.normalize('NFC').toLowerCase()
}
