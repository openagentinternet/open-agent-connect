const DEFAULT_ASSIST_OPEN_API_BASE_URL = 'https://www.metaso.network/assist-open-api';

type FetchResponseLike = {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
};

type FetchImpl = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<FetchResponseLike>;

type SponsorStage = 'address_info' | 'challenge' | 'pre' | 'commit';
type SponsorReason = 'insufficient_quota' | 'service_unavailable' | 'commit_failed';

export interface MvcSponsorV2ClientError extends Error {
  code: string;
  stage: SponsorStage;
  reason: SponsorReason;
  serviceMessage: string;
  status?: number;
  data?: unknown;
}

export interface MvcSponsorAddressInfo {
  address: string;
  gasChain: string;
  balance: string;
  rewardAmount: string;
  usedAmount: string;
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
  minerFee: string;
  userInputIndexes: number[];
  expiresAt?: string;
  raw: Record<string, unknown>;
}

export interface MvcSponsorCommitResult {
  txHex: string;
  txId?: string;
  orderId: string;
  raw: Record<string, unknown>;
}

export interface CreateMvcSponsorV2ClientInput {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
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
  if (/available amount not enough|quota not granted|insufficient quota|insufficient balance/i.test(message)) {
    return 'insufficient_quota';
  }
  if (stage === 'commit' || /commit/i.test(message)) {
    return 'commit_failed';
  }
  return 'service_unavailable';
}

function createSponsorError(stage: SponsorStage, message: string, extra: {
  status?: number;
  data?: unknown;
} = {}): MvcSponsorV2ClientError {
  const serviceMessage = normalizeText(message) || `MVC sponsor ${stage} failed.`;
  const error = new Error(serviceMessage) as MvcSponsorV2ClientError;
  error.code = `mvc_fee_assist_${stage}_failed`;
  error.stage = stage;
  error.reason = normalizeReason(stage, serviceMessage);
  error.serviceMessage = serviceMessage;
  if (extra.status !== undefined) {
    error.status = extra.status;
  }
  if (extra.data !== undefined) {
    error.data = extra.data;
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
    { data: record.data },
  );
}

async function parseJsonResponse(response: FetchResponseLike, stage: SponsorStage): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw createSponsorError(
      stage,
      `Sponsor service returned invalid JSON${response.status ? ` (HTTP ${response.status})` : ''}.`,
      { status: response.status },
    );
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
): Promise<Record<string, unknown>> {
  let response: FetchResponseLike;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw createSponsorError(stage, error instanceof Error ? error.message : String(error));
  }

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
      },
    );
  }

  return unwrapEnvelope(body, stage);
}

function normalizeUserInputIndexes(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: number[] = [];
  for (const item of value) {
    const numeric = Number(item);
    if (Number.isFinite(numeric) && numeric >= 0) {
      result.push(Math.floor(numeric));
    }
  }
  return result;
}

function normalizeAddressInfo(record: Record<string, unknown>): MvcSponsorAddressInfo {
  const address = pickText(record, 'address');
  if (!address) {
    throw createSponsorError('address_info', 'Sponsor address info response is missing address.', {
      data: record,
    });
  }
  return {
    address,
    gasChain: pickText(record, 'gasChain', 'gas_chain') || 'mvc',
    balance: pickText(record, 'balance') || '0',
    rewardAmount: pickText(record, 'rewardAmount', 'reward_amount') || '0',
    usedAmount: pickText(record, 'usedAmount', 'used_amount') || '0',
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
    });
  }
  const expiresAt = pickText(record, 'expiresAt', 'expires_at');
  return {
    preparedTxHex,
    orderId,
    minerFee: pickText(record, 'minerFee', 'miner_fee') || '0',
    userInputIndexes: normalizeUserInputIndexes(record.userInputIndexes ?? record.user_input_indexes),
    expiresAt: expiresAt || undefined,
    raw: record,
  };
}

function normalizeCommitResult(record: Record<string, unknown>): MvcSponsorCommitResult {
  const txHex = pickText(record, 'txHex', 'signedTxHex', 'finalTxHex', 'final_tx_hex');
  const orderId = pickText(record, 'orderId', 'order_id');
  if (!txHex || !orderId) {
    throw createSponsorError('commit', 'Sponsor commit response is missing required fields.', {
      data: record,
    });
  }
  const txId = pickText(record, 'txId', 'txid');
  return {
    txHex,
    txId: txId || undefined,
    orderId,
    raw: record,
  };
}

function createJsonHeaders(): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
  };
}

export function createMvcSponsorV2Client(input: CreateMvcSponsorV2ClientInput = {}) {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const fetchImpl = (input.fetchImpl ?? fetch) as FetchImpl;

  return {
    baseUrl,
    async getAddressInfo(payload: { address: string }): Promise<MvcSponsorAddressInfo> {
      const address = normalizeText(payload?.address);
      if (!address) {
        throw new Error('address is required');
      }
      const url = new URL(`${baseUrl}/v2/assist/gas/address/info`);
      url.searchParams.set('address', address);
      url.searchParams.set('gasChain', 'mvc');
      const record = await requestJson(fetchImpl, url.toString(), {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
      }, 'address_info');
      return normalizeAddressInfo(record);
    },
    async getChallenge(payload: { address: string }): Promise<MvcSponsorChallenge> {
      const address = normalizeText(payload?.address);
      if (!address) {
        throw new Error('address is required');
      }
      const record = await requestJson(fetchImpl, `${baseUrl}/v2/assist/gas/mvc/challenge`, {
        method: 'POST',
        headers: createJsonHeaders(),
        body: JSON.stringify({ address }),
      }, 'challenge');
      return normalizeChallenge(record);
    },
    async preSponsor(payload: {
      address: string;
      txHex: string;
      challengeId: string;
      publicKey: string;
      signature: string;
    }): Promise<MvcSponsorPreResult> {
      const record = await requestJson(fetchImpl, `${baseUrl}/v2/assist/gas/mvc/pre`, {
        method: 'POST',
        headers: createJsonHeaders(),
        body: JSON.stringify({
          address: normalizeText(payload?.address),
          txHex: normalizeText(payload?.txHex),
          challengeId: normalizeText(payload?.challengeId),
          publicKey: normalizeText(payload?.publicKey),
          signature: normalizeText(payload?.signature),
        }),
      }, 'pre');
      return normalizePreResult(record);
    },
    async commitSponsor(payload: {
      orderId: string;
      signedTxHex: string;
      publicKey: string;
      signature: string;
    }): Promise<MvcSponsorCommitResult> {
      const record = await requestJson(fetchImpl, `${baseUrl}/v2/assist/gas/mvc/commit`, {
        method: 'POST',
        headers: createJsonHeaders(),
        body: JSON.stringify({
          orderId: normalizeText(payload?.orderId),
          signedTxHex: normalizeText(payload?.signedTxHex),
          publicKey: normalizeText(payload?.publicKey),
          signature: normalizeText(payload?.signature),
        }),
      }, 'commit');
      return normalizeCommitResult(record);
    },
  };
}
