import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = await import('../lib/index.js')
const traffic = await import('../lib/traffic.js')

async function capture(method, payload) {
  const calls = []
  const result = await plugin.dispatchSection(method, payload, async (args) => {
    calls.push(args)
    return { ok: true, state: 'success', data: { args } }
  })
  return { result, calls }
}

// --- locale: en/zh key parity + the verbatim IDBots copy anchors ----------

function objectKeys(block) {
  return [...block.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1])
}

test('traffic locale en and zh dictionaries stay in sync', async () => {
  const text = await readFile(join(root, 'src/client/locale-traffic.ts'), 'utf8')
  const en = text.slice(text.indexOf('export const trafficEn = {'), text.indexOf('export const trafficZh = {'))
  const zh = text.slice(text.indexOf('export const trafficZh = {'), text.indexOf('export type TrafficLocaleKey'))
  assert.deepEqual(objectKeys(en).sort(), objectKeys(zh).sort())
  assert.match(text, /nav: 'Traffic'/)
  assert.match(text, /nav: '流量'/)
  assert.match(text, /TRAFFIC_NS = 'settings\.oac\.traffic'/)
  // Every backend data.errorCode the panel maps must have copy in the dictionary.
  for (const key of Object.values(traffic.TRAFFIC_ERROR_CODE_KEYS)) {
    assert.match(text, new RegExp(`${key}:`), `missing locale key ${key}`)
  }
  // Ledger direction / kind / source maps too.
  for (const key of [
    ...Object.values(traffic.TRAFFIC_LEDGER_DIRECTION_KEYS),
    ...Object.values(traffic.TRAFFIC_LEDGER_KIND_KEYS),
    ...Object.values(traffic.TRAFFIC_LEDGER_SOURCE_TYPE_KEYS),
  ]) {
    assert.match(text, new RegExp(`${key}:`), `missing locale key ${key}`)
  }
})

// --- client registration ---------------------------------------------------

test('client registers the traffic settings section right after apps', async () => {
  const text = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  assert.match(text, /id: 'oac-traffic'/)
  assert.match(text, /order: 24/)
  assert.match(text, /'settings\.oac\.traffic': TrafficLocaleKey/)
  assert.match(text, /ctx\.locale\.register\(TRAFFIC_NS, \{ zh: trafficZh, en: trafficEn \}\)/)
  assert.match(text, /ctx\.locale\.bind\(TRAFFIC_NS\)/)
  assert.match(text, /APPS_CSS \+ TRAFFIC_CSS/)
  assert.ok(
    text.indexOf("id: 'oac-apps'") < text.indexOf("id: 'oac-traffic'"),
    'oac-traffic registers after oac-apps',
  )
})

// --- host route dispatch (CLI bridge mocked) --------------------------------

test('traffic status/balance/usage/claim forward to the CLI verbs', async () => {
  assert.deepEqual((await capture('traffic/status', {})).calls[0], ['traffic', 'status'])
  assert.deepEqual((await capture('traffic/balance', {})).calls[0], ['traffic', 'balance'])
  assert.deepEqual((await capture('traffic/usage', {})).calls[0], ['traffic', 'usage'])
  assert.deepEqual((await capture('traffic/claim', {})).calls[0], ['traffic', 'claim'])
})

test('traffic mode validates the mode and forwards it positionally', async () => {
  assert.deepEqual((await capture('traffic/mode', {})).calls[0], ['traffic', 'mode'])
  assert.deepEqual((await capture('traffic/mode', { mode: 'traffic' })).calls[0], ['traffic', 'mode', 'traffic'])
  assert.deepEqual((await capture('traffic/mode', { mode: 'selfpay' })).calls[0], ['traffic', 'mode', 'selfpay'])
  const invalid = await capture('traffic/mode', { mode: 'bogus' })
  assert.equal(invalid.calls.length, 0)
  assert.equal(invalid.result.code, 'invalid_mode')
})

test('traffic ledger passes --limit and --cursor', async () => {
  assert.deepEqual((await capture('traffic/ledger', {})).calls[0], ['traffic', 'ledger', '--limit', '20'])
  assert.deepEqual(
    (await capture('traffic/ledger', { cursor: '42', limit: 50 })).calls[0],
    ['traffic', 'ledger', '--limit', '50', '--cursor', '42'],
  )
  assert.deepEqual(
    (await capture('traffic/ledger', { limit: 'not-a-number' })).calls[0],
    ['traffic', 'ledger', '--limit', '20'],
  )
})

test('traffic redeem requires a code and forwards it positionally', async () => {
  const missing = await capture('traffic/redeem', {})
  assert.equal(missing.calls.length, 0)
  assert.equal(missing.result.code, 'missing_code')
  assert.deepEqual((await capture('traffic/redeem', { code: 'IDB-XXXX' })).calls[0], ['traffic', 'redeem', 'IDB-XXXX'])
})

test('traffic api-base get/reset/set, with set validated before spawning', async () => {
  assert.deepEqual((await capture('traffic/api-base', {})).calls[0], ['traffic', 'api-base'])
  assert.deepEqual((await capture('traffic/api-base', { action: 'get' })).calls[0], ['traffic', 'api-base'])
  assert.deepEqual((await capture('traffic/api-base', { action: 'reset' })).calls[0], ['traffic', 'api-base', 'reset'])
  // Trailing slashes are stripped by normalizeTrafficApiBase before the CLI sees it.
  assert.deepEqual(
    (await capture('traffic/api-base', { action: 'set', value: ' https://traffic.example.com/assist-open-api/ ' })).calls[0],
    ['traffic', 'api-base', 'set', 'https://traffic.example.com/assist-open-api'],
  )
  const badScheme = await capture('traffic/api-base', { action: 'set', value: 'ftp://traffic.example.com' })
  assert.equal(badScheme.calls.length, 0)
  assert.equal(badScheme.result.code, 'invalid_api_base')
  const notUrl = await capture('traffic/api-base', { action: 'set', value: 'not a url' })
  assert.equal(notUrl.calls.length, 0)
  assert.equal(notUrl.result.code, 'invalid_api_base')
  const empty = await capture('traffic/api-base', { action: 'set', value: '  ' })
  assert.equal(empty.calls.length, 0)
  assert.equal(empty.result.code, 'missing_value')
  const badAction = await capture('traffic/api-base', { action: 'bogus' })
  assert.equal(badAction.calls.length, 0)
  assert.equal(badAction.result.code, 'invalid_action')
})

// --- pure helpers (lib/traffic.js) ------------------------------------------

test('splitTrafficAmount scales decimal 1000-based units like IDBots', () => {
  assert.deepEqual(traffic.splitTrafficAmount(0), { amount: '0', unit: 'bytes' })
  assert.deepEqual(traffic.splitTrafficAmount(500), { amount: '500', unit: 'bytes' })
  assert.deepEqual(traffic.splitTrafficAmount(999), { amount: '999', unit: 'bytes' })
  assert.deepEqual(traffic.splitTrafficAmount(1000), { amount: '1', unit: 'kb' })
  assert.deepEqual(traffic.splitTrafficAmount(1500), { amount: '1.5', unit: 'kb' })
  assert.deepEqual(traffic.splitTrafficAmount(10_000), { amount: '10', unit: 'kb' })
  assert.deepEqual(traffic.splitTrafficAmount(999_500), { amount: '999.5', unit: 'kb' })
  assert.deepEqual(traffic.splitTrafficAmount(1_000_000), { amount: '1', unit: 'mb' })
  assert.deepEqual(traffic.splitTrafficAmount(1_500_000), { amount: '1.5', unit: 'mb' })
  assert.deepEqual(traffic.splitTrafficAmount(123_456_789), { amount: '123', unit: 'mb' })
  assert.deepEqual(traffic.splitTrafficAmount(-1500), { amount: '-1.5', unit: 'kb' })
})

test('traffic thresholds match the IDBots product contract', () => {
  assert.equal(traffic.TRAFFIC_LOW_BALANCE_BYTES, 5_000_000)
  assert.equal(traffic.DEFAULT_FREE_GRANT_BYTES, 10_000_000)
})

test('trafficErrorLocaleKey maps every backend errorCode and passes unknown through', () => {
  assert.deepEqual(Object.keys(traffic.TRAFFIC_ERROR_CODE_KEYS).sort(), [
    'ALREADY_CLAIMED',
    'CAMPAIGN_DISABLED',
    'CLIENT_NOT_ALLOWED',
    'CODE_DISABLED',
    'CODE_EXPIRED',
    'CODE_NOT_FOUND',
    'CODE_USED',
  ])
  assert.equal(traffic.trafficErrorLocaleKey('ALREADY_CLAIMED'), 'trafficErrAlreadyClaimed')
  assert.equal(traffic.trafficErrorLocaleKey('CODE_EXPIRED'), 'trafficErrCodeExpired')
  assert.equal(traffic.trafficErrorLocaleKey('SOMETHING_ELSE'), undefined)
  assert.equal(traffic.trafficErrorLocaleKey(undefined), undefined)
})

test('trafficErrorCodeOf reads data.errorCode structurally off thrown errors', () => {
  const error = Object.assign(new Error('redeem failed'), { data: { errorCode: 'CODE_USED' } })
  assert.equal(traffic.trafficErrorCodeOf(error), 'CODE_USED')
  assert.equal(traffic.trafficErrorCodeOf(new Error('plain')), undefined)
  assert.equal(traffic.trafficErrorCodeOf(null), undefined)
  assert.equal(traffic.trafficErrorCodeOf({ data: { errorCode: '' } }), undefined)
})

test('isTrafficNetworkError matches raw fetch/socket failures only', () => {
  assert.equal(traffic.isTrafficNetworkError('TypeError: fetch failed'), true)
  assert.equal(traffic.isTrafficNetworkError('connect ECONNREFUSED 127.0.0.1'), true)
  assert.equal(traffic.isTrafficNetworkError('network request failed'), true)
  assert.equal(traffic.isTrafficNetworkError('recharge code disabled'), false)
  assert.equal(traffic.isTrafficNetworkError(''), false)
})

test('normalizeTrafficApiBase trims, strips trailing slashes, and validates http(s)', () => {
  assert.equal(traffic.normalizeTrafficApiBase(' https://x.test/assist-open-api/ '), 'https://x.test/assist-open-api')
  assert.equal(traffic.normalizeTrafficApiBase('http://127.0.0.1:8080'), 'http://127.0.0.1:8080')
  assert.equal(traffic.normalizeTrafficApiBase(''), '')
  assert.equal(traffic.normalizeTrafficApiBase('   '), '')
  assert.equal(traffic.normalizeTrafficApiBase(undefined), '')
  assert.throws(() => traffic.normalizeTrafficApiBase('not a url'), /valid URL/)
  assert.throws(() => traffic.normalizeTrafficApiBase('ftp://x.test'), /http or https/)
})

test('shortTrafficAddress and formatTrafficLedgerTimestamp format like IDBots', () => {
  assert.equal(traffic.shortTrafficAddress('short'), 'short')
  assert.equal(traffic.shortTrafficAddress('0123456789abcdef0123456789abcdef'), '01234567…abcdef')
  assert.equal(traffic.formatTrafficLedgerTimestamp(0), '—')
  assert.equal(traffic.formatTrafficLedgerTimestamp(Number.NaN), '—')
  assert.match(traffic.formatTrafficLedgerTimestamp(1_700_000_000_000), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
})
