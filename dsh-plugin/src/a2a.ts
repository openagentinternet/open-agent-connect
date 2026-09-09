/**
 * A2A conversation host helpers: the same daemon data the OAC `/ui/conversations`
 * page reads, reached through the metabot CLI (`conversations` command group).
 */
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'

export function listConversations(local: string): Promise<MetabotCommandResult> {
  return runMetabot(['conversations', 'list', '--local', local])
}

export function getConversationMessages(local: string, peer: string): Promise<MetabotCommandResult> {
  return runMetabot(['conversations', 'messages', '--local', local, '--peer', peer])
}

export function runConversationGuidance(
  local: string,
  peer: string,
  guidance: string,
): Promise<MetabotCommandResult> {
  return runMetabot(['conversations', 'guidance', '--local', local, '--peer', peer, '--guidance', guidance])
}

export interface ConversationMetaPatch {
  pinned?: boolean
  archived?: boolean
  /** Empty string clears the rename override. */
  displayName?: string | null
}

/** UI-meta writes (pin/archive/rename) via the `metabot conversations` verbs. */
export function runConversationMeta(
  local: string,
  peer: string,
  patch: ConversationMetaPatch,
): Promise<MetabotCommandResult> {
  if (patch.displayName !== undefined) {
    return runMetabot(['conversations', 'rename', '--local', local, '--peer', peer, '--name', patch.displayName ?? ''])
  }
  if (patch.pinned !== undefined) {
    const verb = patch.pinned ? 'pin' : 'unpin'
    return runMetabot(['conversations', verb, '--local', local, '--peer', peer])
  }
  const verb = patch.archived === false ? 'unarchive' : 'archive'
  return runMetabot(['conversations', verb, '--local', local, '--peer', peer])
}
