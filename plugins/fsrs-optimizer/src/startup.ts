interface StartupController {
  start(): Promise<void>
  state: { value: unknown }
  error: { value: unknown }
}

/** Activation and workspace hydration finish separately; never read before publication. */
export function scheduleStartup(controller: StartupController): () => void {
  let disposed = false
  let delay = 250
  let timer: ReturnType<typeof setTimeout>
  async function attempt() {
    if (disposed) return
    await controller.start()
    if (disposed || controller.state.value) return
    const reason = controller.error.value
    if (
      !(reason instanceof Error) ||
      !['study-service-unavailable', 'stale-workspace-session'].includes(reason.message)
    )
      return
    timer = setTimeout(() => void attempt(), delay)
    delay = Math.min(delay * 2, 30_000)
  }
  timer = setTimeout(() => void attempt(), 0)
  return () => {
    disposed = true
    clearTimeout(timer)
  }
}
