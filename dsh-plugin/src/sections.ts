/**
 * CLI-backed Conversations / Services / Apps routes. Mutations that write
 * chain data require an explicit `confirm: true` from the UI. Paid service
 * calls may first return `awaiting_confirmation`; a second call with
 * `confirm: true` sets `confirmed` on the CLI request.
 */
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import {
  isConfirmed,
  missing,
  readFrom,
  readTrimmed,
  requireConfirm,
  requireFrom,
  runMetabotWithPayloadFile,
  type RunFn,
} from './cli-payload.js'
import { normalizeTrafficApiBase } from './traffic.js'

const LIST_TIMEOUT_MS = 30_000
/** Account creation + binding + redeem sign and hit the assist service. */
const TRAFFIC_MUTATION_TIMEOUT_MS = 60_000

function objectOf(payload: unknown, key: string): Record<string, unknown> | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const value = (payload as Record<string, unknown>)[key]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

async function handleChatPrivate(payload: unknown, run: RunFn): Promise<MetabotCommandResult> {
  const from = requireFrom(payload)
  if (typeof from !== 'string') return from
  const to = readTrimmed(payload, 'to')
  const content = readTrimmed(payload, 'content')
  if (!to) return missing('missing_to', 'to is required')
  if (!content) return missing('missing_content', 'content is required')
  return runMetabotWithPayloadFile(
    ['chat', 'private', '--from', from],
    { to, content },
    '--request-file',
    [],
    run,
  )
}

async function handleServicesPublish(payload: unknown, run: RunFn): Promise<MetabotCommandResult> {
  const blocked = requireConfirm(payload, 'metabot services publish requires confirm.')
  if (blocked) return blocked
  const from = requireFrom(payload)
  if (typeof from !== 'string') return from
  const body = objectOf(payload, 'payload')
  if (body === undefined) return missing('missing_payload', 'payload is required')
  return runMetabotWithPayloadFile(['services', 'publish', '--from', from], body, '--payload-file', [], run)
}

async function handleServicesRevoke(payload: unknown, run: RunFn): Promise<MetabotCommandResult> {
  const blocked = requireConfirm(payload, 'metabot services owned revoke requires confirm.')
  if (blocked) return blocked
  const from = requireFrom(payload)
  if (typeof from !== 'string') return from
  const serviceId = readTrimmed(payload, 'serviceId')
  if (!serviceId) return missing('missing_service_id', 'serviceId is required')
  return run(
    ['services', 'owned', 'revoke', '--from', from, '--service-id', serviceId],
    { timeoutMs: 60_000 },
  )
}

async function handleServicesCall(payload: unknown, run: RunFn): Promise<MetabotCommandResult> {
  const from = requireFrom(payload)
  if (typeof from !== 'string') return from
  const request = objectOf(payload, 'request')
  if (request === undefined) return missing('missing_request', 'request is required')
  const body = isConfirmed(payload) ? { ...request, confirmed: true } : { ...request }
  return runMetabotWithPayloadFile(
    ['services', 'call', '--from', from],
    body,
    '--request-file',
    [],
    run,
  )
}

async function handleMetaappPublish(payload: unknown, run: RunFn): Promise<MetabotCommandResult> {
  const blocked = requireConfirm(payload, 'metabot metaapp publish requires --confirm.')
  if (blocked) return blocked
  const from = requireFrom(payload)
  if (typeof from !== 'string') return from
  const body = objectOf(payload, 'payload')
  if (body === undefined) return missing('missing_payload', 'payload is required')
  return runMetabotWithPayloadFile(
    ['metaapp', 'publish', '--from', from],
    body,
    '--payload-file',
    ['--confirm'],
    run,
  )
}

async function handleMetaappDelete(payload: unknown, run: RunFn): Promise<MetabotCommandResult> {
  const blocked = requireConfirm(payload, 'metabot metaapp delete requires --confirm.')
  if (blocked) return blocked
  const from = requireFrom(payload)
  if (typeof from !== 'string') return from
  const targetPinId = readTrimmed(payload, 'targetPinId')
  if (!targetPinId) return missing('missing_target_pin_id', 'targetPinId is required')
  return run(
    ['metaapp', 'delete', '--from', from, '--target-pin-id', targetPinId, '--confirm'],
    { timeoutMs: 60_000 },
  )
}

async function handleMetaappUpdate(payload: unknown, run: RunFn): Promise<MetabotCommandResult> {
  const blocked = requireConfirm(payload, 'metabot metaapp update requires --confirm.')
  if (blocked) return blocked
  const from = requireFrom(payload)
  if (typeof from !== 'string') return from
  const targetPinId = readTrimmed(payload, 'targetPinId')
  if (!targetPinId) return missing('missing_target_pin_id', 'targetPinId is required')
  const body = objectOf(payload, 'payload')
  if (body === undefined) return missing('missing_payload', 'payload is required')
  return runMetabotWithPayloadFile(
    ['metaapp', 'update', '--from', from, '--target-pin-id', targetPinId],
    body,
    '--payload-file',
    ['--confirm'],
    run,
  )
}

function readPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value)
  if (typeof value === 'string' && /^[1-9]\d*$/u.test(value.trim())) return Number.parseInt(value.trim(), 10)
  return fallback
}

export async function dispatchSection(
  method: string,
  payload: unknown,
  run: RunFn = runMetabot,
): Promise<MetabotCommandResult | undefined> {
  if (method === 'chat/conversations') {
    const from = requireFrom(payload)
    if (typeof from !== 'string') return from
    return run(['chat', 'conversations', '--from', from], { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'chat/messages') {
    const from = requireFrom(payload)
    if (typeof from !== 'string') return from
    const conversationId = readTrimmed(payload, 'conversationId')
    if (!conversationId) return missing('missing_conversation_id', 'conversationId is required')
    return run(
      ['chat', 'messages', '--from', from, '--conversation-id', conversationId],
      { timeoutMs: LIST_TIMEOUT_MS },
    )
  }
  if (method === 'chat/private') return handleChatPrivate(payload, run)
  if (method === 'services/owned/list') {
    const from = requireFrom(payload)
    if (typeof from !== 'string') return from
    return run(['services', 'owned', 'list', '--from', from], { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'services/owned/orders') {
    const from = requireFrom(payload)
    if (typeof from !== 'string') return from
    const serviceId = readTrimmed(payload, 'serviceId')
    if (!serviceId) return missing('missing_service_id', 'serviceId is required')
    return run(
      ['services', 'owned', 'orders', '--from', from, '--service-id', serviceId],
      { timeoutMs: LIST_TIMEOUT_MS },
    )
  }
  if (method === 'services/owned/revoke') return handleServicesRevoke(payload, run)
  if (method === 'services/publish') return handleServicesPublish(payload, run)
  if (method === 'services/call') return handleServicesCall(payload, run)
  if (method === 'metaapp/list') {
    const from = readFrom(payload)
    const args = from ? ['metaapp', 'list', '--from', from] : ['metaapp', 'list']
    const size = readPositiveInteger(payload && (payload as { size?: unknown }).size, 12)
    const cursor = readTrimmed(payload, 'cursor')
    args.push('--size', String(size))
    if (cursor) args.push('--cursor', cursor)
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'metaapp/publish') return handleMetaappPublish(payload, run)
  if (method === 'metaapp/update') return handleMetaappUpdate(payload, run)
  if (method === 'metaapp/delete') return handleMetaappDelete(payload, run)
  if (method === 'traffic/status') {
    return run(['traffic', 'status'], { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'traffic/mode') {
    const mode = readTrimmed(payload, 'mode')
    if (mode && mode !== 'traffic' && mode !== 'selfpay') {
      return missing('invalid_mode', 'mode must be "traffic" or "selfpay"')
    }
    // Setting mode=traffic runs ensure-account + bind-all in the CLI.
    return run(mode ? ['traffic', 'mode', mode] : ['traffic', 'mode'], { timeoutMs: TRAFFIC_MUTATION_TIMEOUT_MS })
  }
  if (method === 'traffic/balance') {
    return run(['traffic', 'balance'], { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'traffic/ledger') {
    const limit = readPositiveInteger(payload && (payload as { limit?: unknown }).limit, 20)
    const args = ['traffic', 'ledger', '--limit', String(limit)]
    const cursor = readTrimmed(payload, 'cursor')
    if (cursor) args.push('--cursor', cursor)
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'traffic/usage') {
    return run(['traffic', 'usage'], { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'traffic/claim') {
    return run(['traffic', 'claim'], { timeoutMs: TRAFFIC_MUTATION_TIMEOUT_MS })
  }
  if (method === 'traffic/redeem') {
    const code = readTrimmed(payload, 'code')
    if (!code) return missing('missing_code', 'code is required')
    return run(['traffic', 'redeem', code], { timeoutMs: TRAFFIC_MUTATION_TIMEOUT_MS })
  }
  if (method === 'traffic/api-base') {
    const action = readTrimmed(payload, 'action') || 'get'
    if (action === 'get') return run(['traffic', 'api-base'], { timeoutMs: LIST_TIMEOUT_MS })
    if (action === 'reset') return run(['traffic', 'api-base', 'reset'], { timeoutMs: LIST_TIMEOUT_MS })
    if (action !== 'set') return missing('invalid_action', 'action must be "get", "set", or "reset"')
    // Validate before spawning: invalid overrides must never reach the CLI.
    let value: string
    try {
      value = normalizeTrafficApiBase((payload as { value?: unknown } | null)?.value)
    } catch (error) {
      return missing('invalid_api_base', error instanceof Error ? error.message : String(error))
    }
    if (!value) return missing('missing_value', 'value is required (use action "reset" to clear)')
    return run(['traffic', 'api-base', 'set', value], { timeoutMs: LIST_TIMEOUT_MS })
  }
  return undefined
}
