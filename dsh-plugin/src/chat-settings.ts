/**
 * Chat Settings host helpers: the skills catalog and the auto-reply config,
 * both surfaced through the same metabot CLI the rest of the plugin uses.
 * The data source is identical to the OAC `/ui/bots` chat settings tab:
 * `services skills` reads the platform skill catalog, auto-reply reads and
 * writes the daemon's `/api/chat/auto-reply/*` routes.
 */
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'

export function listChatSkills(from: string): Promise<MetabotCommandResult> {
  return runMetabot(['services', 'skills', '--from', from])
}

export function getAutoReplyStatus(from: string): Promise<MetabotCommandResult> {
  return runMetabot(['chat', 'auto-reply', 'status', '--from', from])
}

export function setAutoReplyConfig(input: {
  from: string
  enabled?: boolean
  maxTurns?: number
  cooldownMs?: number
}): Promise<MetabotCommandResult> {
  const args = ['chat', 'auto-reply', 'config', '--from', input.from]
  if (typeof input.enabled === 'boolean') args.push('--enabled', input.enabled ? 'true' : 'false')
  if (typeof input.maxTurns === 'number') args.push('--max-turns', String(input.maxTurns))
  if (typeof input.cooldownMs === 'number') args.push('--cooldown-ms', String(input.cooldownMs))
  return runMetabot(args)
}
