import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { runMetabotPinned, DAEMON_PINNED_SKIP } = await import('../lib/daemon-pinned-run.js')
const { computeDaemonRuntimeFingerprint } = await import('../lib/browser-bridge.js')

const ORIGINAL_HOME = process.env.HOME
const ORIGINAL_CLI_PATH = process.env.OAC_METABOT_CLI_PATH

async function makeHome() {
  return mkdtemp(join(tmpdir(), 'dsh-pinnedrun-'))
}

/** A fake OAC checkout (dist/cli/main.js) + the fingerprint a matching daemon record must carry. */
async function makeFakeDist() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fakedist-'))
  await mkdir(join(root, 'dist', 'cli'), { recursive: true })
  await writeFile(join(root, 'dist', 'cli', 'main.js'), '// fake cli\n', 'utf8')
  return {
    root,
    cliPath: join(root, 'dist', 'cli', 'main.js'),
    fingerprint: computeDaemonRuntimeFingerprint(join(root, 'dist')),
  }
}

async function writeDaemonRecord(home, record) {
  await mkdir(join(home, '.metabot', 'runtime'), { recursive: true })
  await writeFile(join(home, '.metabot', 'runtime', 'daemon.json'), JSON.stringify(record), 'utf8')
}

function setEnv(home, cliPath) {
  process.env.HOME = home
  delete process.env.METABOT_DAEMON_BASE_URL
  if (cliPath) process.env.OAC_METABOT_CLI_PATH = cliPath
  else delete process.env.OAC_METABOT_CLI_PATH
}

async function restoreEnv(paths) {
  process.env.HOME = ORIGINAL_HOME
  if (ORIGINAL_CLI_PATH === undefined) delete process.env.OAC_METABOT_CLI_PATH
  else process.env.OAC_METABOT_CLI_PATH = ORIGINAL_CLI_PATH
  await Promise.all(paths.map((p) => rm(p, { recursive: true, force: true })))
}

test('runMetabotPinned skips (never spawns, never replaces) when no daemon record exists', async () => {
  const home = await makeHome()
  setEnv(home, null)
  try {
    let spawned = 0
    const result = await runMetabotPinned(['grouptask', 'work', 'claim'], {}, async () => {
      spawned += 1
      throw new Error('must not spawn')
    })
    assert.equal(spawned, 0)
    assert.deepEqual(result, DAEMON_PINNED_SKIP)
  } finally {
    await restoreEnv([home])
  }
})

test('runMetabotPinned pins METABOT_DAEMON_BASE_URL from a record matching the local build', async () => {
  const home = await makeHome()
  const dist = await makeFakeDist()
  setEnv(home, dist.cliPath)
  try {
    await writeDaemonRecord(home, { baseUrl: 'http://127.0.0.1:10001', runtimeFingerprint: dist.fingerprint })
    const calls = []
    const result = await runMetabotPinned(['grouptask', 'work', 'claim'], { timeoutMs: 1234 }, async (args, options) => {
      calls.push({ args, env: options.env })
      return { ok: true, state: 'success' }
    })
    assert.equal(result.ok, true)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].args, ['grouptask', 'work', 'claim'])
    assert.equal(calls[0].env.METABOT_DAEMON_BASE_URL, 'http://127.0.0.1:10001')
  } finally {
    await restoreEnv([home, dist.root])
  }
})

test('runMetabotPinned rejects a daemon record written by a FOREIGN build (task-67 hijack)', async () => {
  const home = await makeHome()
  const dist = await makeFakeDist()
  setEnv(home, dist.cliPath)
  try {
    await writeDaemonRecord(home, { baseUrl: 'http://127.0.0.1:10001', runtimeFingerprint: 'deadbeef'.repeat(8) })
    const rejections = []
    let spawned = 0
    const result = await runMetabotPinned(['grouptask', 'work', 'claim'], {}, async () => {
      spawned += 1
      throw new Error('must not spawn')
    }, (reason) => rejections.push(reason))
    assert.equal(spawned, 0, 'never talks to the foreign daemon')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'daemon_record_rejected')
    assert.match(result.message, /different OAC build/)
    assert.equal(rejections.length, 1, 'rejection surfaced for host-side logs')
  } finally {
    await restoreEnv([home, dist.root])
  }
})

test('runMetabotPinned rejects a record with no fingerprint (pre-fingerprint daemon)', async () => {
  const home = await makeHome()
  const dist = await makeFakeDist()
  setEnv(home, dist.cliPath)
  try {
    await writeDaemonRecord(home, { baseUrl: 'http://127.0.0.1:10001' })
    const result = await runMetabotPinned(['grouptask', 'work', 'claim'], {}, async () => {
      throw new Error('must not spawn')
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'daemon_record_rejected')
  } finally {
    await restoreEnv([home, dist.root])
  }
})
