import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Tracked temp roots only (AGENTS.md test rule): every directory this file
// creates lives under a mkdtempTempRootSync root, so teardown removes it on
// success, failure, or timeout.
import { mkdtempTempRootSync } from '../../tests/helpers/tempRoots.mjs'

const plugin = await import('../lib/upload-file-tools.js')

function fakeHost(overrides = {}) {
  const tools = []
  return {
    tools,
    ctx: {
      tools: { register: (definition) => tools.push(definition) },
      logger: { warn: () => undefined },
      ...overrides,
    },
  }
}

const UPLOAD_RESULT = {
  ok: true,
  state: 'success',
  data: {
    pinId: 'ff1',
    txids: ['t1'],
    totalCost: 900,
    network: 'mvc',
    filePath: '/x/shot.png',
    fileName: 'shot.png',
    contentType: 'image/png',
    bytes: 4096,
    extension: '.png',
    metafileUri: 'metafile://ff1i0.png',
    metawebUrl: 'https://metaweb.example/ff1',
    globalMetaId: 'idq1example',
  },
}

function fakeRun(result) {
  const calls = []
  return {
    calls,
    run: async (args, options) => {
      // runMetabotWithPayloadFile deletes its temp payload on return, so the
      // payload must be captured synchronously here.
      const flagIndex = args.indexOf('--request-file')
      const payload = flagIndex >= 0
        ? JSON.parse(readFileSync(args[flagIndex + 1], 'utf8'))
        : undefined
      calls.push({ args, options, payload })
      return result ?? UPLOAD_RESULT
    },
  }
}

function buildTools(host, overrides = {}) {
  const [tool] = plugin.buildUploadFileToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    ...overrides,
  })
  return tool
}

test('upload_file registers on the global layer', () => {
  const host = fakeHost()
  plugin.bindUploadFileToolInstall(host.ctx)
  assert.deepEqual(host.tools.map((tool) => tool.name), ['upload_file'])
})

test('upload_file description keeps the binary-payload boundary and the path rules', () => {
  const host = fakeHost()
  plugin.bindUploadFileToolInstall(host.ctx)
  const description = host.tools[0].description
  assert.match(description, /upload a BINARY file/)
  assert.match(description, /metafile:\/\//)
  assert.match(description, /Do NOT upload Markdown\/text documents/)
  assert.match(description, /post_simplenote/)
  assert.match(description, /ABSOLUTE \(relative paths are rejected\)/)
  assert.match(description, /approval prompts are disabled .* auto-declined/)
  assert.match(description, /copy the file into the session workspace/)
})

test('missing, relative, and invalid-network inputs are rejected before any CLI call', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost({ agentPresets: { composedPreset: () => 'oac-alice' } })
  const tool = buildTools(host, { run })

  const missing = await tool.execute({ file_path: '   ' }, {})
  assert.match(missing, /requires `file_path`/)

  const relative = await tool.execute({ file_path: './shot.png' }, {})
  assert.match(relative, /ABSOLUTE file path/)
  assert.match(relative, /relative path/)

  const badNetwork = await tool.execute({ file_path: '/tmp/a.png', network: 'doge' }, {})
  assert.match(badNetwork, /Invalid network "doge"/)

  assert.equal(calls.length, 0, 'client-side validation never reaches the CLI')
})

test('in-workspace absolute path uploads through `file upload --request-file` without asking', async () => {
  const root = mkdtempTempRootSync('upl-ws-')
  const inside = path.join(root, 'shot.png')
  writeFileSync(inside, 'png')
  const outsideRoot = mkdtempTempRootSync('upl-out-')
  const outside = path.join(outsideRoot, 'secret.png')
  writeFileSync(outside, 's')

  const asked = []
  const approval = {
    request: async (req) => {
      asked.push(req)
      return 'allowed-once'
    },
    overrideOf: () => undefined,
  }
  const { run, calls } = fakeRun()
  const host = fakeHost({ agentPresets: { composedPreset: () => 'oac-alice' } })
  const stagedCalls = []
  const tool = buildTools(host, {
    approval,
    run,
    getWorkspaceDir: () => root,
    stageExternalFiles: async (from, paths) => {
      stagedCalls.push({ from, paths })
      return {
        pathByOriginal: new Map(paths.map((item) => [item, path.join(root, `staged-${path.basename(item)}`)])),
        cleanup: async () => {},
      }
    },
  })

  const ok = await tool.execute(
    { file_path: inside, content_type: 'image/png', network: 'mvc' },
    {},
  )
  assert.match(ok, /File uploaded to MetaWeb\./)
  assert.match(ok, /metafile URI: metafile:\/\/ff1i0\.png/)
  assert.match(ok, /- pinId: ff1/)
  assert.match(ok, /- size: 4\.0 KiB \(4096 bytes\)/)
  assert.match(ok, /- cost: 900 sats/)
  assert.doesNotMatch(ok, /post_simplenote/, 'binary files get no text-document nudge')
  assert.equal(asked.length, 0, 'in-workspace files never ask')
  assert.deepEqual(calls[0].args.slice(0, 4), ['file', 'upload', '--from', 'alice'])
  assert.match(calls[0].args[4], /^--request-file$/)
  assert.equal(calls[0].payload.filePath, inside)
  assert.equal(calls[0].payload.contentType, 'image/png')
  assert.equal(calls[0].payload.network, 'mvc')

  // External file: owner approves, the host stages the copy, and the CLI
  // payload carries the staged in-workspace path with no consent flag.
  const external = await tool.execute({ file_path: outside }, {})
  assert.match(external, /File uploaded to MetaWeb\./)
  assert.equal(asked.length, 1)
  assert.equal(asked[0].toolName, 'upload_file')
  assert.match(asked[0].reason, /Upload this file on-chain to MetaWeb \/file\?/)
  assert.deepEqual(stagedCalls[0]?.paths, [outside], 'approved external file is staged by the host')
  assert.equal(
    calls[1].payload.filePath,
    path.join(root, 'staged-secret.png'),
    'upload uses the staged in-workspace path',
  )
  assert.equal(calls[1].payload.confirmExternalUpload, undefined, 'no caller-side consent flag may reach the daemon')
})

test('text-document uploads get the post_simplenote nudge on the success sheet', async () => {
  const root = mkdtempTempRootSync('upl-md-')
  const inside = path.join(root, 'report.md')
  writeFileSync(inside, '# hi')
  const { run } = fakeRun({
    ...UPLOAD_RESULT,
    data: { ...UPLOAD_RESULT.data, fileName: 'report.md', contentType: 'text/markdown', extension: '.md' },
  })
  const host = fakeHost()
  const tool = buildTools(host, { run, getWorkspaceDir: () => root })
  const sheet = await tool.execute({ file_path: inside }, {})
  assert.match(sheet, /looks like a readable text document/)
  assert.match(sheet, /prefer post_simplenote next time/)
  assert.match(sheet, /metafile:\/\/ is intended for binary files/)
})

test('owner decline, missing approval surface, and disabled prompts all block the upload', async () => {
  const outsideRoot = mkdtempTempRootSync('upl-out2-')
  const outside = path.join(outsideRoot, 'f.bin')
  writeFileSync(outside, 'f')
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const workspace = mkdtempTempRootSync('upl-ws2-')

  // 1. Owner actively declines the native dialog.
  let approve = false
  const asked = []
  const declining = buildTools(host, {
    approval: {
      request: async (req) => {
        asked.push(req)
        return approve ? 'allowed-once' : 'rejected'
      },
      overrideOf: () => undefined,
    },
    run,
    getWorkspaceDir: () => workspace,
    stageExternalFiles: async () => ({ pathByOriginal: new Map(), cleanup: async () => {} }),
  })
  const denied = await declining.execute({ file_path: outside }, {})
  assert.match(denied, /Owner declined to upload the file/)
  assert.match(denied, /copy the file into the session workspace/)
  assert.match(denied, /Do not retry the same path/)
  assert.equal(calls.length, 0, 'declined upload never spawns the CLI write')

  // 2. No approval surface in this composition at all.
  const bare = buildTools(host, { run, getWorkspaceDir: () => workspace })
  const refused = await bare.execute({ file_path: outside }, {})
  assert.match(refused, /Upload refused/)
  assert.match(refused, /auto-declined/)
  assert.equal(calls.length, 0)

  // 3. Approval surface exists but prompts are disabled (policy "never"):
  //    the dialog must not spawn and the upload is auto-declined
  //    (wallet-tools B1 lineage).
  const neverTool = buildTools(host, {
    approval: {
      request: async () => {
        throw new Error('the dialog must not spawn when prompts are disabled')
      },
      overrideOf: () => 'never',
    },
    run,
    getWorkspaceDir: () => workspace,
    stageExternalFiles: async () => { throw new Error('staging must not run when prompts are disabled') },
  })
  const autoDeclined = await neverTool.execute({ file_path: outside }, {})
  assert.match(autoDeclined, /Upload refused/)
  assert.match(autoDeclined, /auto-declined/)
  assert.equal(asked.length, 1, 'only the first (declining) case asked')
  assert.equal(calls.length, 0, 'auto-declined upload never spawns the CLI write')
})

test('CLI failures surface the message', async () => {
  const root = mkdtempTempRootSync('upl-ws3-')
  const inside = path.join(root, 'a.png')
  writeFileSync(inside, 'png')
  const failing = fakeRun({ ok: false, state: 'failed', code: 'file_upload_failed', message: 'boom' })
  const host = fakeHost()
  const tool = buildTools(host, { run: failing.run, getWorkspaceDir: () => root })
  const err = await tool.execute({ file_path: inside }, {})
  assert.match(err, /File upload failed: boom/)
})
