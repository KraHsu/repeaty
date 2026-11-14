import {
  AssistantError,
  safeError,
  uid,
  type AssistantTools,
  type Message,
  type Provider,
  type ProviderMessage,
  type ProviderProfile,
  type Thread,
} from './model'
import { SessionStore } from './store'
import { selectContext } from './context'

export class ConversationController {
  private operation?: AbortController
  private alive = true
  constructor(
    readonly store: SessionStore,
    private provider: Provider,
    private tools: AssistantTools,
    private changed: () => void,
  ) {}
  get busy() {
    return !!this.operation
  }
  cancel() {
    this.operation?.abort()
  }
  dispose() {
    this.alive = false
    this.cancel()
  }
  private notify() {
    if (this.alive) this.changed()
  }

  async send(thread: Thread, profile: ProviderProfile): Promise<void> {
    if (
      this.busy ||
      !this.alive ||
      thread.status !== 'active' ||
      (!thread.draft.trim() && !thread.draftImages.length)
    )
      return
    const controller = new AbortController()
    this.operation = controller
    const signal = controller.signal
    const draft = thread.draft
    const images = [...thread.draftImages]
    const user: Message = {
      id: uid(),
      role: 'user',
      text: draft.trim(),
      images,
      createdAt: new Date().toISOString(),
    }
    let assistant: Message | undefined
    let accepted = false
    thread.error = undefined
    this.notify()
    try {
      thread.messages.push(user)
      thread.title ||= draft.trim().slice(0, 60) || images[0]?.name || ''
      thread.updatedAt = new Date().toISOString()
      await this.store.save(thread)
      signal.throwIfAborted()
      accepted = true
      thread.draft = ''
      thread.draftImages = []
      const callIds = new Set<string>()
      for (let round = 0; round < 24; round++) {
        signal.throwIfAborted()
        // Complete tool-call/result pairs are retained; never cut a protocol message in half.
        const selection = selectContext(thread.messages)
        thread.contextUsage = selection.usage
        const history: ProviderMessage[] = []
        for (const message of selection.messages) {
          history.push({
            ...message,
            images: message.images
              ? await Promise.all(message.images.map((image) => this.store.image(image)))
              : undefined,
          })
        }
        assistant = {
          id: uid(),
          role: 'assistant',
          text: '',
          createdAt: new Date().toISOString(),
          status: 'running',
        }
        thread.messages.push(assistant)
        this.notify()
        const current = assistant
        const execute = async (call: import('./model').ToolCall) => {
          signal.throwIfAborted()
          if (!call.id || callIds.has(call.id)) throw new AssistantError('protocol')
          callIds.add(call.id)
          if (!this.tools.definitions.some((tool) => tool.name === call.name))
            throw new AssistantError('scope')
          const result = await this.tools.execute(call, thread.context, signal)
          signal.throwIfAborted()
          if (result.proposal) (current.proposals ??= []).push(result.proposal)
          if (!current.toolCalls?.some((item) => item.id === call.id))
            (current.toolCalls ??= []).push(call)
          thread.messages.push({
            id: uid(),
            role: 'tool',
            toolCallId: call.id,
            text: JSON.stringify(result.result),
            createdAt: new Date().toISOString(),
          })
          await this.store.save(thread)
          this.notify()
          return result.result
        }
        let checkpoint = Date.now()
        let persistenceError: unknown
        const reply = await this.provider.complete(
          {
            requestId: uid(),
            profile,
            threadId: thread.providerThreadId,
            messages: history,
            tools: this.tools.definitions,
            context: thread.context,
            signal,
            contextNotice: selection.notice,
            handleTool: execute,
          },
          (event) => {
            if (signal.aborted || !this.alive) return
            if (event.type === 'delta') current.text += event.text
            if (event.type === 'thread') thread.providerThreadId = event.threadId
            if (Date.now() - checkpoint > 1500) {
              checkpoint = Date.now()
              void this.store.save(thread).catch((error) => {
                persistenceError = error
                controller.abort()
              })
            }
            this.notify()
          },
        )
        if (persistenceError) throw persistenceError
        signal.throwIfAborted()
        current.text = reply.text || current.text
        current.toolCalls = [
          ...(current.toolCalls ?? []),
          ...reply.toolCalls.filter(
            (call) => !current.toolCalls?.some((existing) => existing.id === call.id),
          ),
        ]
        current.status = 'complete'
        thread.providerThreadId = reply.threadId ?? thread.providerThreadId
        await this.store.save(thread)
        if (!reply.toolCalls.length) break
        for (const call of reply.toolCalls) {
          await execute(call)
        }
        if (round === 23) throw new AssistantError('tool-limit')
      }
    } catch (error) {
      thread.error = signal.aborted ? 'interrupted' : safeError(error)
      if (assistant) assistant.status = signal.aborted ? 'interrupted' : 'failed'
      // Keep the submitted draft available after interruption/failure. Never overwrite newer text.
      if (!thread.draft) thread.draft = draft
      if (!thread.draftImages.length) thread.draftImages = images
      if (!accepted) thread.messages = thread.messages.filter((message) => message.id !== user.id)
    } finally {
      thread.updatedAt = new Date().toISOString()
      try {
        await this.store.save(thread)
      } catch {
        thread.error = 'storage'
      }
      if (this.operation === controller) this.operation = undefined
      this.notify()
    }
  }

  async apply(thread: Thread, message: Message, proposalId: string): Promise<void> {
    const proposal = message.proposals?.find((item) => item.id === proposalId)
    if (!proposal || !['pending', 'failed'].includes(proposal.status) || this.busy || !this.alive)
      return
    proposal.error = undefined
    const controller = new AbortController()
    this.operation = controller
    this.notify()
    try {
      proposal.receipt = await this.tools.apply(proposal, thread.context, controller.signal)
      proposal.status = 'applied'
    } catch (error) {
      proposal.status = 'failed'
      proposal.error = safeError(error)
    } finally {
      try {
        await this.store.save(thread)
      } catch {
        thread.error = 'storage'
      }
      if (this.operation === controller) this.operation = undefined
      this.notify()
    }
  }
}
