/**
 * Pure helpers and payload types for the Traffic (流量) settings section,
 * ported from IDBots `components/traffic/formatTraffic.ts`,
 * `services/trafficSettings.ts` (normalizeTrafficApiBase), and the label maps
 * of `TrafficSettings.tsx`. No React, no runtime globals — testable. The CLI
 * verbs (`metabot traffic *`) own the data; nothing here talks to the network.
 */

/**
 * Decimal traffic units used by the Settings → Traffic panel.
 * Product contract: 1000 bytes = 1 KB, 1_000_000 bytes = 1 MB
 * (not the 1024-based KiB/MiB scale).
 */
export const TRAFFIC_BYTES_PER_KB = 1000
export const TRAFFIC_BYTES_PER_MB = 1_000_000
/** Low-balance banner threshold (5 MB). */
export const TRAFFIC_LOW_BALANCE_BYTES = 5 * TRAFFIC_BYTES_PER_MB
/** Fallback grant size when campaign status has not returned grantBytes. */
export const DEFAULT_FREE_GRANT_BYTES = 10 * TRAFFIC_BYTES_PER_MB

export type TrafficDisplayUnit = 'bytes' | 'kb' | 'mb'

export function splitTrafficAmount(bytes: number): { amount: string; unit: TrafficDisplayUnit } {
  const abs = Math.abs(bytes)
  if (abs < TRAFFIC_BYTES_PER_KB) {
    return { amount: String(bytes), unit: 'bytes' }
  }
  if (abs < TRAFFIC_BYTES_PER_MB) {
    return { amount: formatScaled(bytes / TRAFFIC_BYTES_PER_KB), unit: 'kb' }
  }
  return { amount: formatScaled(bytes / TRAFFIC_BYTES_PER_MB, { roundAt: 100 }), unit: 'mb' }
}

function formatScaled(value: number, options: { roundAt?: number } = {}): string {
  if (options.roundAt !== undefined && Math.abs(value) >= options.roundAt) {
    return String(Math.round(value))
  }
  if (Number.isInteger(value)) {
    return String(value)
  }
  return value.toFixed(1)
}

/** `1Kabc…xyz123`-style middle elision for addresses and txids. */
export function shortTrafficAddress(address: string): string {
  const text = String(address || '')
  return text.length > 16 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text
}

/** Deterministic local-time ledger timestamp (YYYY-MM-DD HH:mm:ss). */
export function formatTrafficLedgerTimestamp(timestamp: number): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

// Ledger direction values delivered by the backend (models/traffic_ledger_model.go).
export const TRAFFIC_LEDGER_DIRECTION_KEYS: Record<number, string> = {
  1: 'trafficLedgerCredit',
  2: 'trafficLedgerSpend',
  3: 'trafficLedgerReserve',
  4: 'trafficLedgerRelease',
}

// Locally journaled pin paths mapped to friendly business names; anything
// else falls back to a shortened raw path in the panel.
export const TRAFFIC_LEDGER_KIND_KEYS: Record<string, string> = {
  '/protocols/simplemsg': 'trafficKindSimplemsg',
  '/protocols/simplebuzz': 'trafficKindSimplebuzz',
  '/file': 'trafficKindFile',
}

// Ledger credit sourceType values mapped to friendly labels.
export const TRAFFIC_LEDGER_SOURCE_TYPE_KEYS: Record<string, string> = {
  free_grant: 'trafficSourceFreeGrant',
  recharge_code: 'trafficSourceRechargeCode',
}

// Backend data.errorCode values mapped to friendly locale keys.
export const TRAFFIC_ERROR_CODE_KEYS: Record<string, string> = {
  CAMPAIGN_DISABLED: 'trafficErrCampaignDisabled',
  ALREADY_CLAIMED: 'trafficErrAlreadyClaimed',
  CLIENT_NOT_ALLOWED: 'trafficErrClientNotAllowed',
  CODE_NOT_FOUND: 'trafficErrCodeNotFound',
  CODE_USED: 'trafficErrCodeUsed',
  CODE_DISABLED: 'trafficErrCodeDisabled',
  CODE_EXPIRED: 'trafficErrCodeExpired',
}

/** Locale key for a backend `data.errorCode`, undefined when unmapped. */
export function trafficErrorLocaleKey(errorCode: string | undefined): string | undefined {
  if (!errorCode) return undefined
  return TRAFFIC_ERROR_CODE_KEYS[errorCode]
}

// Network failures surface as raw TypeError text such as "fetch failed";
// match those so users get the friendly copy instead.
export const TRAFFIC_NETWORK_ERROR_PATTERN =
  /fetch failed|failed to fetch|networkerror|network request failed|econnrefused|enotfound|etimedout|econnreset|socket hang up/i

export function isTrafficNetworkError(text: string): boolean {
  return TRAFFIC_NETWORK_ERROR_PATTERN.test(text)
}

/** Structural read of a backend errorCode off a thrown envelope error. */
export function trafficErrorCodeOf(cause: unknown): string | undefined {
  if (cause === null || typeof cause !== 'object') return undefined
  const data = (cause as { data?: unknown }).data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  const errorCode = (data as { errorCode?: unknown }).errorCode
  return typeof errorCode === 'string' && errorCode !== '' ? errorCode : undefined
}

/**
 * Normalize an apiBase override for persistence: trims, strips trailing
 * slashes, '' clears the override. Throws on anything that is not an
 * http(s) URL (callers surface the error and must not persist).
 * Verbatim port of IDBots trafficSettings.ts normalizeTrafficApiBase.
 */
export function normalizeTrafficApiBase(value: unknown): string {
  const text = String(value ?? '').trim().replace(/\/+$/, '')
  if (!text) return ''
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new Error('traffic.apiBase must be a valid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('traffic.apiBase must use http or https')
  }
  return text
}

// ---------------------------------------------------------------------------
// `metabot traffic *` payload shapes (the CLI owns these).
// ---------------------------------------------------------------------------

export type TrafficMode = 'traffic' | 'selfpay'

export type TrafficAccountRecord = {
  accountId: string
  identityAddress: string
  balanceBytes: number
  reservedBytes: number
  grantedBytesTotal: number
  spentBytesTotal: number
  status: number
}

export type TrafficFreeGrantInfo = {
  enabled: boolean
  grantBytes: number
  claimed: boolean
  claimable: boolean
}

export type TrafficIdentityInfo = {
  name: string
  globalMetaId: string
  mvcAddress: string
}

/** `metabot traffic status`. */
export type TrafficStatusPayload = {
  mode: TrafficMode
  apiBase: string
  account: TrafficAccountRecord | null
  freeGrant: TrafficFreeGrantInfo | null
  featureUnavailable: boolean
  identity: TrafficIdentityInfo | null
}

export type TrafficBindResultRow = {
  botAddress: string
  status: 'bound' | 'conflict' | 'failed'
  error?: string
}

export type TrafficBindSummary = {
  accountId: string
  boundCount: number
  conflictCount: number
  failedCount: number
  results: TrafficBindResultRow[]
}

/** `metabot traffic mode [traffic|selfpay]`; bindSummary only on the traffic switch. */
export type TrafficModePayload = {
  mode: TrafficMode
  bindSummary?: TrafficBindSummary
}

/** `metabot traffic balance`. */
export type TrafficBalancePayload = {
  account: TrafficAccountRecord | null
  featureUnavailable: boolean
}

export type TrafficLedgerEntry = {
  id: number
  direction: number
  amountBytes: number
  balanceAfter: number
  sourceType: string
  sourceId: string
  remark: string
  timestamp: number
  /** Local-journal enrichment (this-device sponsored commits only). */
  txId?: string
  botAddress?: string
  botName?: string
  kind?: string
}

/** `metabot traffic ledger --cursor <c> --limit <n>`. */
export type TrafficLedgerPayload = {
  entries: TrafficLedgerEntry[]
  nextCursor: string | null
}

export type TrafficUsageSummary = {
  todayBytes: number
  weekBytes: number
  monthBytes: number
}

export type TrafficUsageRow = {
  date: string
  botAddress: string
  botName?: string
  bytes: number
  txCount: number
}

/** `metabot traffic usage`; source 'local' = CLI journal fallback, 'unavailable' = nothing to show. */
export type TrafficUsagePayload = {
  summary: TrafficUsageSummary | null
  daily: TrafficUsageRow[]
  source: 'service' | 'local' | 'unavailable'
}

/** `metabot traffic claim`. */
export type TrafficClaimPayload = {
  grantId: string
  grantBytes: number
  balanceAfter: number
}

/** `metabot traffic redeem <code>`. */
export type TrafficRedeemPayload = {
  codeId: number
  trafficBytes: number
  balanceAfter: number
}

/** `metabot traffic api-base [get|set <url>|reset]`. */
export type TrafficApiBasePayload = {
  apiBase: string
  effectiveApiBase: string
}
