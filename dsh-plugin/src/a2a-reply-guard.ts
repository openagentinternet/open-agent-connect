/**
 * Remote-chat (A2A private chat) reply sessions run on behalf of a remote
 * peer whose message text is untrusted input. A tool that exposes local or
 * private data must never run inside such a session: its output flows back
 * to the remote peer as the chat reply, which is a direct exfiltration
 * channel for prompt injection. The guard marks the ephemeral reply agents
 * at creation time and wraps the sensitive tool definitions so they refuse
 * to execute for those agents.
 */
import type { HostAgentLike, HostToolDefinition } from './context-types.js'

const a2aReplyAgents = new WeakSet<object>()

export function markA2aReplyAgent(agent: HostAgentLike): void {
  a2aReplyAgents.add(agent)
}

export function unmarkA2aReplyAgent(agent: HostAgentLike): void {
  a2aReplyAgents.delete(agent)
}

export function isA2aReplyAgent(agent: unknown): boolean {
  return typeof agent === 'object' && agent !== null && a2aReplyAgents.has(agent as object)
}

/**
 * Tools gated by `withA2aReplyGuard`: each reads local/private data — the
 * user's live browser state, arbitrary local files uploaded to the media
 * relay, the Bot's knowledge base / memory / study / surf history — and the
 * tool result would be sent back to the remote peer verbatim.
 */
const GATED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'bot_browser_tabs',
  'bot_browser_open_uri',
  'bot_browser_preview_local',
  'bot_browser_read_page',
  'bot_browser_fork_current_app',
  'describe_image',
  'describe_video',
  'describe_audio',
  'knowledge_base_list',
  'knowledge_base_query',
  'procedure_recall',
  'metaweb_study_status',
  'metaweb_surf_status',
  'knowledge_recall',
])

/**
 * Wrap one tool definition so it refuses to run for a remote-chat reply
 * agent. Ungated tools pass through unchanged. Registration-time wrapping
 * (instead of an in-tool check) keeps the policy in one place.
 */
export function withA2aReplyGuard(definition: HostToolDefinition): HostToolDefinition {
  if (!GATED_TOOL_NAMES.has(definition.name)) return definition
  return {
    ...definition,
    execute: async (args, exec) => {
      if (isA2aReplyAgent(exec?.agent)) {
        return `${definition.name} is not available while replying to a remote chat peer: it reads local/private data and the reply would disclose it. Answer from the conversation instead.`
      }
      return definition.execute(args, exec)
    },
  }
}
