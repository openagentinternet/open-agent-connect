/**
 * Remote-content session guard: sessions whose prompt is driven by untrusted
 * remote parties (A2A private-chat replies, group-task worker turns reading
 * the on-chain group log) must never run tools that expose local or private
 * data — the tool result would flow back to the remote peer as the reply /
 * on-chain group message, a direct exfiltration channel for prompt
 * injection. The guard marks such agents at creation time and wraps the
 * sensitive tool definitions so they refuse to execute for those agents.
 *
 * Marking is execution-time (a WeakSet on the agent object), so it protects
 * tools regardless of whether they were registered globally or per-agent.
 */
import type { HostAgentLike, HostToolDefinition } from './context-types.js'

const remoteContentAgents = new WeakSet<object>()

export function markRemoteContentAgent(agent: HostAgentLike): void {
  remoteContentAgents.add(agent)
}

export function unmarkRemoteContentAgent(agent: HostAgentLike): void {
  remoteContentAgents.delete(agent)
}

export function isRemoteContentAgent(agent: unknown): boolean {
  return typeof agent === 'object' && agent !== null && remoteContentAgents.has(agent as object)
}

/**
 * Tools gated by `withRemoteContentGuard`: each reads local/private data —
 * the user's live browser state, arbitrary local files uploaded to the media
 * relay, the Bot's knowledge base / memory / study / surf / chain history,
 * other local sessions, or cross-session worker control — and the tool
 * result would be sent back to the remote party verbatim.
 */
const GATED_TOOL_NAMES: ReadonlySet<string> = new Set([
  // Global browser tools: the user's live browser state.
  'bot_browser_tabs',
  'bot_browser_open_uri',
  'bot_browser_preview_local',
  'bot_browser_read_page',
  'bot_browser_fork_current_app',
  // Media description: arbitrary local files uploaded to the relay.
  'describe_image',
  'describe_video',
  'describe_audio',
  // Knowledge base / procedures / study jobs.
  'knowledge_base_list',
  'knowledge_base_query',
  'procedure_recall',
  'metaweb_study_status',
  // Surf run history.
  'metaweb_surf_status',
  // Memory family (global layer AND the per-agent installs).
  'knowledge_recall',
  'knowledge_upsert',
  'memory_user_edits',
  'experience_recall',
  'recent_chats',
  'conversation_search',
  // Cross-session reads: any local Bot's session transcripts.
  'oac_session_read_all',
  'oac_session_read_latest',
  // Own chain read/write history.
  'chain_history_recall',
  // Twin/orchestration family: cross-session control and local worker data.
  'local_workers_list',
  'local_worker_delegate',
  'twin_task_reassign',
  'twin_task_status',
  'twin_task_cancel',
  'worker_session_stop',
  'oac_session_insert_user_message',
  // Group-task management from a remote-driven seat could spend the Bot's
  // chain resources; workers speak through their own group_chat tool.
  'group_task',
])

/**
 * Wrap one tool definition so it refuses to run for a remote-content agent.
 * Ungated tools pass through unchanged. Registration-time wrapping (instead
 * of an in-tool check) keeps the policy in one place.
 */
export function withRemoteContentGuard(definition: HostToolDefinition): HostToolDefinition {
  if (!GATED_TOOL_NAMES.has(definition.name)) return definition
  return {
    ...definition,
    execute: async (args, exec) => {
      if (isRemoteContentAgent(exec?.agent)) {
        return `${definition.name} is not available while answering remote-driven content (a chat peer or group task): it reads local/private data and the output would be disclosed to the remote party. Work from the task or conversation content instead.`
      }
      return definition.execute(args, exec)
    },
  }
}
