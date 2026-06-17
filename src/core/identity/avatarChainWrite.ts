import type { ChainWriteOperation, ChainWriteRequest } from '../chain/writePin';

export const AVATAR_CHAIN_PATH = '/info/avatar';
export const MAX_AVATAR_BYTES = 200 * 1024;

const SUPPORTED_AVATAR_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAvatarMimeType(value: unknown): string {
  const mimeType = normalizeText(value).toLowerCase();
  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
}

function avatarBinaryContentType(mimeType: string): string {
  return `${mimeType};binary`;
}

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return Math.ceil(base64.length * 0.75);
}

export function parseAvatarDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer } | null {
  const match = normalizeText(dataUrl).match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const mimeType = normalizeAvatarMimeType(match[1]);
  const base64 = match[2].replace(/\s+/g, '');
  if (!SUPPORTED_AVATAR_MIME_TYPES.has(mimeType) || !base64) return null;
  return { mimeType, bytes: Buffer.from(base64, 'base64') };
}

export function validateAvatarDataUrl(dataUrl: string, maxBytes = MAX_AVATAR_BYTES): { valid: boolean; error?: string } {
  const normalized = normalizeText(dataUrl);
  if (!normalized) {
    return { valid: true };
  }
  const parsed = parseAvatarDataUrl(normalized);
  if (!parsed) {
    return {
      valid: false,
      error: 'Avatar must be a PNG, JPEG, WebP, or GIF data URL.',
    };
  }
  if (estimateDataUrlBytes(normalized) > maxBytes) {
    return {
      valid: false,
      error: `Avatar must be ${maxBytes} bytes or smaller.`,
    };
  }
  return { valid: true };
}

export function buildAvatarChainWriteRequest(input: {
  avatarDataUrl?: string;
  operation?: ChainWriteOperation;
  network?: string;
  version?: string;
}): ChainWriteRequest {
  const avatarPayload = normalizeText(input.avatarDataUrl);
  if (!avatarPayload) {
    return {
      operation: 'create',
      path: AVATAR_CHAIN_PATH,
      encryption: '0',
      version: normalizeText(input.version) || '1.0',
      contentType: 'text/plain',
      payload: '',
      encoding: 'utf-8',
      ...(normalizeText(input.network) ? { network: normalizeText(input.network) } : {}),
    };
  }

  const avatarData = parseAvatarDataUrl(avatarPayload);
  if (!avatarData) {
    throw new Error('Invalid avatar data URL.');
  }

  return {
    operation: 'create',
    path: AVATAR_CHAIN_PATH,
    encryption: '0',
    version: normalizeText(input.version) || '1.0',
    contentType: avatarBinaryContentType(avatarData.mimeType),
    payload: avatarData.bytes,
    encoding: 'binary',
    ...(normalizeText(input.network) ? { network: normalizeText(input.network) } : {}),
  };
}

export function validateAvatarChainWriteRequest(input: {
  path: string;
  payload: string | Buffer;
  contentType: string;
  encoding: string;
}): void {
  if (input.path !== AVATAR_CHAIN_PATH) return;

  const payload = input.payload;
  if (typeof payload === 'string' && /^data:/iu.test(normalizeText(payload))) {
    throw new Error('Avatar payload must be binary image bytes without a data URL prefix.');
  }

  if (payload === '') {
    const contentType = normalizeText(input.contentType).toLowerCase();
    const encoding = normalizeText(input.encoding).toLowerCase();
    if (contentType === 'text/plain' && encoding === 'utf-8') return;
  }

  if (!Buffer.isBuffer(payload) || payload.length === 0) {
    throw new Error('Avatar payload must be binary image bytes.');
  }

  if (input.encoding !== 'binary') {
    throw new Error('Avatar encoding must be binary.');
  }

  const contentType = normalizeText(input.contentType).toLowerCase();
  const binarySuffix = ';binary';
  if (!contentType.endsWith(binarySuffix)) {
    throw new Error('Avatar contentType must be a supported binary image type.');
  }

  const mimeType = normalizeAvatarMimeType(contentType.slice(0, -binarySuffix.length));
  if (!SUPPORTED_AVATAR_MIME_TYPES.has(mimeType)) {
    throw new Error('Avatar contentType must be a supported binary image type.');
  }
}
