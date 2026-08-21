import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { runCli } = require('../../dist/cli/main.js')
const localRead = await import('../lib/local-read.js')

const ORIGINAL_HOME = process.env.HOME

async function makeHome() {
  return mkdtemp(join(tmpdir(), 'dsh-localread-'))
}

function makeCliContext(home) {
  let out = ''
  return {
    context: {
      stdout: { write: (chunk) => { out += String(chunk); return true } },
      stderr: { write: () => true },
      env: { HOME: home },
      cwd: home,
      dependencies: {},
    },
    output: () => out,
  }
}

test('localUserWho: empty then matches the CLI-created owner identity', async () => {
  const home = await makeHome()
  process.env.HOME = home
  try {
    const empty = await localRead.localUserWho()
    assert.equal(empty.ok, true)
    assert.equal(empty.data.identity, null)

    const created = makeCliContext(home)
    assert.equal(await runCli(['user', 'create', '--name', 'Alice', '--json'], created.context), 0)
    const createdIdentity = JSON.parse(created.output()).data.identity

    const who = await localRead.localUserWho()
    assert.equal(who.ok, true)
    assert.equal(who.data.identity.name, 'Alice')
    assert.equal(who.data.identity.globalMetaId, createdIdentity.globalMetaId)
    assert.equal(who.data.identity.mvcAddress, createdIdentity.mvcAddress)
    // The in-process read must never surface the mnemonic.
    assert.equal(who.data.identity.mnemonic, undefined)
  } finally {
    process.env.HOME = ORIGINAL_HOME
    await rm(home, { recursive: true, force: true })
  }
})

test('localBotList and localTwinCurrent return sane empty shapes', async () => {
  const home = await makeHome()
  process.env.HOME = home
  try {
    const bots = await localRead.localBotList()
    assert.equal(bots.ok, true)
    assert.deepEqual(bots.data.profiles, [])

    const twin = await localRead.localTwinCurrent()
    assert.equal(twin.ok, true)
    assert.equal(twin.data.twinSlug, null)
  } finally {
    process.env.HOME = ORIGINAL_HOME
    await rm(home, { recursive: true, force: true })
  }
})

test('per-bot reads return null (CLI fallback) for an unknown profile', async () => {
  const home = await makeHome()
  process.env.HOME = home
  try {
    assert.equal(await localRead.localMemoryList('no-such-bot', {}), null)
    assert.equal(await localRead.localMemoryStats('no-such-bot', {}), null)
    assert.equal(await localRead.localDreamSelfIdentity('no-such-bot'), null)
    assert.equal(await localRead.localBotShow('no-such-bot'), null)
    assert.equal(await localRead.localConversationsList('no-such-bot'), null)
    assert.equal(await localRead.localConversationsMessages('no-such-bot', 'idpeer'), null)
  } finally {
    process.env.HOME = ORIGINAL_HOME
    await rm(home, { recursive: true, force: true })
  }
})

test('in-process user read is fast (no CLI subprocess boot)', async () => {
  const home = await makeHome()
  process.env.HOME = home
  try {
    const created = makeCliContext(home)
    await runCli(['user', 'create', '--name', 'Alice', '--json'], created.context)

    const localStart = process.hrtime.bigint()
    await localRead.localUserWho()
    const localMs = Number(process.hrtime.bigint() - localStart) / 1e6

    // A spawned `metabot` CLI boots the whole command tree (~0.7-1s). The
    // in-process read must stay far below that; keep the bound generous so it
    // is stable across machines. (runCli here is in-process, so it is not a
    // fair comparison target.)
    assert.ok(localMs < 400, `in-process read too slow: ${localMs.toFixed(1)}ms`)
  } finally {
    process.env.HOME = ORIGINAL_HOME
    await rm(home, { recursive: true, force: true })
  }
})
