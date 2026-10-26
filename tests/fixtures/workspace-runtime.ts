// Browser regression tests use the real Rust store. Only OS dialogs/IPC delivery are simulated.
import { spawn, execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { join } from 'node:path'
let binary: string | undefined
export function workspaceRuntime(device: string) {
  if (!binary) {
    execFileSync(
      'cargo',
      [
        'build',
        '--locked',
        '--manifest-path',
        'crates/workspace-store/Cargo.toml',
        '--example',
        'workspace-runtime',
      ],
      { stdio: 'pipe' },
    )
    const meta = JSON.parse(
      execFileSync(
        'cargo',
        [
          'metadata',
          '--no-deps',
          '--format-version',
          '1',
          '--manifest-path',
          'crates/workspace-store/Cargo.toml',
        ],
        { encoding: 'utf8' },
      ),
    )
    binary = join(
      meta.target_directory,
      'debug/examples/workspace-runtime' + (process.platform === 'win32' ? '.exe' : ''),
    )
  }
  const child = spawn(binary, [device], { stdio: 'pipe' })
  let sequence = 0,
    error = ''
  child.stderr.on('data', (part) => (error += part))
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const response = JSON.parse(line),
      entry = pending.get(response.id)
    if (!entry) return
    pending.delete(response.id)
    if (response.error) entry.reject(new Error(response.error))
    else entry.resolve(response.value)
  })
  child.on('exit', () => {
    for (const entry of pending.values()) entry.reject(new Error('Native host exited: ' + error))
    pending.clear()
  })
  return {
    call<T = unknown>(command: string, args: Record<string, unknown> = {}) {
      return new Promise<T>((resolve, reject) => {
        const id = ++sequence
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
        child.stdin.write(JSON.stringify({ id, command, args }) + '\n')
      })
    },
    async close() {
      if (child.exitCode === null) {
        child.stdin.end()
        await once(child, 'exit')
      }
    },
  }
}
