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

const LIST_TIMEOUT_MS = 30_000

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
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'metaapp/publish') return handleMetaappPublish(payload, run)
  if (method === 'metaapp/delete') return handleMetaappDelete(payload, run)
  return undefined
}
