import { z } from 'zod'
export const inlineMediaSchema = z
  .array(
    z.object({
      url: z.string().min(1).max(2048),
      path: z
        .string()
        .min(1)
        .max(1024)
        .regex(/^assets\//),
      mediaId: z.string().min(1).max(150),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  )
  .max(64)
export type InlineMedia = z.infer<typeof inlineMediaSchema>
