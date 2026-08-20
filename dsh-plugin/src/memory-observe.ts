/**
 * Session observers for the memory system: per-turn prompt injection into
 * oac-* preset sessions (agent/pre-step waterfall, appended at the user-message
 * tail so the loop logs it and prefix caching survives), and post-turn
 * extraction + transcript mirroring (session/event feed, turn/end). Both are
 * best-effort: they never break a turn on failure.
 */
import { runMetabot } from './cli-bridge.js'
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import { slugFromPresetId } from './chip-logic.js'
import type {
  HostAgentLike,
  HostContext,
  HostPreStepDecision,
  HostPreStepPayload,
  HostSessionEventLike,
  HostSessionLike,
  HostTextBlock,
  HostUserMessage,
} from './context-types.js'

function textFromBlocks(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const candidate = block as { type?: unknown; text?: unknown }
      return candidate.type === 'text' && typeof candidate.text === 'string' ? candidate.text : ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function lastUserText(messages: HostUserMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      const text = textFromBlocks(message.content)
      if (text) return text
    }
  }
  return ''
}

function presetSlugForAgent(ctx: HostContext, agent: HostAgentLike): string | null {
  const preset = ctx.agentPresets?.composedPreset?.(agent.ctx)
  return preset ? (slugFromPresetId(preset) ?? null) : null
}

export interface MemoryObserveOptions {
  run?: RunFn
  injection?: boolean
  extraction?: boolean
}

/** Mount the per-turn memory injection (agent/pre-step, prepend so it composes). */
export function applyMemoryInjection(ctx: HostContext, options: MemoryObserveOptions = {}): void {
  if (!ctx.on) return
  const run = options.run ?? runMetabot
  ctx.on(
    'agent/pre-step',
    async (
      payload: HostPreStepPayload,
      next: () => Promise<HostPreStepDecision>,
    ): Promise<HostPreStepDecision> => {
      const decision = await next()
      if (decision.kind !== 'enter' || !Array.isArray(decision.messages)) {
        return decision
      }
      try {
        const slug = presetSlugForAgent(ctx, payload.agent)
        if (!slug) return decision
        const userText = lastUserText(decision.messages)
        const result = await runMetabotWithPayloadFile(
          ['memory', 'blocks', '--from', slug],
          { channel: 'dsh', userText },
          '--payload-file',
          [],
          run,
        )
        const xml = result.ok
          ? String((result.data as { xml?: unknown } | undefined)?.xml ?? '')
          : ''
        if (!xml.trim()) return decision
        const memoryMessage: HostUserMessage = {
          role: 'user',
          content: [{ type: 'text', text: xml } as HostTextBlock],
          source: {
            kind: 'plugin',
            plugin: 'oac-dsh',
            form: 'snapshot',
            sections: [{ name: 'oac:memory', text: xml }],
          },
        }
        return { kind: 'enter', messages: [...decision.messages, memoryMessage] }
      } catch {
        // Memory injection is an enhancement; a failure must not break the turn.
        return decision
      }
    },
    { prepend: true },
  )
}

/** Mount the post-turn observer: transcript mirroring + memory extraction. */
export function applyMemoryExtraction(ctx: HostContext, options: MemoryObserveOptions = {}): void {
  if (!ctx.on) return
  const run = options.run ?? runMetabot
  const presetBySession = new Map<string, string>()
  const queueBySession = new Map<string, Promise<unknown>>()

  const enqueue = (sessionId: string, task: () => Promise<unknown>): void => {
    const next = (queueBySession.get(sessionId) ?? Promise.resolve()).then(task, task)
    queueBySession.set(sessionId, next.catch(() => undefined))
  }

  ctx.on('session/event', (session: HostSessionLike & { id?: string }, event: HostSessionEventLike) => {
    try {
      const sessionId = typeof session?.id === 'string' ? session.id : ''
      if (!session || !event) return
      if (event.type === 'agent-preset/selected') {
        const agentPreset = (event.data as { agentPreset?: unknown } | undefined)?.agentPreset
        if (sessionId && typeof agentPreset === 'string') {
          presetBySession.set(sessionId, agentPreset)
        }
        return
      }
      if (event.type !== 'turn/end') return
      const reason = (event.data as { reason?: { kind?: unknown } } | undefined)?.reason
      if (reason?.kind !== 'completed') return

      const preset = (sessionId ? presetBySession.get(sessionId) : undefined)
        ?? session.header?.agentPreset
      const slug = preset ? slugFromPresetId(preset) : null
      if (!slug) return
      const turn = (event.data as { turn?: unknown } | undefined)?.turn

      // Slice the just-completed turn's user/assistant texts from the log.
      const events = Array.isArray(session.events) ? session.events : []
      let turnStart = -1
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const candidate = events[index]
        if (candidate?.type === 'turn/start'
          && (turn === undefined || (candidate.data as { turn?: unknown } | undefined)?.turn === turn)) {
          turnStart = index
          break
        }
      }
      const slice = turnStart >= 0 ? events.slice(turnStart) : events.slice(-4)
      const userTexts: string[] = []
      const assistantTexts: string[] = []
      for (const entry of slice) {
        if (entry?.type === 'user/message') {
          const data = entry.data as HostUserMessage | undefined
          if (data?.source?.kind === 'plugin') continue
          const text = textFromBlocks(data?.content)
          if (text) userTexts.push(text)
        } else if (entry?.type === 'assistant/message') {
          const data = entry.data as { message?: { content?: unknown } } | undefined
          const text = textFromBlocks(data?.message?.content)
          if (text) assistantTexts.push(text)
        }
      }
      const userText = userTexts.join('\n').trim()
      const assistantText = assistantTexts.join('\n').trim()
      if (!userText && !assistantText) return

      const capturedSessionId = sessionId || `dsh-${Date.now()}`
      enqueue(capturedSessionId, async () => {
        const ts = Date.now()
        if (userText) {
          await runMetabotWithPayloadFile(
            ['memory', 'transcript', 'append', '--from', slug],
            { sessionId: capturedSessionId, role: 'user', text: userText, ts, channel: 'dsh' },
            '--payload-file',
            [],
            run,
          ).catch(() => undefined)
        }
        if (assistantText) {
          await runMetabotWithPayloadFile(
            ['memory', 'transcript', 'append', '--from', slug],
            { sessionId: capturedSessionId, role: 'assistant', text: assistantText, ts: ts + 1, channel: 'dsh' },
            '--payload-file',
            [],
            run,
          ).catch(() => undefined)
        }
        if (userText) {
          await runMetabotWithPayloadFile(
            ['memory', 'extract', '--from', slug],
            {
              userText,
              assistantText,
              sessionId: capturedSessionId,
              channel: 'dsh',
            },
            '--payload-file',
            [],
            run,
          ).catch(() => undefined)
        }
      })
    } catch {
      // Observation must never throw into the session feed.
    }
  })
}
