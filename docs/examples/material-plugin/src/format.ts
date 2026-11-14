import type {
  MaterialImportCandidate,
  MaterialTaskContext,
  MaterialTaskProgress,
} from '@repeaty/plugin-api'

const maximumBytes = 1024 * 1024
/** Self-contained so its compiled JavaScript can run in an SDK-owned worker. */
async function decodeStudyDocument(
  bytes: ArrayBuffer,
  progress: (value: MaterialTaskProgress) => void,
  yieldStep: () => Promise<void>,
): Promise<MaterialImportCandidate[]> {
  function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (
    !object(value) ||
    value.version !== 1 ||
    !Array.isArray(value.chapters) ||
    value.chapters.length < 1 ||
    value.chapters.length > 16
  )
    throw new Error('A version 1 study document must contain 1–16 chapters.')
  const seen = new Set<string>()
  const candidates: MaterialImportCandidate[] = []
  for (const chapter of value.chapters) {
    if (
      !object(chapter) ||
      typeof chapter.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(chapter.id) ||
      seen.has(chapter.id) ||
      typeof chapter.title !== 'string' ||
      !chapter.title.trim() ||
      chapter.title.length > 160 ||
      typeof chapter.body !== 'string' ||
      !chapter.body.trim() ||
      chapter.body.length > 250_000
    )
      throw new Error('Chapters need unique IDs, a title, and non-empty text.')
    seen.add(chapter.id)
    candidates.push({
      key: chapter.id,
      title: chapter.title.trim(),
      text: chapter.body.replace(/\r\n?/g, '\n'),
      format: 'plain',
      documentFormat: 'study-json',
      readerId: 'chapter',
    })
    progress({ completed: candidates.length, total: value.chapters.length })
    await yieldStep()
  }
  return candidates
}

/** A deliberately small example format. Parsing never writes learning or plugin data. */
export async function parseStudyDocument(
  file: File,
  context: MaterialTaskContext,
): Promise<MaterialImportCandidate[]> {
  context.signal.throwIfAborted()
  if (!file.name.toLowerCase().endsWith('.study.json') || file.size > maximumBytes)
    throw new Error('Choose a .study.json document of at most 1 MiB.')
  const bytes = await file.arrayBuffer()
  context.signal.throwIfAborted()
  // Node unit tests and older hosts can use this bounded, cooperative fallback.
  if (!context.createWorker)
    return decodeStudyDocument(
      bytes,
      (value) => context.progress(value),
      async () => {
        context.signal.throwIfAborted()
        await context.yield()
        context.signal.throwIfAborted()
      },
    )
  const worker = context.createWorker(
    `
    const decode = ${decodeStudyDocument.toString()};
    self.onmessage = async ({ data }) => {
      try {
        const candidates = await decode(data,
          value => self.postMessage({ type: 'progress', value }),
          () => new Promise(resolve => setTimeout(resolve, 0)));
        self.postMessage({ type: 'result', candidates });
      } catch (error) { self.postMessage({ type: 'error', message: String(error?.message ?? error) }); }
    };
    self.postMessage({ type: 'ready' });
  `,
    { name: 'repeaty-study-json-parser' },
  )
  return new Promise<MaterialImportCandidate[]>((resolve, reject) => {
    let settled = false
    function cleanup() {
      worker.removeEventListener('message', message)
      worker.removeEventListener('error', error)
      context.signal.removeEventListener('abort', abort)
    }
    function finish(value?: MaterialImportCandidate[], issue?: unknown) {
      if (settled) return
      settled = true
      cleanup()
      if (issue) reject(issue)
      else resolve(value!)
    }
    function abort() {
      finish(undefined, new DOMException('Import cancelled.', 'AbortError'))
    }
    function error(event: ErrorEvent) {
      event.preventDefault()
      finish(undefined, new Error(event.message || 'Study document worker failed.'))
    }
    function message(event: MessageEvent) {
      if (settled) return
      if (event.data?.type === 'progress') {
        try {
          context.progress(event.data.value)
        } catch (issue) {
          finish(undefined, issue)
        }
      } else if (event.data?.type === 'result') finish(event.data.candidates)
      else if (event.data?.type === 'error') finish(undefined, new Error(event.data.message))
    }
    context.onCleanup(cleanup)
    worker.addEventListener('message', message)
    worker.addEventListener('error', error)
    context.signal.addEventListener('abort', abort, { once: true })
    if (context.signal.aborted) {
      abort()
      return
    }
    try {
      worker.postMessage(bytes, [bytes])
    } catch (issue) {
      finish(undefined, issue)
    }
  })
}
