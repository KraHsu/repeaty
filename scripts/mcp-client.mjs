// A real JSON-RPC stdio client for the desktop smoke and native integration tests.
import { spawn } from 'node:child_process'

export async function startMcpClient(configuration, options = {}) {
  const child = spawn(configuration.command, configuration.args, {
    env: options.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const pending = new Map()
  let sequence = 0,
    buffer = '',
    failure
  const fail = (error) => {
    failure ??= error
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    child.kill()
  }
  // Do not log stderr: connection errors must not accidentally disclose credentials.
  child.stderr.resume()
  child.on('error', fail)
  child.stdin.on('error', fail)
  const closed = new Promise((resolve) => {
    child.on('close', (code, signal) => {
      for (const request of pending.values()) request.reject(new Error('MCP process closed'))
      pending.clear()
      resolve({ code, signal })
    })
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    if (buffer.length > 8 * 1024 * 1024) return fail(new Error('MCP frame exceeds test limit'))
    let end
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      if (!line.trim()) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return fail(new Error('MCP stdout contains a non-protocol message'))
      }
      const request = pending.get(message.id)
      if (request) {
        pending.delete(message.id)
        if (message.error) request.reject(new Error(`MCP protocol error ${message.error.code}`))
        else request.resolve(message.result)
      }
    }
  })
  const send = (message) => {
    if (failure) throw failure
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
  }
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MCP request timed out: ${method}`))
      }, 15000)
      const finish = (operation) => (value) => {
        clearTimeout(timer)
        operation(value)
      }
      pending.set(id, { resolve: finish(resolve), reject: finish(reject) })
      try {
        send({ id, method, params })
      } catch (error) {
        pending.delete(id)
        clearTimeout(timer)
        reject(error)
      }
    })
  const client = {
    child,
    closed,
    request,
    call: (name, args = {}) => request('tools/call', { name, arguments: args }),
    listTools: () => request('tools/list'),
    async close() {
      child.stdin.end()
      let timer
      try {
        const result = await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              child.kill()
              reject(new Error('MCP process did not exit after stdin EOF'))
            }, 10000)
          }),
        ])
        if (failure) throw failure
        if (result.code !== 0) throw new Error(`MCP exited with status ${result.code}`)
      } finally {
        clearTimeout(timer)
      }
    },
  }
  try {
    client.info = await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'repeaty-test-client', version: '1' },
    })
    send({ method: 'notifications/initialized' })
    return client
  } catch (error) {
    child.stdin.end()
    child.kill()
    throw error
  }
}
