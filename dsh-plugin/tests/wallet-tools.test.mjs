import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtempTempRootSync } from '../../tests/helpers/tempRoots.mjs'

// Process-level sandbox for this test file: the OAC CLI resolves its system
// home from env.HOME, so pinning HOME to a tracked temp root guarantees that
// even a regression that bypassed the injected `run` seam could never touch
// the production profile under the real home. All tool executions below go
// through the seam, so no CLI spawn is expected at all.
const sandboxHome = mkdtempTempRootSync('wallet-tools-home-')
const realHome = process.env.HOME
process.env.HOME = sandboxHome
after(() => {
  process.env.HOME = realHome
})

const plugin = await import('../lib/wallet-tools.js')

const MVC_BALANCE = {
  chain: 'mvc', address: '1AliceMvcAddressXXXXXXXXXXXXXXX',
  totalSatoshis: 5837, confirmedSatoshis: 5837, unconfirmedSatoshis: 0, utxoCount: 3,
}
const BTC_BALANCE = {
  chain: 'btc', address: 'bc1qexample',
  totalSatoshis: 12_000, confirmedSatoshis: 10_000, unconfirmedSatoshis: 2_000, utxoCount: 2,
}
const DOGE_BALANCE = {
  chain: 'doge', address: 'DExampleAddressXXXXXXXXXXXXXXX',
  totalSatoshis: 420_000_000, confirmedSatoshis: 420_000_000, unconfirmedSatoshis: 0, utxoCount: 1,
}

const ROSTER = {
  profiles: [
    { name: 'Alice', slug: 'alice', globalMetaId: 'idq1alice', mvcAddress: '1AliceMvcAddressXXXXXXXXXXXXXXX' },
    { name: 'AI Sunny', slug: 'sunny', globalMetaId: 'idq1sunny', mvcAddress: '1SunnyMvcAddressYYYYYYYYYYYYYYY' },
  ],
}

const EXTERNAL_ADDRESS = '1FmTLvrtmnrYhoyx6Rn6MtvoKWepX2UG8W'

function fakeHost(overrides = {}) {
  const tools = []
  return {
    tools,
    ctx: {
      tools: { register: (definition) => tools.push(definition) },
      logger: { warn: () => undefined },
      agentPresets: { composedPreset: () => 'oac-alice' },
      ...overrides,
    },
  }
}

/**
 * Flag-based CLI seam: dispatches by command word. `behavior` may override
 * results per invocation; defaults cover roster, balance, preview, confirm.
 */
function fakeRun(behavior = {}) {
  const calls = []
  const run = async (args, options) => {
    const record = { args, options }
    calls.push(record)
    if (args[0] === 'bot' && args[1] === 'list') {
      return behavior.botList ?? { ok: true, state: 'success', data: ROSTER }
    }
    if (args[0] === 'wallet' && args[1] === 'balance') {
      const chainFlag = args.indexOf('--chain')
      const chain = chainFlag >= 0 ? args[chainFlag + 1] : 'all'
      const balances = chain === 'all'
        ? { mvc: MVC_BALANCE, btc: BTC_BALANCE, doge: DOGE_BALANCE }
        : { [chain]: chain === 'mvc' ? MVC_BALANCE : chain === 'btc' ? BTC_BALANCE : DOGE_BALANCE }
      return behavior.balance ?? { ok: true, state: 'success', data: { chain, globalMetaId: 'idq1alice', balances } }
    }
    if (args[0] === 'wallet' && args[1] === 'transfer') {
      const confirm = args.includes('--confirm')
      if (confirm) {
        return behavior.confirm ?? {
          ok: true, state: 'success',
          data: {
            txid: 'deadbeefcafe1234deadbeefcafe1234deadbeefcafe1234deadbeefcafe1234',
            explorerUrl: 'https://showmvc.io/tx/deadbeefcafe1234',
            amount: '0.50000000 SPACE',
            amountSatoshis: 50_000_000,
            toAddress: EXTERNAL_ADDRESS,
          },
        }
      }
      return behavior.preview ?? {
        ok: false, state: 'awaiting_confirmation',
        data: {
          fromAddress: '1AliceMvcAddressXXXXXXXXXXXXXXX',
          currentBalance: '0.00200000 SPACE',
          toAddress: EXTERNAL_ADDRESS,
          amount: '0.50000000 SPACE',
          estimatedFee: '0.00001000 SPACE',
          currency: 'SPACE',
          chain: 'mvc',
        },
      }
    }
    return { ok: false, state: 'failed', code: 'unhandled', message: `unexpected command: ${args.join(' ')}` }
  }
  return { calls, run }
}

function buildTools(host, { approval, run } = {}) {
  return plugin.buildWalletToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    ...(approval ? { approval } : {}),
    run,
  })
}

function fakeApproval(startOutcome = 'allowed-once') {
  const asked = []
  // Stores the OUTCOME STRING itself ('allowed-once' | 'rejected' | ...).
  // Storing it into a boolean flag and testing truthiness silently maps
  // 'rejected' -> allowed-once (any non-empty string is truthy).
  let outcome = startOutcome
  return {
    asked,
    setOutcome: (value) => { outcome = value },
    approval: {
      request: async (req) => {
        asked.push(req)
        return outcome
      },
      overrideOf: () => undefined,
    },
  }
}

test('wallet tools register on the global layer with English descriptions', () => {
  const host = fakeHost()
  plugin.bindWalletToolInstall(host.ctx)
  assert.deepEqual(host.tools.map((tool) => tool.name), ['wallet_balance', 'wallet_transfer'])
  for (const tool of host.tools) {
    assert.match(tool.description, /^[A-Z]/)
    assert.doesNotMatch(tool.description, /[\u4e00-\u9fff]/, 'descriptions must stay English')
  }
})

test('wallet_balance queries the session Bot read-only across all three chains', async () => {
  const { calls, run } = fakeRun()
  const host = fakeHost()
  const [balance] = buildTools(host, { run })
  const out = await balance.execute({}, {})
  assert.match(out, /# alice/)
  assert.match(out, /- mvc: 5837 sats \(0\.00005837 SPACE\), 3 UTXOs \[spendable = confirmed 5837 \+ unconfirmed 0\]/)
  assert.match(out, /- btc: 12000 sats/)
  assert.match(out, /- doge: 420000000 sats/)
  assert.deepEqual(calls[0].args, ['wallet', 'balance', '--from', 'alice'])
  assert.equal(calls.filter((call) => call.args[0] === 'wallet').length, 1, 'read-only: exactly one CLI query')
})

test('wallet_balance honors --chain and rejects unknown chains', async () => {
  const { calls, run } = fakeRun()
  const host = fakeHost()
  const [balance] = buildTools(host, { run })
  const out = await balance.execute({ chain: 'btc' }, {})
  assert.match(out, /- btc: 12000 sats/)
  assert.doesNotMatch(out, /- mvc:/)
  assert.deepEqual(calls[0].args, ['wallet', 'balance', '--chain', 'btc', '--from', 'alice'])

  const bad = await balance.execute({ chain: 'sol' }, {})
  assert.match(bad, /Invalid chain "sol"/)
  assert.equal(calls.length, 1, 'invalid chain never reaches the CLI')
})

test('wallet_balance batches local names/slugs in one call and dedupes', async () => {
  const { calls, run } = fakeRun()
  const host = fakeHost()
  const [balance] = buildTools(host, { run })
  const out = await balance.execute({ bots: ['AI Sunny', 'sunny'] }, {})
  assert.match(out, /# AI Sunny \(slug sunny\)/)
  assert.equal((out.match(/^# /gm) ?? []).length, 1, 'duplicate slug collapses to one section')
  const balanceCalls = calls.filter((call) => call.args[0] === 'wallet')
  assert.equal(balanceCalls.length, 1)
  assert.deepEqual(balanceCalls[0].args, ['wallet', 'balance', '--from', 'sunny'])

  const unknown = await balance.execute({ bots: ['ghost-bot'] }, {})
  assert.match(unknown, /local Bot not found by name or slug: ghost-bot/)
})

test('wallet_balance surfaces per-Bot lookup failures', async () => {
  const { calls, run } = fakeRun({ balance: { ok: false, state: 'failed', code: 'identity_missing', message: 'No local MetaBot identity' } })
  const host = fakeHost()
  const [balance] = buildTools(host, { run })
  const out = await balance.execute({}, {})
  assert.match(out, /# alice/)
  assert.match(out, /- lookup failed: No local MetaBot identity/)
  assert.equal(calls.length, 1)
})

test('wallet_transfer channel A: local name resolves and executes immediately without approval', async () => {
  const { calls, run } = fakeRun()
  const host = fakeHost()
  const { asked, approval } = fakeApproval()
  const [, transfer] = buildTools(host, { approval, run })
  const out = await transfer.execute({ to: 'AI Sunny', amount: 0.5 }, {})
  assert.match(out, /Transfer broadcast on-chain\./)
  assert.match(out, /txid: deadbeefcafe/)
  assert.match(out, /channel: local \(local roster, no confirmation required\)/)
  assert.equal(asked.length, 0, 'channel A never asks the owner')
  const transferCalls = calls.filter((call) => call.args[1] === 'transfer')
  assert.equal(transferCalls.length, 1)
  assert.deepEqual(transferCalls[0].args, [
    'wallet', 'transfer', '--to', '1SunnyMvcAddressYYYYYYYYYYYYYYY', '--amount', '0.5SPACE',
    '--from', 'alice', '--confirm',
  ])
})

test('wallet_transfer validates to/amount before any CLI call', async () => {
  const { calls, run } = fakeRun()
  const host = fakeHost()
  const [, transfer] = buildTools(host, { run })
  assert.match(await transfer.execute({ to: '', amount: 1 }, {}), /requires `to`/)
  assert.match(await transfer.execute({ to: 'Alice', amount: 0 }, {}), /positive `amount`/)
  assert.match(await transfer.execute({ to: 'Alice', amount: 'nope' }, {}), /positive `amount`/)
  assert.match(await transfer.execute({ to: 'Alice', amount: 0.000001 }, {}), /dust limit/)
  assert.equal(calls.length, 0, 'client-side validation never reaches the CLI')

  const unknown = await transfer.execute({ to: 'ghost-bot', amount: 0.5 }, {})
  assert.match(unknown, /neither a local Bot name\/slug nor an address/)
  assert.equal(calls.length, 1, 'only the roster lookup ran')
})

test('wallet_transfer channel B: preview then owner approval gates the broadcast', async () => {
  const { calls, run } = fakeRun()
  const host = fakeHost()
  const { asked, approval } = fakeApproval()
  const [, transfer] = buildTools(host, { approval, run })
  const out = await transfer.execute({ to: EXTERNAL_ADDRESS, amount: 0.5 }, {})

  const transferCalls = calls.filter((call) => call.args[1] === 'transfer')
  assert.equal(transferCalls.length, 2)
  assert.equal(transferCalls[0].args.includes('--confirm'), false, 'first call is the preview')
  assert.equal(transferCalls[1].args.includes('--confirm'), true, 'second call broadcasts')
  assert.equal(asked.length, 1, 'external send asks exactly once')
  assert.match(asked[0].reason, /external address/)
  assert.match(asked[0].reason, /amount: 0\.50000000 SPACE/)
  assert.match(asked[0].reason, /estimated fee: 0\.00001000 SPACE/)
  assert.equal(asked[0].toolName, 'wallet_transfer')
  assert.match(out, /channel: external \(owner-confirmed\)/)
  assert.match(out, /txid: deadbeefcafe/)
})

test('wallet_transfer channel B: decline or fail-fast never broadcasts', async () => {
  const { calls, run } = fakeRun()
  const host = fakeHost()
  const { asked, approval, setOutcome } = fakeApproval()
  const [, transfer] = buildTools(host, { approval, run })
  setOutcome('rejected')
  const declined = await transfer.execute({ to: EXTERNAL_ADDRESS, amount: 0.5 }, {})
  assert.match(declined, /Owner declined the external transfer/)
  assert.match(declined, /Do not retry/)
  const transferCalls = calls.filter((call) => call.args[1] === 'transfer')
  assert.equal(transferCalls.length, 1, 'only the preview ran; nothing was broadcast')

  const insufficient = fakeRun({
    preview: { ok: false, state: 'failed', code: 'insufficient_balance', message: 'Total balance 100 sats ... below the required 50010000 sats' },
  })
  const host2 = fakeHost()
  const { asked: asked2, approval: approval2 } = fakeApproval()
  const [, transfer2] = buildTools(host2, { approval: approval2, run: insufficient.run })
  const failed = await transfer2.execute({ to: EXTERNAL_ADDRESS, amount: 0.5 }, {})
  assert.match(failed, /Transfer failed \(insufficient_balance\)/)
  assert.equal(asked2.length, 0, 'insufficient balance fails fast, no approval dialog')
  assert.equal(insufficient.calls.filter((call) => call.args[1] === 'transfer').length, 1)
})

test('wallet_transfer channel B without an approval surface: requires explicit acknowledgement', async () => {
  const host = fakeHost()
  const { calls, run } = fakeRun()
  const [, transfer] = buildTools(host, { run })
  const refused = await transfer.execute({ to: EXTERNAL_ADDRESS, amount: 0.5 }, {})
  assert.match(refused, /renders no approval dialog/)
  assert.match(refused, /external_confirmed: true/)
  assert.equal(calls.filter((call) => call.args[1] === 'transfer').length, 1, 'preview only, nothing broadcast')

  const confirmed = await transfer.execute({ to: EXTERNAL_ADDRESS, amount: 0.5, external_confirmed: true }, {})
  assert.match(confirmed, /Transfer broadcast on-chain\./)
  const transferCalls = calls.filter((call) => call.args[1] === 'transfer')
  assert.equal(transferCalls.length, 3)
  assert.equal(transferCalls[2].args.includes('--confirm'), true)
})

test('wallet_transfer approval policy "never" skips the dialog and requires external_confirmed', async () => {
  const approval = {
    request: async () => { throw new Error('the dialog must not spawn when prompts are disabled') },
    overrideOf: () => 'never',
  }
  const { calls, run } = fakeRun()
  const host = fakeHost()
  const [, transfer] = buildTools(host, { approval, run })
  const refused = await transfer.execute({ to: EXTERNAL_ADDRESS, amount: 0.5 }, {})
  assert.match(refused, /external_confirmed: true/)
  assert.match(refused, /Preview of the send:/)
  assert.match(refused, /- amount: 0\.50000000 SPACE/)
  const transferCalls = calls.filter((call) => call.args[1] === 'transfer')
  assert.equal(transferCalls.length, 1, 'preview only, nothing broadcast')
  assert.equal(transferCalls[0].args.includes('--confirm'), false)

  const confirmed = await transfer.execute(
    { to: EXTERNAL_ADDRESS, amount: 0.5, external_confirmed: true },
    {},
  )
  assert.match(confirmed, /Transfer broadcast on-chain\./)
  assert.match(confirmed, /channel: external \(owner-confirmed\)/)
  const after = calls.filter((call) => call.args[1] === 'transfer')
  assert.equal(after.length, 3, 'second leg previews then broadcasts')
  assert.equal(after[2].args.includes('--confirm'), true, 'broadcast only after the explicit acknowledgement')
})

test('wallet_transfer without a session Bot slug refuses to spend', async () => {
  const host = fakeHost({ agentPresets: undefined })
  const { calls, run } = fakeRun()
  const [balance, transfer] = buildTools(host, { run })
  const out = await transfer.execute({ to: 'Alice', amount: 0.5 }, {})
  assert.match(out, /could not determine which Bot owns this session/)
  const balanceOut = await balance.execute({ bots: ['Alice'] }, {})
  assert.match(balanceOut, /- mvc: 5837 sats/, 'explicit bots still work without a session slug')
  assert.equal(calls.filter((call) => call.args[1] === 'transfer').length, 0)
})
