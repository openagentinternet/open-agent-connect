/**
 * Group Task host routes: `/oac/api/grouptask/*` -> `metabot grouptask …`.
 * Same bridge pattern as memory-routes: a method dispatcher returning
 * undefined for non-grouptask methods so index.ts can chain dispatchers.
 */
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import {
  localGrouptaskCollabs,
  localGrouptaskDetail,
  localGrouptaskList,
  localGrouptaskMessages,
} from './local-read.js'

type RunMetabot = typeof runMetabot

export interface GroupTaskRouteDeps {
  run?: RunMetabot
}

const READ_TIMEOUT_MS = 60_000
/** Create/post/kick wait on chain writes + indexer polls; give them room. */
const WRITE_TIMEOUT_MS = 180_000

function payloadObject(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}
}

function readTrimmed(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readStringList(body: Record<string, unknown>, key: string): string[] {
  const value = body[key]
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry !== '')
}

function readInt(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key]
  const numeric = typeof value === 'string' ? Number(value) : value
  if (typeof numeric !== 'number' || !Number.isInteger(numeric)) return undefined
  return numeric
}

function failed(code: string, message: string): MetabotCommandResult {
  return { ok: false, state: 'failed', code, message }
}

function readTaskRef(body: Record<string, unknown>):
  | { chair: string; taskId: number }
  | MetabotCommandResult {
  const chair = readTrimmed(body, 'chair') || readTrimmed(body, 'chairSlug')
  if (!chair) return failed('missing_chair', 'chair is required')
  const taskId = readInt(body, 'taskId')
  if (taskId === undefined || taskId <= 0) return failed('missing_task_id', 'taskId must be a positive integer')
  return { chair, taskId }
}

function isFailure(value: { chair: string; taskId: number } | MetabotCommandResult): value is MetabotCommandResult {
  return 'ok' in value
}

/**
 * Dispatch a `grouptask/*` API method. Returns undefined when the method is
 * not a grouptask route (lets index.ts fall through to other dispatchers).
 */
export async function dispatchGroupTaskRoutes(
  method: string,
  payload: unknown,
  deps: GroupTaskRouteDeps = {},
): Promise<MetabotCommandResult | undefined> {
  if (!method.startsWith('grouptask/')) return undefined
  const run = deps.run ?? runMetabot
  const body = payloadObject(payload)

  if (method === 'grouptask/create') {
    const title = readTrimmed(body, 'title')
    if (!title) return failed('missing_title', 'title is required')
    const goal = readTrimmed(body, 'goal')
    if (!goal) return failed('missing_goal', 'goal is required')
    const args = ['grouptask', 'create', '--title', title, '--goal', goal]
    const acceptance = readTrimmed(body, 'acceptanceCriteria')
    if (acceptance) args.push('--acceptance', acceptance)
    const workers = readStringList(body, 'workerSlugs')
    if (workers.length > 0) args.push('--workers', workers.join(','))
    const chair = readTrimmed(body, 'chairSlug')
    if (chair) args.push('--chair', chair)
    return run(args, { timeoutMs: WRITE_TIMEOUT_MS })
  }

  if (method === 'grouptask/list') {
    const args = ['grouptask', 'list']
    const tab = readTrimmed(body, 'tab')
    if (tab) args.push('--tab', tab)
    if (body.includeArchived === true) args.push('--include-archived')
    // Store-only read; the daemon engine's 5s tick keeps the stores synced.
    const local = await localGrouptaskList(tab, body.includeArchived === true)
    if (local) return local
    return run(args, { timeoutMs: READ_TIMEOUT_MS })
  }

  if (method === 'grouptask/detail') {
    const ref = readTaskRef(body)
    if (isFailure(ref)) return ref
    const args = ['grouptask', 'detail', '--chair', ref.chair, '--task', String(ref.taskId)]
    const view = readTrimmed(body, 'view')
    if (view) args.push('--view', view)
    if (body.sync === false) args.push('--no-sync')
    if (body.sync !== true) {
      // Store-only read; the daemon engine's 5s tick keeps the stores synced.
      const local = await localGrouptaskDetail(ref.chair, ref.taskId, view)
      if (local) return local
    }
    return run(args, { timeoutMs: READ_TIMEOUT_MS })
  }

  if (method === 'grouptask/messages') {
    const ref = readTaskRef(body)
    if (isFailure(ref)) return ref
    const args = ['grouptask', 'messages', '--chair', ref.chair, '--task', String(ref.taskId)]
    const limit = readInt(body, 'limit')
    if (limit !== undefined) args.push('--limit', String(limit))
    const beforeIndex = readInt(body, 'beforeIndex')
    if (beforeIndex !== undefined) args.push('--before-index', String(beforeIndex))
    if (body.sync === false) args.push('--no-sync')
    if (body.sync !== true) {
      const local = await localGrouptaskMessages(ref.chair, ref.taskId, limit, beforeIndex)
      if (local) return local
    }
    return run(args, { timeoutMs: READ_TIMEOUT_MS })
  }

  if (method === 'grouptask/post') {
    const ref = readTaskRef(body)
    if (isFailure(ref)) return ref
    const content = readTrimmed(body, 'content')
    if (!content) return failed('missing_content', 'content is required')
    const args = ['grouptask', 'post', '--chair', ref.chair, '--task', String(ref.taskId), '--content', content]
    const asSlug = readTrimmed(body, 'asSlug')
    if (asSlug && body.asOwner === true) {
      return failed('conflicting_sender', 'asSlug and asOwner are mutually exclusive')
    }
    if (asSlug) args.push('--as', asSlug)
    if (body.asOwner === true) args.push('--as-owner')
    const replyPin = readTrimmed(body, 'replyPin')
    if (replyPin) args.push('--reply-pin', replyPin)
    const mention = readStringList(body, 'mention')
    if (mention.length > 0) args.push('--mention', mention.join(','))
    return run(args, { timeoutMs: WRITE_TIMEOUT_MS })
  }

  if (method === 'grouptask/close') {
    const ref = readTaskRef(body)
    if (isFailure(ref)) return ref
    const outcome = readTrimmed(body, 'outcome')
    if (outcome !== 'done' && outcome !== 'cancelled') {
      return failed('invalid_outcome', "outcome must be 'done' or 'cancelled'")
    }
    const args = ['grouptask', 'close', '--chair', ref.chair, '--task', String(ref.taskId), '--outcome', outcome]
    const rating = readInt(body, 'rating')
    if (rating !== undefined) args.push('--rating', String(rating))
    const comment = readTrimmed(body, 'ratingComment')
    if (comment) args.push('--comment', comment)
    const reason = readTrimmed(body, 'reason')
    if (reason) args.push('--reason', reason)
    return run(args, { timeoutMs: WRITE_TIMEOUT_MS })
  }

  if (method === 'grouptask/reopen') {
    const ref = readTaskRef(body)
    if (isFailure(ref)) return ref
    const args = ['grouptask', 'reopen', '--chair', ref.chair, '--task', String(ref.taskId)]
    const reason = readTrimmed(body, 'reason')
    if (reason) args.push('--reason', reason)
    return run(args, { timeoutMs: WRITE_TIMEOUT_MS })
  }

  if (method === 'grouptask/kick') {
    const ref = readTaskRef(body)
    if (isFailure(ref)) return ref
    const slug = readTrimmed(body, 'slug')
    const globalMetaId = readTrimmed(body, 'globalMetaId')
    if (!slug && !globalMetaId) {
      return failed('missing_member', 'slug or globalMetaId is required')
    }
    const args = ['grouptask', 'kick', '--chair', ref.chair, '--task', String(ref.taskId)]
    if (slug) args.push('--member', slug)
    else args.push('--global-metaid', globalMetaId)
    const reason = readTrimmed(body, 'reason')
    if (reason) args.push('--reason', reason)
    return run(args, { timeoutMs: WRITE_TIMEOUT_MS })
  }

  if (method === 'grouptask/member-status') {
    const ref = readTaskRef(body)
    if (isFailure(ref)) return ref
    const status = readTrimmed(body, 'status')
    if (!status) return failed('missing_status', 'status is required')
    const slug = readTrimmed(body, 'slug')
    const globalMetaId = readTrimmed(body, 'globalMetaId')
    if (!slug && !globalMetaId) {
      return failed('missing_member', 'slug or globalMetaId is required')
    }
    const args = ['grouptask', 'member-status', '--chair', ref.chair, '--task', String(ref.taskId), '--status', status]
    if (slug) args.push('--member', slug)
    else args.push('--global-metaid', globalMetaId)
    return run(args, { timeoutMs: READ_TIMEOUT_MS })
  }

  if (method === 'grouptask/rename') {
    const ref = readTaskRef(body)
    if (isFailure(ref)) return ref
    const displayName = typeof body.displayName === 'string' ? body.displayName : ''
    return run(
      ['grouptask', 'rename', '--chair', ref.chair, '--task', String(ref.taskId), '--name', displayName],
      { timeoutMs: READ_TIMEOUT_MS },
    )
  }

  if (method === 'grouptask/pin') {
    const ref = readTaskRef(body)
    if (isFailure(ref)) return ref
    const verb = body.pinned === false ? 'unpin' : 'pin'
    return run(
      ['grouptask', verb, '--chair', ref.chair, '--task', String(ref.taskId)],
      { timeoutMs: READ_TIMEOUT_MS },
    )
  }

  if (method === 'grouptask/archive') {
    const ref = readTaskRef(body)
    if (isFailure(ref)) return ref
    const verb = body.archived === false ? 'unarchive' : 'archive'
    return run(
      ['grouptask', verb, '--chair', ref.chair, '--task', String(ref.taskId)],
      { timeoutMs: READ_TIMEOUT_MS },
    )
  }

  if (method === 'grouptask/invite') {
    const ref = readTaskRef(body)
    if (isFailure(ref)) return ref
    const globalMetaId = readTrimmed(body, 'globalMetaId')
    if (!globalMetaId) return failed('missing_global_metaid', 'globalMetaId is required')
    const args = [
      'grouptask', 'invite',
      '--chair', ref.chair, '--task', String(ref.taskId),
      '--global-metaid', globalMetaId,
    ]
    const name = readTrimmed(body, 'name')
    if (name) args.push('--name', name)
    const skills = readStringList(body, 'requiredSkills')
    if (skills.length > 0) args.push('--skills', skills.join(','))
    if (body.allowReinvite === true) args.push('--allow-reinvite')
    return run(args, { timeoutMs: WRITE_TIMEOUT_MS })
  }

  if (method === 'grouptask/invites') {
    const ref = readTaskRef(body)
    if (isFailure(ref)) return ref
    return run(
      ['grouptask', 'invites', '--chair', ref.chair, '--task', String(ref.taskId)],
      { timeoutMs: READ_TIMEOUT_MS },
    )
  }

  if (method === 'grouptask/collabs') {
    const local = await localGrouptaskCollabs()
    if (local) return local
    return run(['grouptask', 'collabs'], { timeoutMs: READ_TIMEOUT_MS })
  }

  if (method === 'grouptask/collab-messages') {
    const slug = readTrimmed(body, 'slug')
    if (!slug) return failed('missing_slug', 'slug is required')
    const groupId = readTrimmed(body, 'groupId')
    if (!groupId) return failed('missing_group_id', 'groupId is required')
    const args = ['grouptask', 'collab-messages', '--bot', slug, '--group', groupId]
    const limit = readInt(body, 'limit')
    if (limit !== undefined) args.push('--limit', String(limit))
    return run(args, { timeoutMs: READ_TIMEOUT_MS })
  }

  if (method === 'grouptask/health') {
    return run(['grouptask', 'health'], { timeoutMs: READ_TIMEOUT_MS })
  }

  if (method === 'grouptask/staffing/propose') {
    const title = readTrimmed(body, 'title')
    if (!title) return failed('missing_title', 'title is required')
    const goal = readTrimmed(body, 'goal')
    if (!goal) return failed('missing_goal', 'goal is required')
    const planSource = typeof body.plan === 'string' ? body.plan : JSON.stringify(body.plan ?? {})
    if (!planSource || planSource === '{}') return failed('missing_plan', 'plan is required')
    const args = ['grouptask', 'staffing', 'propose', '--title', title, '--goal', goal, '--plan', planSource]
    const acceptance = readTrimmed(body, 'acceptanceCriteria')
    if (acceptance) args.push('--acceptance', acceptance)
    const wish = readTrimmed(body, 'triggeringWish')
    if (wish) args.push('--wish', wish)
    const session = readTrimmed(body, 'sourceSessionId')
    if (session) args.push('--session', session)
    const chair = readTrimmed(body, 'chairSlug')
    if (chair) args.push('--chair', chair)
    const language = readTrimmed(body, 'language')
    if (language) args.push('--lang', language)
    return run(args, { timeoutMs: READ_TIMEOUT_MS })
  }

  if (method === 'grouptask/staffing/list') {
    const args = ['grouptask', 'staffing', 'list']
    const chair = readTrimmed(body, 'chairSlug')
    if (chair) args.push('--chair', chair)
    return run(args, { timeoutMs: READ_TIMEOUT_MS })
  }

  if (method === 'grouptask/staffing/decide') {
    const chair = readTrimmed(body, 'chairSlug')
    if (!chair) return failed('missing_chair', 'chair is required')
    const proposalId = readInt(body, 'proposalId')
    if (proposalId === undefined || proposalId <= 0) {
      return failed('missing_proposal', 'proposalId must be a positive integer')
    }
    const decision = readTrimmed(body, 'decision')
    if (!['confirm', 'revise', 'skip'].includes(decision)) {
      return failed('invalid_decision', "decision must be 'confirm', 'revise', or 'skip'")
    }
    return run(
      ['grouptask', 'staffing', 'decide', '--chair', chair, '--proposal', String(proposalId), '--decision', decision],
      { timeoutMs: READ_TIMEOUT_MS },
    )
  }

  if (method === 'grouptask/staffing/create') {
    const proposalId = readInt(body, 'proposalId')
    if (proposalId === undefined || proposalId <= 0) {
      return failed('missing_proposal', 'proposalId must be a positive integer')
    }
    const args = ['grouptask', 'staffing', 'create', '--proposal', String(proposalId)]
    const chair = readTrimmed(body, 'chairSlug')
    if (chair) args.push('--chair', chair)
    return run(args, { timeoutMs: WRITE_TIMEOUT_MS })
  }

  if (method === 'grouptask/staffing/search') {
    const seat = readTrimmed(body, 'seat')
    const query = readTrimmed(body, 'query')
    if (!seat && !query) return failed('missing_query', 'seat or query is required')
    const args = ['grouptask', 'staffing', 'search']
    if (seat) args.push('--seat', seat)
    if (query) args.push('--query', query)
    const domain = readTrimmed(body, 'domainLabel')
    if (domain) args.push('--domain', domain)
    const skills = readStringList(body, 'skills')
    if (skills.length > 0) args.push('--skills', skills.join(','))
    const limit = readInt(body, 'limit')
    if (limit !== undefined) args.push('--limit', String(limit))
    return run(args, { timeoutMs: READ_TIMEOUT_MS })
  }

  return failed('not-found', `unknown grouptask API method "${method}"`)
}
