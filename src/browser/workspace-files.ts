import { WorkspaceReadError } from './errors'

// Deliberately exposes no write, create, rename, or remove API.
export interface ReadFileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
}
export interface ReadDirectoryHandle {
  kind: 'directory'
  name: string
  values(): AsyncIterable<ReadDirectoryHandle | ReadFileHandle>
  getFileHandle(name: string): Promise<ReadFileHandle>
  getDirectoryHandle(name: string): Promise<ReadDirectoryHandle>
}
export type WorkspaceSelection =
  { kind: 'directory'; handle: ReadDirectoryHandle } | { kind: 'files'; files: File[] }

export const MAX_DATABASE_BYTES = 256 * 1024 * 1024
const MAX_FILES = 100_000
const databasePath = '.repeaty/state.sqlite3'
const requiredPaths = ['workspace.json', databasePath]
const journals = [databasePath + '-wal', databasePath + '-journal']
const acceptedPath =
  /^(?:workspace\.json|\.repeaty\/state\.sqlite3(?:-wal|-journal)?|\.repeaty\/objects\/[a-f0-9]{64}|\.repeaty\/media\/[a-f0-9]{64}\.[a-z0-9]+)$/

export async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}
async function optionalFile(directory: ReadDirectoryHandle, name: string) {
  try {
    return await (await directory.getFileHandle(name)).getFile()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return undefined
    throw error
  }
}

/** File objects pin the selection; immutable media is additionally verified by its hash. */
export async function collectWorkspaceFiles(selection: WorkspaceSelection) {
  const files = new Map<string, File>()
  let name: string
  let root: ReadDirectoryHandle | undefined
  let privateDirectory: ReadDirectoryHandle | undefined
  function add(path: string, file: File) {
    if (!acceptedPath.test(path)) return
    if (files.has(path)) throw new WorkspaceReadError('invalid')
    if (files.size >= MAX_FILES) throw new WorkspaceReadError('limit')
    files.set(path, file)
  }
  if (selection.kind === 'directory') {
    root = selection.handle
    name = root.name
    try {
      add('workspace.json', await (await root.getFileHandle('workspace.json')).getFile())
      privateDirectory = await root.getDirectoryHandle('.repeaty')
      for (const leaf of ['state.sqlite3', 'state.sqlite3-wal', 'state.sqlite3-journal']) {
        const file = await optionalFile(privateDirectory, leaf)
        if (file) add('.repeaty/' + leaf, file)
      }
      for (const leaf of ['objects', 'media']) {
        const directory = await privateDirectory.getDirectoryHandle(leaf)
        let count = 0
        for await (const entry of directory.values()) {
          if (++count > MAX_FILES) throw new WorkspaceReadError('limit')
          if (entry.kind === 'file' && acceptedPath.test(`.repeaty/${leaf}/${entry.name}`))
            add(`.repeaty/${leaf}/${entry.name}`, await entry.getFile())
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError')
        throw new WorkspaceReadError('missing')
      throw error
    }
  } else {
    if (!selection.files.length) throw new WorkspaceReadError('missing')
    if (selection.files.length > MAX_FILES) throw new WorkspaceReadError('limit')
    name = selection.files[0]!.webkitRelativePath.split('/')[0] ?? ''
    if (!name || name === '.' || name === '..') throw new WorkspaceReadError('missing')
    for (const file of selection.files) {
      const parts = file.webkitRelativePath.split('/')
      if (
        parts.shift() !== name ||
        parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))
      )
        throw new WorkspaceReadError('invalid')
      add(parts.join('/'), file)
    }
  }
  if (requiredPaths.some((path) => !files.has(path))) throw new WorkspaceReadError('missing')
  if (journals.some((path) => (files.get(path)?.size ?? 0) > 0))
    throw new WorkspaceReadError('incomplete')
  const baselines = new Map<string, string>()
  return {
    name,
    has: (path: string) => files.has(path),
    size: (path: string) => files.get(path)?.size,
    async read(path: string, limit: number, hash?: string) {
      const file = files.get(path)
      if (!file) throw new WorkspaceReadError('missing')
      if (!file.size || file.size > limit) throw new WorkspaceReadError('limit')
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (bytes.length !== file.size) throw new WorkspaceReadError('changed')
      const actual = await digest(bytes)
      if (hash && actual !== hash) throw new WorkspaceReadError('invalid')
      if (requiredPaths.includes(path)) baselines.set(path, actual)
      return bytes
    },
    async verify() {
      if (privateDirectory)
        for (const path of journals) {
          const file = await optionalFile(privateDirectory, path.slice('.repeaty/'.length))
          if (file?.size) throw new WorkspaceReadError('changed')
        }
      for (const path of requiredPaths) {
        const selected = files.get(path)!
        const file = root
          ? path === 'workspace.json'
            ? await (await root.getFileHandle(path)).getFile()
            : await (await privateDirectory!.getFileHandle('state.sqlite3')).getFile()
          : selected
        if (
          file.size !== selected.size ||
          file.lastModified !== selected.lastModified ||
          (await digest(new Uint8Array(await file.arrayBuffer()))) !== baselines.get(path)
        )
          throw new WorkspaceReadError('changed')
      }
    },
  }
}
export type WorkspaceFiles = Awaited<ReturnType<typeof collectWorkspaceFiles>>
