const DEFAULT_ASSIST_OPEN_API_BASE_URL = 'https://www.metaso.network/assist-open-api';

type FetchResponseLike = {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
};

type FetchRequestInitLike = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

type FetchImpl = (input: string, init?: FetchRequestInitLike) => Promise<FetchResponseLike>;

type SponsorStage = 'address_info' | 'challenge' | 'pre' | 'commit';
export type SponsorReason =
  | 'insufficient_quota'
  | 'insufficient_traffic'
  | 'service_unavailable'
  | 'commit_failed'
  | 'pre_rejected'
  | 'invalid_request';

/** Backend error code (delivered as data.errorCode) for traffic-account exhaustion. */
const TRAFFIC_INSUFFICIENT_ERROR_CODE = 'TRAFFIC_INSUFFICIENT';

const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_DELAYS_MS = [250, 750] as const;

export interface MvcSponsorV2ClientError extends Error {
  code: string;
  stage: SponsorStage;
  reason: SponsorReason;
  serviceMessage: string;
  status?: number;
  data?: unknown;
  retryable?: boolean;
}

export interface MvcSponsorAddressInfo {
  exists: boolean;
  balance: number;
  grantedAmount: number;
  reservedAmount: number;
  spentAmount: number;
  availableAmount: number;
  status: string;
  raw: Record<string, unknown>;
}

export interface MvcSponsorChallenge {
  challengeId: string;
  message: string;
  expiresAt?: string;
  raw: Record<string, unknown>;
}

export interface MvcSponsorPreResult {
  preparedTxHex: string;
  orderId: string;
  minerFee: number;
  userInputIndexes: number[];
  expiresAt?: string;
  raw: Record<string, unknown>;
}

export interface MvcSponsorCommitResult {
  txId: string;
  txSize?: number;
  minerFee?: number;
  raw: Record<string, unknown>;
}

/** trafficAccount block attached to a sponsor pre call (traffic-account billing). */
export interface MvcSponsorTrafficAccount {
  accountId: string;
  authSignature: string;
  timestamp: number;
}

export interface MvcSponsorOrder {
  orderId: string;
  status: string;
  txId?: string;
  txSize: number;
  minerFee: number;
  pending: boolean;
  final: boolean;
  failureReason?: string;
  raw: Record<string, unknown>;
}

export interface CreateMvcSponsorV2ClientInput {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  retryDelaysMs?: number[];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function normalizeBaseUrl(value: unknown): string {
  const text = normalizeText(value);
  return (text || DEFAULT_ASSIST_OPEN_API_BASE_URL).replace(/\/+$/, '');
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pickText(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = normalizeText(record[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function normalizeReason(stage: SponsorStage, message: string): SponsorReason {
  if (/TRAFFIC_INSUFFICIENT/i.test(message)) {
    return 'insufficient_traffic';
  }
  if (/available amount not enough|quota not granted|insufficient quota|insufficient balance/i.test(message)) {
    return 'insufficient_quota';
  }
  if (stage === 'pre' && /\b(address not match|txin empty|tx in empty|rejected|invalid tx|invalid transaction|first input)\b/i.test(message)) {
    return 'pre_rejected';
  }
  if (stage === 'commit' || /commit/i.test(message)) {
    return 'commit_failed';
  }
  return 'service_unavailable';
}

function normalizeErrorCodeReason(code: unknown): SponsorReason | undefined {
  return normalizeText(code).toUpperCase() === TRAFFIC_INSUFFICIENT_ERROR_CODE
    ? 'insufficient_traffic'
    : undefined;
}

function createSponsorError(stage: SponsorStage, message: string, extra: {
  status?: number;
  data?: unknown;
  reason?: SponsorReason;
  retryable?: boolean;
} = {}): MvcSponsorV2ClientError {
  const serviceMessage = normalizeText(message) || `MVC sponsor ${stage} failed.`;
  const error = new Error(serviceMessage) as MvcSponsorV2ClientError;
  error.code = `mvc_fee_assist_${stage}_failed`;
  error.stage = stage;
  error.reason = extra.reason ?? normalizeReason(stage, serviceMessage);
  error.serviceMessage = serviceMessage;
  if (extra.status !== undefined) {
    error.status = extra.status;
  }
  if (extra.data !== undefined) {
    error.data = extra.data;
  }
  if (extra.retryable !== undefined) {
    error.retryable = extra.retryable;
  }
  return error;
}

function unwrapEnvelope(body: unknown, stage: SponsorStage): Record<string, unknown> {
  const record = readObject(body);
  if (!record) {
    throw createSponsorError(stage, 'Sponsor service returned a non-object response.');
  }

  if (!('code' in record)) {
    return record;
  }

  const code = Number(record.code);
  if (Number.isFinite(code) && code === 0) {
    const data = readObject(record.data);
    if (!data) {
      throw createSponsorError(stage, 'Sponsor service returned an empty data payload.', {
        data: record.data,
      });
    }
    return data;
  }

  throw createSponsorError(
    stage,
    pickText(record, 'message', 'msg', 'error') || `Sponsor service returned code ${normalizeText(record.code) || 'unknown'}.`,
    {
      data: record.data,
      // Backend sends TRAFFIC_INSUFFICIENT as data.errorCode (envelope code stays
      // numeric) — the explicit code takes precedence over message normalization.
      reason: normalizeErrorCodeReason(record.code)
        ?? normalizeErrorCodeReason(readObject(record.data)?.errorCode),
      retryable: normalizeBoolean(readObject(record.data)?.retryable) === true,
    },
  );
}

async function parseJsonResponse(response: FetchResponseLike, stage: SponsorStage): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw createSponsorError(
      stage,
      `Sponsor service returned invalid JSON${response.status ? ` (HTTP ${response.status})` : ''}.`,
      {
        status: response.status,
        retryable: isRetryableHttpStatus(response.status),
      },
    );
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 504);
}

function isRetryableSponsorError(error: unknown): boolean {
  return (error as { retryable?: unknown } | undefined)?.retryable === true;
}

function isSponsorClientError(error: unknown): error is MvcSponsorV2ClientError {
  return typeof (error as { code?: unknown } | undefined)?.code === 'string'
    && (error as { code: string }).code.startsWith('mvc_fee_assist_');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRequestTimeout(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.floor(numeric)
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function normalizeRetryDelays(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_RETRY_DELAYS_MS];
  }
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0)
    .map((item) => Math.floor(item));
}

async function requestJsonAttempt(
  fetchImpl: FetchImpl,
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
  stage: SponsorStage,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    const body = await parseJsonResponse(response, stage);
    if (!response.ok) {
      const record = readObject(body);
      throw createSponsorError(
        stage,
        record ? pickText(record, 'message', 'msg', 'error') || `Sponsor service request failed with HTTP ${response.status}.`
          : `Sponsor service request failed with HTTP ${response.status}.`,
        {
          status: response.status,
          data: record?.data,
          reason: normalizeErrorCodeReason(record?.code)
            ?? normalizeErrorCodeReason(record ? readObject(record.data)?.errorCode : undefined),
          retryable: isRetryableHttpStatus(response.status),
        },
      );
    }

    return unwrapEnvelope(body, stage);
  } catch (error) {
    if (controller.signal.aborted) {
      throw createSponsorError(stage, `Sponsor service request timed out after ${timeoutMs}ms.`, { retryable: true });
    }
    if (isSponsorClientError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw createSponsorError(stage, message, { retryable: true });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function requestJson(
  fetchImpl: FetchImpl,
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
  stage: SponsorStage,
  options: {
    retry: boolean;
    timeoutMs: number;
    retryDelaysMs: number[];
  },
): Promise<Record<string, unknown>> {
  const retryDelaysMs = options.retry ? options.retryDelaysMs : [];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestJsonAttempt(fetchImpl, url, init, stage, options.timeoutMs);
    } catch (error) {
      if (!isRetryableSponsorError(error) || attempt >= retryDelaysMs.length) {
        throw error;
      }
      await delay(retryDelaysMs[attempt]);
    }
  }
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return null;
}

function normalizeRequiredNumber(stage: SponsorStage, record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === 'string' && !raw.trim()) {
      continue;
    }
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN;
    if (Number.isFinite(value)) {
      return value;
    }
  }
  throw createSponsorError(stage, `Sponsor ${stage} response is missing required fields.`, {
    data: record,
    reason: stage === 'commit' ? 'commit_failed' : stage === 'pre' ? 'pre_rejected' : 'service_unavailable',
  });
}

function normalizeOptionalNumber(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === 'string' && !raw.trim()) {
      continue;
    }
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN;
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function normalizeUserInputIndexes(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('missing');
  }
  const result: number[] = [];
  for (const item of value) {
    if (typeof item === 'string' && !item.trim()) {
      throw new Error('invalid');
    }
    const numeric = Number(item);
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) {
      throw new Error('invalid');
    }
    result.push(numeric);
  }
  return result;
}

function normalizeAddressInfo(record: Record<string, unknown>): MvcSponsorAddressInfo {
  const exists = normalizeBoolean(record.exists);
  const rawStatus = pickText(record, 'status');
  const sponsorMode = pickText(record, 'sponsorMode', 'sponsor_mode');
  const grantRequired = normalizeBoolean(record.grantRequired ?? record.grant_required);
  const status = rawStatus || (sponsorMode && grantRequired !== null ? sponsorMode : '');
  if (exists === null || !status) {
    throw createSponsorError('address_info', 'Sponsor address info response is missing required fields.', {
      data: record,
    });
  }
  return {
    exists,
    balance: normalizeRequiredNumber('address_info', record, 'balance'),
    grantedAmount: normalizeRequiredNumber('address_info', record, 'grantedAmount', 'granted_amount'),
    reservedAmount: normalizeRequiredNumber('address_info', record, 'reservedAmount', 'reserved_amount'),
    spentAmount: normalizeRequiredNumber('address_info', record, 'spentAmount', 'spent_amount'),
    availableAmount: normalizeRequiredNumber('address_info', record, 'availableAmount', 'available_amount'),
    status,
    raw: record,
  };
}

function normalizeChallenge(record: Record<string, unknown>): MvcSponsorChallenge {
  const challengeId = pickText(record, 'challengeId', 'challenge_id');
  const message = pickText(record, 'message');
  if (!challengeId || !message) {
    throw createSponsorError('challenge', 'Sponsor challenge response is missing required fields.', {
      data: record,
    });
  }
  const expiresAt = pickText(record, 'expiresAt', 'expires_at');
  return {
    challengeId,
    message,
    expiresAt: expiresAt || undefined,
    raw: record,
  };
}

function normalizePreResult(record: Record<string, unknown>): MvcSponsorPreResult {
  const preparedTxHex = pickText(record, 'preparedTxHex', 'prepared_tx_hex');
  const orderId = pickText(record, 'orderId', 'order_id');
  if (!preparedTxHex || !orderId) {
    throw createSponsorError('pre', 'Sponsor pre response is missing required fields.', {
      data: record,
      reason: 'pre_rejected',
    });
  }
  let userInputIndexes: number[];
  try {
    userInputIndexes = normalizeUserInputIndexes(record.userInputIndexes ?? record.user_input_indexes);
  } catch {
    throw createSponsorError('pre', 'Sponsor pre response is missing required fields.', {
      data: record,
      reason: 'pre_rejected',
    });
  }
  const expiresAt = pickText(record, 'expiresAt', 'expires_at');
  return {
    preparedTxHex,
    orderId,
    minerFee: normalizeRequiredNumber('pre', record, 'minerFee', 'miner_fee'),
    userInputIndexes,
    expiresAt: expiresAt || undefined,
    raw: record,
  };
}

function normalizeCommitResult(record: Record<string, unknown>): MvcSponsorCommitResult {
  const txId = pickText(record, 'txId', 'txid');
  if (!txId) {
    throw createSponsorError('commit', 'Sponsor commit response is missing required fields.', {
      data: record,
      reason: 'commit_failed',
    });
  }
  const result: MvcSponsorCommitResult = {
    txId,
    raw: record,
  };
  const txSize = normalizeOptionalNumber(record, 'txSize', 'tx_size');
  const minerFee = normalizeOptionalNumber(record, 'minerFee', 'miner_fee');
  if (txSize !== undefined) {
    result.txSize = txSize;
  }
  if (minerFee !== undefined) {
    result.minerFee = minerFee;
  }
  return result;
}

function normalizeSponsorOrder(record: Record<string, unknown>): MvcSponsorOrder {
  const orderId = pickText(record, 'orderId', 'order_id');
  const status = pickText(record, 'status');
  const pending = normalizeBoolean(record.pending);
  const final = normalizeBoolean(record.final);
  if (!orderId || !status || pending === null || final === null) {
    throw createSponsorError('commit', 'Sponsor order response is missing required fields.', {
      data: record,
      reason: 'commit_failed',
    });
  }
  const txId = pickText(record, 'txId', 'txid');
  const failureReason = pickText(record, 'failureReason', 'failure_reason');
  return {
    orderId,
    status,
    txId: txId || undefined,
    txSize: normalizeRequiredNumber('commit', record, 'txSize', 'tx_size'),
    minerFee: normalizeRequiredNumber('commit', record, 'minerFee', 'miner_fee'),
    pending,
    final,
    failureReason: failureReason || undefined,
    raw: record,
  };
}

function createJsonHeaders(): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
  };
}

function requireText(stage: SponsorStage, field: string, value: unknown): string {
  const normalized = normalizeText(value);
  if (normalized) {
    return normalized;
  }
  throw createSponsorError(stage, `${field} is required`, {
    reason: stage === 'commit' ? 'commit_failed' : stage === 'pre' ? 'pre_rejected' : 'invalid_request',
  });
}

function normalizeTrafficAccount(value: unknown): MvcSponsorTrafficAccount | undefined {
  const record = readObject(value);
  if (!record) {
    return undefined;
  }
  const timestamp = Number(record.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw createSponsorError('pre', 'trafficAccount.timestamp is required', { reason: 'invalid_request' });
  }
  return {
    accountId: requireText('pre', 'trafficAccount.accountId', record.accountId),
    authSignature: requireText('pre', 'trafficAccount.authSignature', record.authSignature),
    timestamp,
  };
}

export function createMvcSponsorV2Client(input: CreateMvcSponsorV2ClientInput = {}) {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const fetchImpl = (input.fetchImpl ?? fetch) as FetchImpl;
  const timeoutMs = normalizeRequestTimeout(input.requestTimeoutMs);
  const retryDelaysMs = normalizeRetryDelays(input.retryDelaysMs);
  const requestOptions = (retry: boolean) => ({ retry, timeoutMs, retryDelaysMs });

  async function getSponsorOrder(orderIdValue: unknown): Promise<MvcSponsorOrder> {
    const orderId = requireText('commit', 'orderId', orderIdValue);
    const record = await requestJson(
      fetchImpl,
      `${baseUrl}/v2/assist/gas/mvc/order/${encodeURIComponent(orderId)}`,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
      },
      'commit',
      requestOptions(true),
    );
    return normalizeSponsorOrder(record);
  }

  return {
    baseUrl,
    async getAddressInfo(payload: { address: string }): Promise<MvcSponsorAddressInfo> {
      const address = requireText('address_info', 'address', payload?.address);
      const url = new URL(`${baseUrl}/v2/assist/gas/address/info`);
      url.searchParams.set('address', address);
      url.searchParams.set('gasChain', 'mvc');
      const record = await requestJson(fetchImpl, url.toString(), {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
      }, 'address_info', requestOptions(true));
      return normalizeAddressInfo(record);
    },
    async getChallenge(): Promise<MvcSponsorChallenge> {
      const record = await requestJson(fetchImpl, `${baseUrl}/v2/assist/gas/mvc/challenge`, {
        method: 'POST',
        headers: createJsonHeaders(),
        body: JSON.stringify({}),
      }, 'challenge', requestOptions(true));
      return normalizeChallenge(record);
    },
    async preSponsor(payload: {
      address: string;
      txHex: string;
      challengeId: string;
      publicKey: string;
      signature: string;
      /** Traffic-account billing pass-through (traffic mode); omitted on the legacy quota path. */
      trafficAccount?: MvcSponsorTrafficAccount;
    }): Promise<MvcSponsorPreResult> {
      const trafficAccount = normalizeTrafficAccount(payload?.trafficAccount);
      const record = await requestJson(fetchImpl, `${baseUrl}/v2/assist/gas/mvc/pre`, {
        method: 'POST',
        headers: createJsonHeaders(),
        body: JSON.stringify({
          address: requireText('pre', 'address', payload?.address),
          txHex: requireText('pre', 'txHex', payload?.txHex),
          challengeId: requireText('pre', 'challengeId', payload?.challengeId),
          publicKey: requireText('pre', 'publicKey', payload?.publicKey),
          signature: requireText('pre', 'signature', payload?.signature),
          ...(trafficAccount ? { trafficAccount } : {}),
        }),
      }, 'pre', requestOptions(false));
      return normalizePreResult(record);
    },
    async getSponsorOrder(payload: { orderId: string }): Promise<MvcSponsorOrder> {
      return getSponsorOrder(payload?.orderId);
    },
    async commitSponsor(payload: {
      orderId: string;
      signedTxHex: string;
      publicKey: string;
      signature: string;
    }): Promise<MvcSponsorCommitResult> {
      const orderId = requireText('commit', 'orderId', payload?.orderId);
      try {
        const record = await requestJson(fetchImpl, `${baseUrl}/v2/assist/gas/mvc/commit`, {
          method: 'POST',
          headers: createJsonHeaders(),
          body: JSON.stringify({
            orderId,
            signedTxHex: requireText('commit', 'signedTxHex', payload?.signedTxHex),
            publicKey: requireText('commit', 'publicKey', payload?.publicKey),
            signature: requireText('commit', 'signature', payload?.signature),
          }),
        }, 'commit', requestOptions(true));
        return normalizeCommitResult(record);
      } catch (error) {
        if (!isRetryableSponsorError(error)) {
          throw error;
        }
        try {
          const order = await getSponsorOrder(orderId);
          if (order.final && order.status === 'broadcasted' && order.txId) {
            return {
              txId: order.txId,
              txSize: order.txSize,
              minerFee: order.minerFee,
              raw: order.raw,
            };
          }
          const sponsorError = error as MvcSponsorV2ClientError;
          sponsorError.data = {
            transportError: sponsorError.data,
            order: order.raw,
          };
        } catch {
          // Preserve the original commit failure when status recovery is unavailable.
        }
        throw error;
      }
    },
  };
}
