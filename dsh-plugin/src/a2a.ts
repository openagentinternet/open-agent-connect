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
