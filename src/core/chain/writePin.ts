import { validateAvatarChainWriteRequest } from '../identity/avatarChainWrite';

export type ChainWriteOperation = 'init' | 'create' | 'modify' | 'revoke';
export type ChainWriteEncryption = '0' | '1' | '2';
export type ChainWriteEncoding = 'utf-8' | 'base64' | 'binary';
export type ChainWriteNetwork = 'mvc' | 'btc' | 'doge' | 'opcat';
export type ChainWritePayload = string | Buffer;

export interface ChainWriteRequest {
  operation?: string;
  path?: string;
  encryption?: string;
  version?: string;
  contentType?: string;
  payload?: ChainWritePayload;
  encoding?: string;
  network?: string;
}

export interface NormalizedChainWriteRequest {
  operation: ChainWriteOperation;
  path: string;
  encryption: ChainWriteEncryption;
  version: string;
  contentType: string;
  payload: ChainWritePayload;
  encoding: ChainWriteEncoding;
  network: ChainWriteNetwork;
}

export interface ChainWriteResult {
  txids: string[];
  pinId: string;
  totalCost: number;
  network: ChainWriteNetwork;
  operation: ChainWriteOperation;
  path: string;
  contentType: string;
  encoding: ChainWriteEncoding;
  globalMetaId: string;
  mvcAddress: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function chainWritePayloadToBuffer(input: {
  payload: ChainWritePayload;
  encoding: ChainWriteEncoding;
}): Buffer {
  if (Buffer.isBuffer(input.payload)) {
    return Buffer.from(input.payload);
  }
  if (input.encoding === 'base64') {
    return Buffer.from(input.payload, 'base64');
  }
  return Buffer.from(input.payload, 'utf-8');
}

export function normalizeChainWriteRequest(input: ChainWriteRequest): NormalizedChainWriteRequest {
  const operation = normalizeText(input.operation).toLowerCase() || 'create';
  if (operation !== 'init' && operation !== 'create' && operation !== 'modify' && operation !== 'revoke') {
    throw new Error(`Unsupported chain operation: ${input.operation}`);
  }

  const path = normalizeText(input.path);
  if (operation !== 'init' && !path) {
    throw new Error('Chain write path is required.');
  }

  const encryption = normalizeText(input.encryption) || '0';
  if (encryption !== '0' && encryption !== '1' && encryption !== '2') {
    throw new Error(`Unsupported chain write encryption value: ${input.encryption}`);
  }

  const rawPayload = input.payload;
  const payloadIsBuffer = Buffer.isBuffer(rawPayload);
  const encoding = normalizeText(input.encoding).toLowerCase() || (payloadIsBuffer ? 'binary' : 'utf-8');
  if (encoding !== 'utf-8' && encoding !== 'base64' && encoding !== 'binary') {
    throw new Error(`Unsupported chain write encoding: ${input.encoding}`);
  }

  const network = normalizeText(input.network).toLowerCase() || 'mvc';
  if (network !== 'mvc' && network !== 'btc' && network !== 'doge' && network !== 'opcat') {
    throw new Error(`Unsupported chain write network: ${input.network}`);
  }

  let payload: ChainWritePayload;
  if (typeof rawPayload === 'string' || Buffer.isBuffer(rawPayload)) {
    payload = rawPayload;
  } else {
    throw new Error('Chain write payload must be a string or Buffer.');
  }
  if (Buffer.isBuffer(payload) && encoding !== 'binary') {
    throw new Error('Chain write Buffer payloads must use binary encoding.');
  }
  if (!Buffer.isBuffer(payload) && encoding === 'binary') {
    throw new Error('Chain write binary payloads must be Buffers.');
  }

  const request: NormalizedChainWriteRequest = {
    operation: operation as ChainWriteOperation,
    path,
    encryption: encryption as ChainWriteEncryption,
    version: normalizeText(input.version) || '1.0',
    contentType: normalizeText(input.contentType) || 'application/json',
    payload,
    encoding: encoding as ChainWriteEncoding,
    network: network as ChainWriteNetwork,
  };
  validateAvatarChainWriteRequest(request);
  return request;
}
