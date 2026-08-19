/**
 * Pure helpers for the Apps settings section, mirroring the OAC
 * `src/ui/pages/apps` page semantics so the DSH panel exposes the same
 * MetaApp protocol fields. No React, no runtime globals — testable.
 */

export const METAAPP_PUBLIC_BASE_URL = 'https://openagentinternet.org/browser/metaapp'

export const METAAPP_PIN_ID_PATTERN = /^[0-9a-f]{64}i0$/iu
export const METAAPP_METAFILE_REFERENCE_PATTERN = /^([0-9a-f]{64}i0)(?:\.[a-z0-9][a-z0-9+-]{0,31})?$/iu

export const METAAPP_RUNTIME_OPTIONS = ['browser', 'android', 'ios', 'windows', 'macOS', 'linux'] as const

export const METAAPP_CONTENT_TYPE_OPTIONS = [
  'application/zip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/gzip',
  'application/json',
  'application/xml',
  'text/plain',
  'text/html',
  'text/css',
  'application/javascript',
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/svg+xml',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
  'application/octet-stream',
] as const

export const METAAPP_CODE_TYPE_OPTIONS = [
  'application/zip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/gzip',
  'application/json',
  'application/xml',
  'text/html',
  'text/css',
  'application/javascript',
] as const

export type MetaAppRuntimeOption = typeof METAAPP_RUNTIME_OPTIONS[number]

export interface MetaAppRecord {
  pinId: string
  firstPinId?: string
  operation?: string
  title?: string
  appName?: string
  prompt?: string
  icon?: string
  coverImg?: string
  introImgs?: unknown
  intro?: string
  runtime?: string
  version?: string
  contentType?: string
  content?: string
  indexFile?: string
  code?: string
  contentHash?: string
  codeType?: string
  metadata?: unknown
  tags?: unknown
  disabled?: boolean
  ownerAddress?: string
  timestamp?: number | null
  txid?: string
  txids?: unknown
  summary?: string
  metaappUri?: string
  metawebUrl?: string
  runUrl?: string
  raw?: Record<string, unknown>
}

export interface MetaAppListPayload {
  records: MetaAppRecord[]
  nextCursor: string
  total: number
}

export function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function recordText(
  record: MetaAppRecord | Record<string, unknown> | undefined | null,
  keys: string[],
  fallback = '',
): string {
  if (!record) return fallback
  for (const key of keys) {
    const value = (record as unknown as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return fallback
}

/** The pin a view/run should target: the versioned pin's first pin root. */
export function recordViewPinId(record: MetaAppRecord | undefined | null): string {
  return recordText(record, ['firstPinId']) || recordText(record, ['pinId'])
}

export function recordPinId(record: MetaAppRecord | undefined | null): string {
  return recordText(record, ['pinId'])
}

export function recordName(record: MetaAppRecord | undefined | null, untitled: string): string {
  return recordText(record, ['title', 'appName']) || recordText(record, ['pinId']) || untitled
}

export function recordSubtitle(record: MetaAppRecord | undefined | null): string {
  const version = recordText(record, ['version'])
  const runtime = recordText(record, ['runtime'])
  return [version, runtime].filter(Boolean).join(' / ')
}

export function splitList(value: unknown): string[] {
  return textOf(value).split(/[\n,]/u).map((item) => item.trim()).filter(Boolean)
}

export function recordTags(record: MetaAppRecord | undefined | null, limit = 4): string[] {
  if (!record) return []
  const raw = record.tags
  if (Array.isArray(raw)) {
    return raw.map((item) => textOf(item)).filter(Boolean).slice(0, limit)
  }
  return splitList(raw).slice(0, limit)
}

export function recordRuntimeList(record: MetaAppRecord | undefined | null): string[] {
  return textOf(record?.runtime).split('/').map((item) => item.trim()).filter(Boolean)
}

export function recordIntroImages(record: MetaAppRecord | undefined | null): string[] {
  const raw = record?.introImgs
  if (Array.isArray(raw)) return raw.map((item) => textOf(item)).filter(Boolean)
  return splitList(raw)
}

export function recordImage(record: MetaAppRecord | undefined | null, keys: string[]): string {
  for (const key of keys) {
    const value = recordText(record, [key])
    if (value) return value
  }
  return ''
}

/** Asset content resolves through the metafile indexer. */
const METAAPP_FILE_BASE_URL = 'https://file.metaid.io/metafile-indexer'

/** Keep http(s) assets renderable directly; everything else is a pin ref. */
export function isHttpUrl(value: string): boolean {
  const lower = value.trim().toLowerCase()
  return lower.startsWith('http://') || lower.startsWith('https://')
}

const PIN_CONTENT_PATH_PREFIXES = [
  '/content/',
  '/metafile-indexer/thumbnail/',
  '/metafile-indexer/api/v1/files/content/',
  '/metafile-indexer/api/v1/files/accelerate/content/',
  '/metafile-indexer/api/v1/users/avatar/accelerate/',
] as const

/**
 * Extract a bare MetaApp asset pin id (`<64hex>i0`) from any of the reference
 * shapes the protocol stores: a `metafile://` URI, a bare pin (with optional
 * file extension), or a metafile-indexer content path. Mirrors the OAC
 * daemon's `extractAvatarPinId`.
 */
export function pinRefFromValue(value: unknown): string {
  const raw = textOf(value)
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return ''
  if (/^https?:\/\//iu.test(raw)) {
    try {
      const pathname = new URL(raw).pathname
      return extractPinFromPath(pathname)
    } catch {
      return ''
    }
  }
  let ref = raw
  if (/^metafile:\/\//iu.test(ref)) ref = ref.slice('metafile://'.length).trim()
  ref = extractPinFromPath(ref.split(/[?#]/u)[0] ?? ref)
  return ref
}

function extractPinFromPath(path: string): string {
  let candidate = path
  for (const prefix of PIN_CONTENT_PATH_PREFIXES) {
    if (candidate.toLowerCase().startsWith(prefix)) {
      candidate = decodeURIComponent(candidate.slice(prefix.length))
      break
    }
  }
  const match = candidate.match(METAAPP_METAFILE_REFERENCE_PATTERN)
  return match?.[1] ?? ''
}

/**
 * Ordered candidate URLs for an asset image, tried in order by the renderer
 * (content first, then the accelerate thumbnail). data:/blob: and http(s)
 * values pass through unchanged.
 */
export function imageUrlCandidates(value: unknown): string[] {
  const raw = textOf(value)
  if (!raw) return []
  if (/^(data:|blob:)/iu.test(raw)) return [raw]
  if (isHttpUrl(raw)) return [raw]
  const pin = pinRefFromValue(raw)
  if (!pin) return []
  const encoded = encodeURIComponent(pin)
  return [
    `${METAAPP_FILE_BASE_URL}/api/v1/files/content/${encoded}`,
    `${METAAPP_FILE_BASE_URL}/api/v1/files/accelerate/content/${encoded}?process=thumbnail`,
  ]
}

/** First resolvable image URL for a ref, or '' when nothing can be shown. */
export function imageUrlForReference(value: string): string {
  return imageUrlCandidates(value)[0] ?? ''
}

/** e.g. `v1.0.0` -> `v1.1.0`, `v1` -> `v2`, missing -> `v1.0.0`. */
export function bumpVersion(value: string): string {
  const text = textOf(value) || 'v1.0.0'
  const match = text.match(/^(.*?)(\d+)(\D*)$/u)
  if (!match) return `${text}.1`
  return match[1] + String(Number(match[2]) + 1) + match[3]
}

export function metaAppUriFor(record: MetaAppRecord | undefined | null): string {
  return recordText(record, ['metaappUri']) || `metaapp://${recordViewPinId(record)}`
}

export function metaWebUrlFor(record: MetaAppRecord | undefined | null): string {
  const pinId = recordViewPinId(record)
  return pinId ? `${METAAPP_PUBLIC_BASE_URL}/${encodeURIComponent(pinId)}` : recordText(record, ['metawebUrl'])
}

export function runUrlFor(record: MetaAppRecord | undefined | null): string {
  return recordText(record, ['runUrl']) || recordText(record, ['metawebUrl']) || metaWebUrlFor(record)
}

export function formatTimestamp(value: unknown): string {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return '-'
  const ms = number < 1_000_000_000_000 ? number * 1000 : number
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toISOString()
}

/** Display value for detail rows: arrays join with newlines, objects pretty-print. */
export function displayValue(value: unknown): string {
  if (Array.isArray(value)) {
    const text = value.map((item) => textOf(item)).filter(Boolean).join('\n')
    return text || '-'
  }
  if (value !== null && typeof value === 'object') return JSON.stringify(value, null, 2)
  return textOf(value) || (value === 0 ? '0' : '-')
}

export function chainTxids(record: unknown): string[] {
  const txids: string[] = []
  const push = (value: unknown): void => {
    const text = textOf(value)
    if (text && !txids.includes(text)) txids.push(text)
  }
  if (record !== null && typeof record === 'object') {
    const chainWrite = (record as { chainWrite?: unknown }).chainWrite
    if (chainWrite !== null && typeof chainWrite === 'object' && !Array.isArray(chainWrite)) {
      const rows = (chainWrite as { txids?: unknown }).txids
      if (Array.isArray(rows)) rows.forEach(push)
      push((chainWrite as { txid?: unknown }).txid)
    }
    const rows = (record as { txids?: unknown }).txids
    if (Array.isArray(rows)) rows.forEach(push)
    push((record as { txid?: unknown }).txid)
  }
  return txids
}

function stripMetafilePrefix(value: string): string {
  const text = textOf(value)
  return text.toLowerCase().startsWith('metafile://') ? text.slice('metafile://'.length).trim() : text
}

/**
 * Canonicalize a user-entered pin reference to `metafile://<pinId>`.
 * Throws when the reference is not a valid MetaApp pin id.
 */
export function normalizeMetafileReference(value: string, label: string): string {
  const raw = textOf(value)
  if (!raw) return ''
  const reference = stripMetafilePrefix(raw).split(/[?#]/u)[0].trim()
  if (!METAAPP_METAFILE_REFERENCE_PATTERN.test(reference)) {
    throw new Error(`${label} must be a MetaID pin id or a metafile://<pin> reference.`)
  }
  return `metafile://${reference}`
}

export function normalizeMetafileList(value: unknown, label: string): string[] {
  return splitList(textOf(value)).map((item) => normalizeMetafileReference(item, label)).filter(Boolean)
}

/** Image assets may also be plain http(s) URLs; other assets must be pin refs. */
export function normalizeImageReference(value: string, label: string): string {
  const raw = textOf(value)
  if (!raw) return ''
  if (isHttpUrl(raw)) return raw
  return normalizeMetafileReference(raw, label)
}

export function normalizeImageList(value: unknown, label: string): string[] {
  return splitList(textOf(value)).map((item) => normalizeImageReference(item, label)).filter(Boolean)
}

export function normalizeRuntimeSelection(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : textOf(value).split(/[\\/,\n]/u)
  const values = raw.map((item) => textOf(item)).filter(Boolean)
  return values.length > 0 ? [...new Set(values)] : ['browser']
}

export function metadataFromInput(value: string): Record<string, unknown> {
  const raw = textOf(value)
  if (!raw) return {}
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Metadata must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

export function metadataToInput(record: MetaAppRecord | undefined | null): string {
  const metadata = record?.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return ''
  return JSON.stringify(metadata, null, 2)
}


