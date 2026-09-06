import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { runMetabotPinned, DAEMON_PINNED_SKIP } = await import('../lib/daemon-pinned-run.js')

const ORIGINAL_HOME = process.env.HOME

async function makeHome() {
  return mkdtemp(join(tmpdir(), 'dsh-pinnedrun-'))
}

test('runMetabotPinned skips (never spawns, never replaces) when no daemon record exists', async () => {
  const home = await makeHome()
  process.env.HOME = home
  delete process.env.METABOT_DAEMON_BASE_URL
  try {
    let spawned = 0
    const result = await runMetabotPinned(['grouptask', 'work', 'claim'], {}, async () => {
      spawned += 1
      throw new Error('must not spawn')
    })
    assert.equal(spawned, 0)
    assert.deepEqual(result, DAEMON_PINNED_SKIP)
  } finally {
    process.env.HOME = ORIGINAL_HOME
    await rm(home, { recursive: true, force: true })
  }
})

test('runMetabotPinned pins METABOT_DAEMON_BASE_URL from the daemon record', async () => {
  const home = await makeHome()
  process.env.HOME = home
  delete process.env.METABOT_DAEMON_BASE_URL
  try {
    await mkdir(join(home, '.metabot', 'runtime'), { recursive: true })
    await writeFile(
      join(home, '.metabot', 'runtime', 'daemon.json'),
      JSON.stringify({ baseUrl: 'http://127.0.0.1:10001' }),
      'utf8',
    )
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
    process.env.HOME = ORIGINAL_HOME
    await rm(home, { recursive: true, force: true })
  }
})
