/**
 * Thin client for the metaso-p2p MetaWeb generic pin-read API:
 * GET /api/metaweb/pin/:pinId. Same conventions as the other aggregation
 * APIs: {code, data, message} envelope, HTTP always 200, business error codes
 * 40000/40400/50000. OAC port of the IDBots metawebPinService.
 *
 * The caller does not know the pin's protocol in advance: the server
 * dispatches across its local index namespaces and falls back to MANAPI
 * passthrough (`source: "remote"`) when the pin is not locally indexed. Any
 * version of a pin id is accepted; the response resolves `currentPinId` to
 * the latest known version.
 */

export const DEFAULT_METAWEB_PIN_BASE_URL = 'https://so.metaid.io';
const DEFAULT_TIMEOUT_MS = 10_000;

export type MetawebPinCreator = {
  globalMetaId: string;
  metaid: string;
  /** Best-effort profile enrichment; empty when unknown. */
  name: string;
  address: string;
};

export type MetawebPinAttachment = {
  /** Original metafile:// URI as stored in the payload. */
  uri: string;
  /** Absolute fetchable URL, resolved server-side. */
  url: string;
  contentType: string;
  /** Bytes; null when unknown. */
  size: number | null;
};

export type MetawebPinMeta = {
  title: string;
  summary: string;
  tags: string[];
};

export type MetawebPin = {
  /** The id as requested. */
  pinId: string;
  /** Latest known version in the modify chain. */
  currentPinId: string;
  /** Protocol key (e.g. 'simplenote'); for unknown remote paths, the last path segment. */
  protocol: string;
  /** Full on-chain path, e.g. '/protocols/simplenote'. */
  path: string;
  chainName: string;
  /** 'create' | 'modify' | 'revoke'. */
  operation: string;
  creator: MetawebPinCreator;
  /** Unix seconds. */
  createdAt: number;
  contentType: string;
  /** Decoded JSON object, raw string for plain-text bodies, or null (empty/binary/encrypted). */
  payload: unknown;
  /** LLM-ready normalized body (markdown); null when empty/binary/encrypted — skip such pins. */
  text: string | null;
  /** Present when text is non-null; true means the server capped the body (see totalLength). */
  truncated: boolean | null;
  /** Full body rune count; null when text is null. */
  totalLength: number | null;
  /** Same title/summary/tags extraction as unified search (shared server code path). */
  meta: MetawebPinMeta;
  attachments: MetawebPinAttachment[];
  /** 'local' = node index; 'remote' = MANAPI passthrough. */
  source: string;
};

export class MetawebPinNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetawebPinNotFoundError';
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function normalizeCreator(raw: unknown): MetawebPinCreator {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    globalMetaId: text(record.globalMetaId),
    metaid: text(record.metaid ?? record.metaId),
    name: text(record.name),
    address: text(record.address),
  };
}

function normalizeAttachment(raw: unknown): MetawebPinAttachment {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const size = Number(record.size);
  return {
    uri: text(record.uri),
    url: text(record.url),
    contentType: text(record.contentType),
    size: Number.isFinite(size) && size > 0 ? size : null,
  };
}

function normalizeMeta(raw: unknown): MetawebPinMeta {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    title: text(record.title),
    summary: text(record.summary),
    tags: textList(record.tags),
  };
}

function normalizePin(raw: unknown): MetawebPin {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const textValue = typeof record.text === 'string' ? record.text : null;
  return {
    pinId: text(record.pinId),
    currentPinId: text(record.currentPinId) || text(record.pinId),
    protocol: text(record.protocol),
    path: text(record.path),
    chainName: text(record.chainName),
    operation: text(record.operation) || 'create',
    creator: normalizeCreator(record.creator),
    createdAt: Number(record.createdAt) || 0,
    contentType: text(record.contentType),
    payload: record.payload ?? null,
    text: textValue,
    truncated: textValue != null ? record.truncated === true : null,
    totalLength: textValue != null && Number.isFinite(Number(record.totalLength)) ? Number(record.totalLength) : null,
    meta: normalizeMeta(record.meta),
    attachments: Array.isArray(record.attachments) ? record.attachments.map(normalizeAttachment) : [],
    source: text(record.source) || 'local',
  };
}

async function fetchApiData(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      // Map the raw AbortError to an actionable timeout message — the model
      // sees this text verbatim in the tool result.
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`MetaWeb pin-read API timed out after ${Math.round(timeoutMs / 1000)}s — try again later.`);
      }
      throw error;
    }
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      throw new Error(`MetaWeb pin-read API returned an invalid response (HTTP ${response.status}).`);
    }
    const code = Number(body.code);
    if (code === 0) {
      return (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
    }
    const message = text(body.message) || 'unknown error';
    if (code === 40400) {
      throw new MetawebPinNotFoundError(message);
    }
    throw new Error(`MetaWeb pin-read API error ${code}: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

export type MetawebPinServiceOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function resolveOptions(options: MetawebPinServiceOptions | undefined): Required<MetawebPinServiceOptions> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for MetaWeb pin read.');
  }
  return {
    baseUrl: (options?.baseUrl ?? DEFAULT_METAWEB_PIN_BASE_URL).replace(/\/+$/, ''),
    fetchImpl,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/** GET /api/metaweb/pin/:pinId — generic pin read; any version id resolves to the latest known version. */
export async function readMetawebPin(
  pinId: string,
  options?: MetawebPinServiceOptions,
): Promise<MetawebPin> {
  const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
  const trimmed = pinId.trim();
  if (!trimmed) throw new Error('pinId is required to read a MetaWeb pin.');
  const data = await fetchApiData(`${baseUrl}/api/metaweb/pin/${encodeURIComponent(trimmed)}`, fetchImpl, timeoutMs);
  return normalizePin(data);
}
