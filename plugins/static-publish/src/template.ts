import { Liquid, LiquidError, type FS } from 'liquidjs'
import { encoder, limits } from './model'
const denied: FS = {
  exists: async () => false,
  existsSync: () => false,
  readFile: async () => {
    throw new Error('模板不能读取外部文件。')
  },
  readFileSync: () => {
    throw new Error('模板不能读取外部文件。')
  },
  resolve: (_directory, filename) => filename,
  contains: async () => false,
  containsSync: () => false,
}
export function renderTemplate(input: string, scope: Record<string, unknown>, name: string) {
  if (encoder.encode(input).length > limits.themeBytes) throw new Error(`${name} 超过 256 KiB。`)
  if (/\{%[-\s]*(?:include|render|layout|extends|import)\b/iu.test(input))
    throw new Error(`${name} 不支持引入文件或其他模板。`)
  const engine = new Liquid({
    fs: denied,
    ownPropertyOnly: true,
    strictVariables: true,
    strictFilters: true,
    outputEscape: 'escape',
    dynamicPartials: false,
    relativeReference: false,
    parseLimit: limits.themeBytes,
    renderLimit: 1000,
    memoryLimit: 16 * 1024 * 1024,
  })
  try {
    const result = String(engine.parseAndRenderSync(input, scope))
    if (encoder.encode(result).length > limits.fileBytes)
      throw new Error(`${name} 生成的页面超过 8 MiB。`)
    return result
  } catch (error) {
    if (LiquidError.is(error)) {
      const [line, column] = error.token.getPosition()
      throw new Error(
        `${name} 第 ${line} 行、第 ${column} 列：${error.originalError?.message ?? error.message}`,
      )
    }
    throw error
  }
}
