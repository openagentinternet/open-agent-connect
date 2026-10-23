/**
 * upload_file — DSH native tool for uploading ONE local binary file to
 * MetaWeb /file. OAC port of the IDBots tool: the file path is bridged to
 * the OAC CLI (`file upload --request-file`) through the shared
 * payload-file pattern, so no upload logic is duplicated here. Files
 * outside the session workspace require the owner's explicit confirmation
 * in the native DSH approval dialog before any bytes leave the machine;
 * approved files are staged into the acting Bot's workspace because the
 * daemon's fail-closed gate ignores caller-supplied consent flags. When
 * approval prompts are disabled (approval/policy "never") or no approval
 * surface exists, outside-workspace uploads are auto-declined
 * (wallet-tools B1 lineage).
 */
import path from 'node:path'
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import type { HostAgentLike, HostApproval, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'
import { agentSessionCwd, approvalOf, oacSlugOf, sessionApprovalPolicy } from './browser-tools.js'
import { stageExternalFilesIntoWorkspace, type StagedExternalFiles } from './file-upload.js'
import { isPathInsideDir } from './oac-core-gate.js'

const UPLOAD_TIMEOUT_MS = 120_000

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatBytes(bytes: unknown): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  const MIB = 1024 * 1024
  if (n >= MIB) return `${(n / MIB).toFixed(2)} MiB (${n} bytes)`
  const KIB = 1024
  if (n >= KIB) return `${(n / KIB).toFixed(1)} KiB (${n} bytes)`
  return `${n} bytes`
}

/** Human-readable success sheet mirroring the IDBots upload_file output. */
export function formatUploadResult(data: Record<string, unknown>): string {
  const lines: string[] = ['File uploaded to MetaWeb.']

  const metafileUri = asString(data.metafileUri)
  const pinId = asString(data.pinId)
  if (metafileUri) lines.push(`- metafile URI: ${metafileUri}`)
  if (pinId) lines.push(`- pinId: ${pinId}`)

  const metawebUrl = asString(data.metawebUrl)
  if (metawebUrl) lines.push(`- share link (for other people): ${metawebUrl}`)

  const fileName = asString(data.fileName) || path.basename(asString(data.filePath))
  if (fileName) lines.push(`- file: ${fileName}`)
  const sizeStr = formatBytes(data.bytes)
  if (sizeStr) lines.push(`- size: ${sizeStr}`)
  const contentType = asString(data.contentType)
  if (contentType) lines.push(`- content type: ${contentType}`)

  // Convention nudge at the exact moment the mistake happens: a readable
  // text document uploaded to /file should have been a simplenote note
  // cited as pin:// — metafile:// is reserved for binary payloads.
  const ext = path.extname(fileName).toLowerCase()
  if (contentType.startsWith('text/') || ['.md', '.markdown', '.txt'].includes(ext)) {
    lines.push(
      '- note: this looks like a readable text document — if it is meant to be READ (note, report, Markdown deliverable), prefer post_simplenote next time and cite the note as pin://<pinId>; metafile:// is intended for binary files (images, video, audio, PDF, archives).',
    )
  }

  const network = asString(data.network)
  if (network) lines.push(`- network: ${network}`)
  if (typeof data.totalCost === 'number') lines.push(`- cost: ${data.totalCost} sats`)

  const txids = Array.isArray(data.txids) ? data.txids.filter(Boolean) : []
  if (txids.length) lines.push(`- txids: ${txids.join(', ')}`)

  return lines.join('\n')
}

export function buildUploadFileToolDefinitions(input: {
  host: HostContext
  hostAgent: HostAgentLike
  approval?: HostApproval
  run?: RunFn
  /** Session workspace resolver; absent = every local file counts as external. */
  getWorkspaceDir?: (exec: HostToolExec) => string | undefined
  /** Test seam; production stages approved files into the Bot workspace. */
  stageExternalFiles?: (from: string, paths: string[]) => Promise<StagedExternalFiles>
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

  const uploadFile: HostToolDefinition = {
    name: 'upload_file',
    description:
      'Upload ONE local file to MetaWeb. Pass the absolute file path, never file contents (the runtime streams bytes from disk). '
      + 'Use when the user asks to upload a BINARY file (image, video, audio, PDF, archive…), or a later step needs a metafile:// URI. The file lands on /file and is cited as metafile://<pinId>. '
      + 'Do NOT upload Markdown/text documents meant to be read or delivered (notes, reports, specs, articles): publish those with post_simplenote instead and cite pin://<pinId> — metafile:// is reserved for binary payloads so file indexers/CDN treat them as media. '
      + 'Do NOT publish on-chain files the user did not ask for (permanent, publicly readable). Not for local reads/writes. '
      + 'Writes permanently on-chain and costs transaction fees. The file path must be ABSOLUTE (relative paths are rejected); files outside the session workspace require the owner\'s '
      + 'explicit confirmation in the native DSH approval dialog before upload, and when approval prompts are disabled in this session outside-workspace files are auto-declined — '
      + 'copy the file into the session workspace (a gitignored sub-directory keeps the tree clean) and pass that ABSOLUTE path. '
      + 'Returns pinId, metafileUri, share URL, file name, size, content type, network, cost, txids.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute local path to the file to upload. Relative paths are rejected.' },
        content_type: { type: 'string', description: 'MIME type when known; omit to let the runtime infer it from the file name.' },
        network: { type: 'string', enum: ['mvc', 'btc', 'opcat'], description: 'Chain override. Omit unless the human explicitly asks for a specific chain. DOGE is unsupported.' },
      },
      required: ['file_path'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    timeoutMs: UPLOAD_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
      const filePath = textArg(args, 'file_path')
      if (!filePath) {
        return 'upload_file requires `file_path` (an absolute local path).'
      }
      if (!path.isAbsolute(filePath)) {
        return `upload_file requires an ABSOLUTE file path. Received a relative path: "${filePath}". Resolve it to an absolute path first.`
      }

      if (args.network != null && args.network !== 'mvc' && args.network !== 'btc' && args.network !== 'opcat') {
        return `Invalid network "${args.network}" — must be one of mvc, btc, opcat.`
      }

      // Gate: the file must live inside the session workspace, or the owner
      // approves it in the native dialog — after which the HOST stages a
      // copy into the Bot workspace (the daemon's fail-closed upload gate
      // ignores caller-supplied consent flags).
      const workspaceDir = input.getWorkspaceDir?.(exec)
      const external = !workspaceDir || !isPathInsideDir(filePath, workspaceDir)
      let staged: StagedExternalFiles | null = null
      let effectivePath = filePath
      if (external) {
        // Same lineage as wallet_tools B1: with native prompts live the
        // dialog asks; when prompts are disabled (approval/policy "never")
        // or no approval surface exists at all, the upload is declined
        // automatically instead of silently proceeding.
        const policy = approval?.overrideOf?.(exec.agent?.session) ?? sessionApprovalPolicy(exec.agent)
        if (!approval || policy === 'never') {
          return 'Upload refused: uploading a file outside the session workspace requires owner approval, and approval prompts are disabled or unavailable in this session (auto-declined). '
            + 'Do not retry the same path — copy the file into the session workspace (a gitignored sub-directory keeps the tree clean) and retry with the new ABSOLUTE path.'
        }
        const agent = exec.agent ?? hostAgent
        const reason = [
          'Upload this file on-chain to MetaWeb /file? This makes it public and irreversible.',
          `- ${filePath}`,
        ].join('\n')
        const outcome = await approval.request({
          agent,
          toolName: 'upload_file',
          ...(exec.callId ? { callId: exec.callId } : {}),
          reason,
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') {
          return `Owner declined to upload the file outside the session workspace (${outcome}). Do not retry the same path — when approval prompts are disabled or the owner declines, outside-workspace files cannot upload. Next step: copy the file into the session workspace (a gitignored sub-directory keeps the tree clean) and retry with the new ABSOLUTE path.`
        }
        const slugForStaging = actorSlug(exec)
        if (!slugForStaging) {
          return 'upload_file: the acting Bot could not be resolved, so the approved file cannot be staged into its workspace. Copy it into the Bot workspace manually and retry with the new path.'
        }
        try {
          staged = await (input.stageExternalFiles ?? stageExternalFilesIntoWorkspace)(slugForStaging, [filePath])
          effectivePath = staged.pathByOriginal.get(filePath) ?? filePath
        } catch (error) {
          return `upload_file: could not stage the approved file into the Bot workspace: ${error instanceof Error ? error.message : String(error)}`
        }
      }

      const slug = actorSlug(exec)
      try {
        const result = await runMetabotWithPayloadFile(
          ['file', 'upload', ...(slug ? ['--from', slug] : [])],
          {
            filePath: effectivePath,
            ...(textArg(args, 'content_type') ? { contentType: textArg(args, 'content_type') } : {}),
            ...(args.network === 'mvc' || args.network === 'btc' || args.network === 'opcat' ? { network: args.network } : {}),
          },
          '--request-file',
          [],
          run,
          { timeoutMs: UPLOAD_TIMEOUT_MS },
        )
        if (!result.ok) {
          return `File upload failed: ${result.message ?? result.code ?? 'unknown error'}`
        }
        return formatUploadResult((result.data ?? {}) as Record<string, unknown>)
      } finally {
        await staged?.cleanup()
      }
    },
  }

  return [uploadFile]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register upload_file on the host global tool layer during plugin apply. */
export function bindUploadFileToolInstall(ctx: HostContext): void {
  const hostAgent: HostAgentLike = { ctx }
  for (const definition of buildUploadFileToolDefinitions({
    host: ctx,
    hostAgent,
    approval: approvalOf(ctx),
    getWorkspaceDir: (exec) => agentSessionCwd(exec.agent),
  })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!isDuplicateToolError(error)) {
        ctx.logger?.warn?.(`[oac-dsh] upload_file tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
