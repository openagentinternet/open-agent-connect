/**
 * omni_cast — DSH native tool for casting one arbitrary MetaID protocol pin
 * (any /protocols/* path or /file). OAC port of the IDBots tool: the
 * tool-level semantics (payload XOR payload_file, extension MIME inference,
 * binary base64 auto-detection, JSON parse + re-serialize) live in this
 * bridge; the chain write itself runs through the EXISTING generic OAC core
 * path — CLI `chain write --request-file` → daemon `/api/chain/write` →
 * signer.writePin — so no new chain-write plumbing is introduced.
 *
 * Deliberate OAC scope note: /protocols/simplegroupchat payload
 * auto-encryption is NOT available here (group-chat primitives are a later
 * batch); casting to that path fails fast with a pointer instead of writing
 * an unencrypted payload.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import type { HostAgentLike, HostApproval, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'
import { agentSessionCwd, approvalOf, oacSlugOf } from './browser-tools.js'
import { isPathInsideDir } from './oac-core-gate.js'

const CAST_TIMEOUT_MS = 240_000

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Extension-to-MIME map for payload_file content-type inference — IDBots
 * omni_cast semantics (which mirror the retired metabot-omni-caster skill's
 * inferContentType()).
 */
const PAYLOAD_FILE_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain',
}

function inferContentType(filePath: string): string {
  return PAYLOAD_FILE_MIME_MAP[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/** Binary content types are sent base64-encoded unless encoding was given. */
function isBinaryContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase()
  return (
    ct.startsWith('image/')
    || ct.startsWith('video/')
    || ct.startsWith('audio/')
    || ct === 'application/octet-stream'
    || ct.endsWith(';binary')
  )
}

/** Human-readable result sheet mirroring the IDBots omni_cast output. */
function formatCastResult(data: Record<string, unknown>): string {
  const lines: string[] = ['Pin cast on-chain.']
  const pinId = typeof data.pinId === 'string' ? data.pinId : ''
  const txids = Array.isArray(data.txids) ? data.txids.filter((tx) => typeof tx === 'string') : []
  if (txids.length) lines.push(`- txid: ${txids[0]}`)
  if (pinId) lines.push(`- pinId: ${pinId}`)
  if (typeof data.totalCost === 'number') lines.push(`- cost: ${data.totalCost} sats`)
  if (pinId) lines.push(`- view link: [pin://${pinId}](pin://${pinId})`)
  return lines.join('\n')
}

export function buildOmniCastToolDefinitions(input: {
  host: HostContext
  hostAgent: HostAgentLike
  approval?: HostApproval
  run?: RunFn
  /** Session workspace resolver; absent = every local file counts as external. */
  getWorkspaceDir?: (exec: HostToolExec) => string | undefined
}): HostToolDefinition[] {
  const { host, hostAgent } = input
  const approval = input.approval ?? approvalOf(host)
  const run = input.run ?? (async (args, options) => {
    const { runMetabot } = await import('./cli-bridge.js')
    return runMetabot(args, options)
  })

  const actorSlug = (exec: HostToolExec): string => {
    const agent = exec.agent ?? hostAgent
    const live = oacSlugOf(host, agent)
    if (live) return live
    const preset = host.agentPresets?.composedPreset?.(agent.ctx)
    return typeof preset === 'string' ? preset.replace(/^oac-/, '') : ''
  }

  const omniCast: HostToolDefinition = {
    name: 'omni_cast',
    description:
      'Cast one MetaID protocol pin (arbitrary 7-tuple broadcast) on-chain, as the MetaBot that owns this session. '
      + 'Use for protocol writes such as paylike, paycomment, simplenote, metaapp, /file, or any other /protocols/* path. '
      + 'Provide exactly one of payload (inline JSON/text) or payload_file (absolute local path; bytes are read and sent base64, with content_type inferred from the extension when omitted). '
      + 'JSON content types are parsed and re-serialized. '
      + 'Do NOT use for simplebuzz posts (use post_buzz), metafile:// file uploads (use upload_file), or group chat messaging (use group_chat). '
      + 'Writes permanently on-chain and costs transaction fees; omit encoding to auto-detect base64 for binary content types. '
      + 'A payload_file outside the session workspace requires the owner\'s explicit confirmation before it is published. '
      + 'Returns txid, pinId, cost in sats, and a pin:// view link.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'MetaID protocol path, e.g. /protocols/paylike' },
        payload: { type: 'string', description: 'Inline payload string. JSON when content_type contains "json". Mutually exclusive with payload_file.' },
        payload_file: { type: 'string', description: 'Absolute local file path; read and sent base64' },
        operation: { type: 'string', enum: ['create', 'modify', 'revoke'], description: 'MetaID operation. Default: create.' },
        content_type: { type: 'string', description: 'Payload MIME type. Default: application/json; inferred from the file extension for payload_file.' },
        encoding: { type: 'string', enum: ['utf-8', 'base64'], description: 'Payload encoding. Default: utf-8, auto-detected to base64 for binary content types; always base64 for payload_file.' },
        network: { type: 'string', enum: ['mvc', 'doge', 'btc'], description: 'Write network. Default: mvc.' },
      },
      required: ['path'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [
        { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
      ],
    },
    timeoutMs: CAST_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
      const pinPath = textArg(args, 'path')
      if (!pinPath) {
        return 'omni_cast requires `path` (a MetaID protocol path, e.g. /protocols/paylike).'
      }

      const hasPayload = typeof args.payload === 'string' && args.payload !== ''
      const payloadFile = textArg(args, 'payload_file')
      if (hasPayload && payloadFile) {
        return 'omni_cast accepts either `payload` or `payload_file`, not both.'
      }
      if (!hasPayload && !payloadFile) {
        return 'omni_cast requires exactly one of `payload` or `payload_file`.'
      }

      if (args.network != null && args.network !== 'mvc' && args.network !== 'doge' && args.network !== 'btc') {
        return `Invalid network "${args.network}" — must be one of mvc, doge, btc.`
      }

      // Group-chat payloads are encrypted by the host in IDBots; OAC does not
      // have that primitive yet, so refuse instead of writing plaintext.
      if (pinPath === '/protocols/simplegroupchat') {
        return 'omni_cast does not support /protocols/simplegroupchat yet — group message encryption arrives with the OAC group-chat batch. Writing an unencrypted group payload would leak the message; use send_group_message/group_chat tooling when it lands.';
      }

      const operation = args.operation === 'modify' || args.operation === 'revoke' ? args.operation : 'create'
      let contentType = textArg(args, 'content_type') || 'application/json'
      let cleanPayload: string
      let encoding: 'utf-8' | 'base64' = args.encoding === 'base64' ? 'base64' : 'utf-8'

      if (payloadFile) {
        if (!path.isAbsolute(payloadFile)) {
          return `omni_cast requires an ABSOLUTE local path for payload_file. Received a relative path: "${payloadFile}". Resolve it to an absolute path first.`
        }
        if (!existsSync(payloadFile)) {
          return `omni_cast payload file not found: ${payloadFile}`
        }
        // Owner gate: publishing a local file on-chain is irreversible, so
        // files outside the session workspace need explicit confirmation —
        // same rule as the upload tools.
        const workspace = (input.getWorkspaceDir ?? (() => agentSessionCwd(exec.agent)))(exec)
        const external = !workspace || !isPathInsideDir(payloadFile, workspace)
        if (external) {
          if (!approval) {
            return 'omni_cast cannot publish a file outside the session workspace when approval prompts are unavailable. Do not retry the same path — copy the file into the session workspace (a gitignored sub-directory keeps the tree clean) and retry with the new ABSOLUTE path.'
          }
          const agent = exec.agent ?? hostAgent
          const reason = [
            'Publish this file\'s bytes on-chain as a protocol pin? This makes them public and irreversible.',
            `- ${payloadFile}`,
          ].join('\n')
          const outcome = await approval.request({
            agent,
            toolName: 'omni_cast',
            ...(exec.callId ? { callId: exec.callId } : {}),
            reason,
            signal: exec.signal,
          })
          if (outcome !== 'allowed-once') {
            return `Owner declined to publish a file outside the session workspace (${outcome}). Do not retry the same path — copy the file into the session workspace (a gitignored sub-directory keeps the tree clean) and retry with the new ABSOLUTE path.`
          }
        }
        try {
          cleanPayload = readFileSync(payloadFile).toString('base64')
        } catch (error) {
          return `omni_cast failed to read payload file ${payloadFile}: ${error instanceof Error ? error.message : String(error)}`
        }
        encoding = 'base64'
        if (!textArg(args, 'content_type')) {
          contentType = inferContentType(payloadFile)
        }
      } else {
        const payloadStr = args.payload as string
        if (contentType.toLowerCase().includes('json')) {
          let parsed: unknown
          try {
            parsed = JSON.parse(payloadStr)
          } catch {
            return 'omni_cast payload is not valid JSON.'
          }
          cleanPayload = JSON.stringify(parsed)
        } else {
          cleanPayload = payloadStr
          if (args.encoding == null && isBinaryContentType(contentType)) {
            encoding = 'base64'
          }
        }
      }

      const slug = actorSlug(exec)
      const result = await runMetabotWithPayloadFile(
        ['chain', 'write', ...(slug ? ['--from', slug] : [])],
        {
          operation,
          path: pinPath,
          encryption: '0',
          version: '1.0',
          contentType,
          payload: cleanPayload,
          ...(encoding === 'base64' ? { encoding: 'base64' } : {}),
          ...(args.network === 'mvc' || args.network === 'doge' || args.network === 'btc' ? { network: args.network } : {}),
        },
        '--request-file',
        [],
        run,
        { timeoutMs: CAST_TIMEOUT_MS },
      )
      if (!result.ok) {
        return `omni_cast failed: ${result.message ?? result.code ?? 'unknown error'}`
      }
      return formatCastResult((result.data ?? {}) as Record<string, unknown>)
    },
  }

  return [omniCast]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register omni_cast on the host global tool layer during plugin apply. */
export function bindOmniCastToolInstall(ctx: HostContext): void {
  const hostAgent: HostAgentLike = { ctx }
  for (const definition of buildOmniCastToolDefinitions({
    host: ctx,
    hostAgent,
    approval: approvalOf(ctx),
    getWorkspaceDir: (exec) => agentSessionCwd(exec.agent),
  })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!isDuplicateToolError(error)) {
        ctx.logger?.warn?.(`[oac-dsh] omni-cast tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
