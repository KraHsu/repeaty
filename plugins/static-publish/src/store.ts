import { emptyIndex, limits, validPath, type SiteBuild, type SiteIndex } from './model'
export interface StorePort {
  get(id: string): Promise<unknown>
  set(id: string, value: unknown | undefined): Promise<void>
}
interface StoredBuild extends Omit<SiteBuild, 'files'> {
  files: { path: string; type: string; parts: string[]; size: number }[]
}
export interface SiteState {
  version: 1
  selected: string[]
  index: SiteIndex
  build?: StoredBuild
}
const blank = (): SiteState => ({ version: 1, selected: [], index: emptyIndex() })
const base64 = (bytes: Uint8Array) => {
  let result = ''
  for (let i = 0; i < bytes.length; i += 16_384)
    result += String.fromCharCode(...bytes.subarray(i, i + 16_384))
  return btoa(result)
}
export class SiteStore {
  constructor(private port: StorePort) {}
  async state(): Promise<SiteState> {
    const value = (await this.port.get('site-state-v1')) as SiteState | undefined
    if (value === undefined || value === null) return blank()
    if (
      value.version !== 1 ||
      !Array.isArray(value.selected) ||
      !value.selected.every((id) => typeof id === 'string') ||
      !value.index ||
      value.index.version !== 1 ||
      !Array.isArray(value.index.bindings)
    )
      throw new Error('发布记录无法读取，未重置原数据。')
    return value
  }
  async read(): Promise<{ state: SiteState; build?: SiteBuild }> {
    const state = await this.state()
    if (!state.build) return { state }
    if (!Array.isArray(state.build.files) || state.build.files.length > limits.files)
      throw new Error('已生成站点的记录无效。')
    let total = 0
    const files = []
    for (const item of state.build.files) {
      if (
        !validPath(item.path) ||
        item.size > limits.fileBytes ||
        !Array.isArray(item.parts) ||
        item.parts.length > 20 ||
        item.parts.some((id) => !/^site-[\w-]{1,100}$/u.test(id))
      )
        throw new Error('已生成站点的文件记录无效。')
      const chunks: Uint8Array[] = []
      for (const part of item.parts) {
        const value = await this.port.get(part)
        if (typeof value !== 'string' || value.length > 800_000)
          throw new Error('已生成站点不完整，请重新生成。')
        chunks.push(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)))
      }
      const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      total += length
      if (length !== item.size || total > limits.totalBytes)
        throw new Error('已生成站点大小不匹配。')
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      files.push({ path: item.path, type: item.type, bytes })
    }
    return { state, build: { ...state.build, files } }
  }
  async save(build: SiteBuild, selected: string[], check: () => void) {
    const old = await this.state()
    const run = crypto.randomUUID()
    const files: StoredBuild['files'] = []
    const written: string[] = []
    let committed = false
    try {
      for (const [number, item] of build.files.entries()) {
        const parts = []
        for (let offset = 0, i = 0; offset < item.bytes.length; offset += 512 * 1024, i++) {
          check()
          const id = `site-${run}-${number}-${i}`
          await this.port.set(id, base64(item.bytes.subarray(offset, offset + 512 * 1024)))
          written.push(id)
          parts.push(id)
        }
        files.push({ path: item.path, type: item.type, parts, size: item.bytes.length })
      }
      check()
      await this.port.set('site-state-v1', {
        version: 1,
        selected: [...selected],
        index: build.index,
        build: { ...build, files },
      } satisfies SiteState)
      committed = true
    } finally {
      // Immutable files are published by the final pointer only. Failed writes keep the old site.
      const garbage = committed ? (old.build?.files.flatMap((item) => item.parts) ?? []) : written
      for (const id of garbage)
        try {
          await this.port.set(id, undefined)
        } catch {
          /* Orphan chunks never enter exports. */
        }
    }
  }
}
