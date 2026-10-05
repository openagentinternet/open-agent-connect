import { createECDH, createHash } from 'node:crypto';
import CryptoJS, { AES, enc, mode, pad } from 'crypto-js';

/** @internal */
export interface PrivateChatIdentity {
  globalMetaId?: string | null;
  privateKeyHex?: string | Buffer | null;
}

/** @internal */
export interface SendPrivateChatInput {
  fromIdentity: PrivateChatIdentity;
  toGlobalMetaId: string;
  peerChatPublicKey: string;
  content: string;
  replyPinId?: string | null;
  timestamp?: number;
  secretVariant?: 'sha256' | 'raw';
  sharedSecretOverride?: string | null;
}

/** @internal */
export interface SendPrivateChatResult {
  path: '/protocols/simplemsg';
  encryption: '0';
  version: '1.0.0';
  contentType: 'application/json';
  payload: string;
  encryptedContent: string;
  sharedSecret: string;
  secretVariant: 'sha256' | 'raw';
}

/** @internal */
export interface ReceivePrivateChatPayload {
  fromGlobalMetaId?: string | null;
  content?: string | null;
  rawData?: string | null;
  replyPinId?: string | null;
}

/** @internal */
export interface ReceivePrivateChatInput {
  localIdentity: PrivateChatIdentity;
  peerChatPublicKey: string;
  payload: ReceivePrivateChatPayload;
}

/** @internal */
export interface ReceivePrivateChatResult {
  fromGlobalMetaId: string;
  replyPinId: string;
  plaintext: string;
  plaintextJson: unknown | null;
  sharedSecret: string;
  secretVariant: 'sha256' | 'raw';
}

const UTF8 = enc.Utf8;
const PRIVATE_CHAT_IV = UTF8.parse('0000000000000000');
const PRIVATE_CHAT_SALT = (CryptoJS.lib.WordArray as {
  create: (words: number[], sigBytes?: number) => CryptoJS.lib.WordArray;
}).create([180470613, 109027952], 8);

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requirePrivateKeyBuffer(identity: PrivateChatIdentity, fieldName: string): Buffer {
  const value = identity.privateKeyHex;
  if (Buffer.isBuffer(value)) {
    if (value.length === 0) {
      throw new Error(`${fieldName} is required`);
    }
    return value;
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  if (!/^[0-9a-f]+$/i.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`${fieldName} must be a hex string`);
  }

  return Buffer.from(normalized, 'hex');
}

function requirePeerChatPublicKey(peerChatPublicKey: string): string {
  const normalized = normalizeText(peerChatPublicKey);
  if (!normalized) {
    throw new Error('Peer chat public key is required');
  }
  return normalized;
}

function computeEcdhSharedSecret(privateKey32: Buffer, peerPublicKeyHex: string): string {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(privateKey32);
  const secret = ecdh.computeSecret(Buffer.from(peerPublicKeyHex, 'hex'));
  return secret.toString('hex');
}

function computeEcdhSharedSecretSha256(privateKey32: Buffer, peerPublicKeyHex: string): string {
  const rawSecretHex = computeEcdhSharedSecret(privateKey32, peerPublicKeyHex);
  return createHash('sha256').update(Buffer.from(rawSecretHex, 'hex')).digest('hex');
}

function ecdhDecrypt(cipherText: string, sharedSecret: string): string {
  const secretStr = String(sharedSecret ?? '').trim();
  const isHex64 = secretStr.length === 64 && /^[0-9a-fA-F]+$/.test(secretStr);

  if (isHex64 && cipherText && !cipherText.startsWith('U2FsdGVkX1')) {
    try {
      const key = enc.Hex.parse(secretStr);
      const bytes = AES.decrypt(cipherText, key, {
        iv: PRIVATE_CHAT_IV,
        mode: mode.CBC,
        padding: pad.Pkcs7,
      });
      const out = bytes.toString(UTF8);
      if (out) return out;
    } catch {
      // Fall through to OpenSSL passphrase mode.
    }
  }

  try {
    const bytes = AES.decrypt(cipherText, secretStr);
    return bytes.toString(UTF8) || cipherText;
  } catch {
    return cipherText;
  }
}

function ecdhEncrypt(plaintext: string, sharedSecretHex: string): string {
  const cipherParams = (CryptoJS.lib.PasswordBasedCipher as {
    encrypt: (
      cipher: unknown,
      message: CryptoJS.lib.WordArray,
      password: string,
      cfg: { salt: CryptoJS.lib.WordArray; format: unknown }
    ) => CryptoJS.lib.CipherParams;
  }).encrypt(
    CryptoJS.algo.AES,
    CryptoJS.enc.Utf8.parse(String(plaintext ?? '')),
    String(sharedSecretHex ?? ''),
    {
      salt: PRIVATE_CHAT_SALT,
      format: CryptoJS.format.OpenSSL,
    }
  );
  return cipherParams.toString();
}

function buildPrivateMsgPayload(
  toGlobalMetaId: string,
  encryptedContent: string,
  replyPinId: string,
  timestamp: number
): string {
  return JSON.stringify({
    to: toGlobalMetaId,
    timestamp,
    content: encryptedContent,
    // IDBots parity: private-chat bodies are markdown; receivers (including
    // the IDBots app and the DSH plugin) gate markdown rendering on this
    // value. text/plain bodies would render verbatim with raw asterisks.
    contentType: 'text/markdown',
    encrypt: 'ecdh',
    replyPin: replyPinId,
  });
}

function extractCipherTextFromRawData(rawData: string | null | undefined): string {
  const raw = normalizeText(rawData);
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw) as {
      content?: unknown;
      data?: { content?: unknown };
    };
    const direct = typeof parsed.content === 'string' ? parsed.content.trim() : '';
    if (direct) return direct;
    const nested = parsed.data && typeof parsed.data.content === 'string'
      ? parsed.data.content.trim()
      : '';
    return nested;
  } catch {
    return '';
  }
}

function looksLikeEncryptedPrivateContent(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  if (normalized.startsWith('U2FsdGVkX1')) return true;
  return /^[0-9a-fA-F]{32,}$/.test(normalized) && normalized.length % 2 === 0;
}

function tryDecryptWithSecret(cipherText: string, secret: string): string | null {
  if (!cipherText || !secret) return null;
  const plain = ecdhDecrypt(cipherText, secret);
  if (
    !plain
    || plain === cipherText
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(plain)
  ) return null;
  return plain;
}

function tryParsePlaintextJson(value: string): unknown | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return null;
  }
}

/** @internal */
export function sendPrivateChat(input: SendPrivateChatInput): SendPrivateChatResult {
  const peerPublicKey = requirePeerChatPublicKey(input.peerChatPublicKey);
  const toGlobalMetaId = normalizeText(input.toGlobalMetaId);
  if (!toGlobalMetaId) {
    throw new Error('Target globalMetaId is required');
  }

  const secretVariant = input.secretVariant === 'raw' ? 'raw' : 'sha256';
  let sharedSecret = normalizeText(input.sharedSecretOverride);
  if (!sharedSecret) {
    const localPrivateKey = requirePrivateKeyBuffer(input.fromIdentity, 'Local private key');
    try {
      sharedSecret = secretVariant === 'raw'
        ? computeEcdhSharedSecret(localPrivateKey, peerPublicKey)
        : computeEcdhSharedSecretSha256(localPrivateKey, peerPublicKey);
    } catch (error) {
      throw new Error(
        `Peer chat public key is invalid: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const encryptedContent = ecdhEncrypt(String(input.content ?? ''), sharedSecret);
  const payload = buildPrivateMsgPayload(
    toGlobalMetaId,
    encryptedContent,
    normalizeText(input.replyPinId),
    Number.isFinite(input.timestamp) ? Number(input.timestamp) : Math.floor(Date.now() / 1000)
  );

  return {
    path: '/protocols/simplemsg',
    encryption: '0',
    version: '1.0.0',
    contentType: 'application/json',
    payload,
    encryptedContent,
    sharedSecret,
    secretVariant,
  };
}

// ---- Private file messages (/protocols/simplefilemsg, IDBots parity) ----
// The message body is plaintext JSON carrying a `metafile://` attachment
// pointer; the FILE itself is pinned encrypted under /file with a raw
// AES-CBC cipher (fixed IV, raw-hex ciphertext) — deliberately NOT the
// OpenSSL-format cipher used for text, to stay wire-compatible with the
// IDBots chat app on the other side.

export const PRIVATE_FILE_MSG_PATH = '/protocols/simplefilemsg';
export const PRIVATE_FILE_MAX_BYTES = 1024 * 1024;

const FILE_CIPHER_IV = enc.Utf8.parse('0000000000000000');

export function encryptPrivateFileHex(fileHex: string, sharedSecretHex: string): string {
  const encrypted = AES.encrypt(
    enc.Hex.parse(String(fileHex ?? '')),
    enc.Hex.parse(String(sharedSecretHex ?? '')),
    {
      mode: mode.CBC,
      padding: pad.Pkcs7,
      iv: FILE_CIPHER_IV,
    },
  );
  return encrypted.ciphertext.toString(enc.Hex);
}

export function decryptPrivateFileHex(cipherHex: string, sharedSecretHex: string): Buffer | null {
  try {
    const cipherParams = (CryptoJS.lib.CipherParams as {
      create: (config: { ciphertext: CryptoJS.lib.WordArray }) => CryptoJS.lib.CipherParams;
    }).create({ ciphertext: enc.Hex.parse(String(cipherHex ?? '')) });
    const plainHex = AES.decrypt(
      cipherParams,
      enc.Hex.parse(String(sharedSecretHex ?? '')),
      {
        mode: mode.CBC,
        padding: pad.Pkcs7,
        iv: FILE_CIPHER_IV,
      },
    ).toString(enc.Hex);
    if (!plainHex || !/^[0-9a-f]*$/iu.test(plainHex) || plainHex.length % 2 !== 0) {
      return null;
    }
    return Buffer.from(plainHex, 'hex');
  } catch {
    return null;
  }
}

export interface PrivateFileChatAttachment {
  attachment: string;
  fileType: string;
  timestamp: number;
  replyPin: string | null;
}

const METAFILE_ATTACHMENT_PATTERN = /^metafile:\/\/([0-9a-f]{64}i0)(?:\.([a-z0-9][a-z0-9+-]{0,31}))?$/iu;

/** Extracts the pin id and extension from a `metafile://<pinId>.<ext>` URI. */
export function parseMetafileAttachmentUri(value: string): { pinId: string; extension: string } | null {
  const match = normalizeText(value).match(METAFILE_ATTACHMENT_PATTERN);
  return match ? { pinId: match[1], extension: match[2] ?? '' } : null;
}

/**
 * Parses an inbound simplefilemsg body (`{"to","encrypt","attachment",
 * "fileType","timestamp","replyPin"}`). Returns null for anything else so
 * callers can treat it as regular text chat.
 */
export function parsePrivateFileChatContent(content: string): PrivateFileChatAttachment | null {
  const normalized = normalizeText(content);
  if (!normalized.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const attachment = typeof parsed.attachment === 'string' ? normalizeText(parsed.attachment) : '';
    if (!attachment || !parseMetafileAttachmentUri(attachment)) return null;
    if (typeof parsed.content === 'string') return null;
    return {
      attachment,
      fileType: typeof parsed.fileType === 'string' && normalizeText(parsed.fileType) ? normalizeText(parsed.fileType) : 'application/octet-stream',
      timestamp: Number.isFinite(Number(parsed.timestamp)) ? Number(parsed.timestamp) : 0,
      replyPin: typeof parsed.replyPin === 'string' ? normalizeText(parsed.replyPin) || null : null,
    };
  } catch {
    return null;
  }
}

export interface SendPrivateFileChatInput {
  fromIdentity: {
    globalMetaId: string;
    privateKeyHex: string;
  };
  toGlobalMetaId: string;
  peerChatPublicKey: string;
  fileDataBase64: string;
  fileType: string;
  sharedSecretOverride?: string;
}

export interface SendPrivateFileChatResult {
  fileWrite: {
    operation: 'create';
    path: '/file';
    encryption: '0';
    contentType: string;
    payload: string;
    encoding: 'hex';
  };
  msgWrite: {
    operation: 'create';
    path: '/protocols/simplefilemsg';
    encryption: '0';
    version: '1.0.0';
    contentType: 'application/json';
    payload: string;
    encoding: 'utf-8';
  };
  attachment: string;
  sharedSecret: string;
}

/** @internal */
export function sendPrivateFileChat(input: SendPrivateFileChatInput): SendPrivateFileChatResult {
  const peerPublicKey = requirePeerChatPublicKey(input.peerChatPublicKey);
  const toGlobalMetaId = normalizeText(input.toGlobalMetaId);
  if (!toGlobalMetaId) {
    throw new Error('Target globalMetaId is required');
  }
  const fileBuffer = Buffer.from(String(input.fileDataBase64 ?? ''), 'base64');
  if (!fileBuffer.length || fileBuffer.length > PRIVATE_FILE_MAX_BYTES) {
    throw new Error(`Private file messages require 1-${PRIVATE_FILE_MAX_BYTES} bytes of file data`);
  }
  const fileType = normalizeText(input.fileType) || 'application/octet-stream';

  const sharedSecret = normalizeText(input.sharedSecretOverride)
    || computeEcdhSharedSecretSha256(
      requirePrivateKeyBuffer(input.fromIdentity, 'Local private key'),
      peerPublicKey,
    );
  const encryptedFileHex = encryptPrivateFileHex(fileBuffer.toString('hex'), sharedSecret);

  const msgWrite: SendPrivateFileChatResult['msgWrite'] = {
    operation: 'create',
    path: PRIVATE_FILE_MSG_PATH,
    encryption: '0',
    version: '1.0.0',
    contentType: 'application/json',
    payload: '',
    encoding: 'utf-8',
  };
  // The attachment pin id comes from the /file write result, so the message
  // payload is filled by the caller once that lands.
  return {
    fileWrite: {
      operation: 'create',
      path: '/file',
      encryption: '0',
      contentType: fileType,
      payload: encryptedFileHex,
      encoding: 'hex',
    },
    msgWrite,
    attachment: '',
    sharedSecret,
  };
}

/** Builds the simplefilemsg payload once the /file pin id is known. */
export function buildPrivateFileMsgPayload(input: {
  toGlobalMetaId: string;
  attachment: string;
  fileType: string;
  replyPinId?: string;
  timestamp?: number;
}): string {
  return JSON.stringify({
    to: input.toGlobalMetaId,
    encrypt: 'ecdh',
    attachment: input.attachment,
    fileType: input.fileType,
    timestamp: Number.isFinite(input.timestamp) ? Math.floor(input.timestamp as number) : Math.floor(Date.now() / 1000),
    replyPin: normalizeText(input.replyPinId),
  });
}

/** Derives the display attachment URI from a /file write result. */
export function attachmentUriFromFileWrite(fileWrite: { pinId?: unknown; txids?: unknown }, fileType: string): string | null {
  const pinId = normalizeText(fileWrite.pinId);
  if (pinId) {
    return `metafile://${pinId}${extensionForFileType(fileType)}`;
  }
  const txids = Array.isArray(fileWrite.txids)
    ? fileWrite.txids.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  if (txids[0]) {
    return `metafile://${txids[0]}i0${extensionForFileType(fileType)}`;
  }
  return null;
}

function extensionForFileType(fileType: string): string {
  const normalized = normalizeText(fileType).toLowerCase().split(';')[0]?.trim() ?? '';
  const extension = EXTENSION_BY_FILE_TYPE[normalized];
  return extension ? `.${extension}` : '';
}

const EXTENSION_BY_FILE_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};

/** @internal */
export function receivePrivateChat(input: ReceivePrivateChatInput): ReceivePrivateChatResult {
  const localPrivateKey = requirePrivateKeyBuffer(input.localIdentity, 'Local private key');
  const peerPublicKey = requirePeerChatPublicKey(input.peerChatPublicKey);

  const rawCipherText = extractCipherTextFromRawData(input.payload.rawData);
  const directContent = normalizeText(input.payload.content);
  const cipherText = rawCipherText || directContent;
  if (!cipherText) {
    throw new Error('Encrypted private chat payload is required');
  }

  const shouldDecrypt = Boolean(rawCipherText) || looksLikeEncryptedPrivateContent(directContent);
  if (!shouldDecrypt) {
    return {
      fromGlobalMetaId: normalizeText(input.payload.fromGlobalMetaId),
      replyPinId: normalizeText(input.payload.replyPinId),
      plaintext: directContent,
      plaintextJson: tryParsePlaintextJson(directContent),
      sharedSecret: '',
      secretVariant: 'sha256',
    };
  }

  let sharedSecretSha256: string;
  let sharedSecretRaw: string;
  try {
    sharedSecretSha256 = computeEcdhSharedSecretSha256(localPrivateKey, peerPublicKey);
    sharedSecretRaw = computeEcdhSharedSecret(localPrivateKey, peerPublicKey);
  } catch (error) {
    throw new Error(
      `Peer chat public key is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const plainBySha256 = tryDecryptWithSecret(cipherText, sharedSecretSha256);
  if (plainBySha256 != null) {
    return {
      fromGlobalMetaId: normalizeText(input.payload.fromGlobalMetaId),
      replyPinId: normalizeText(input.payload.replyPinId),
      plaintext: plainBySha256,
      plaintextJson: tryParsePlaintextJson(plainBySha256),
      sharedSecret: sharedSecretSha256,
      secretVariant: 'sha256',
    };
  }

  const plainByRaw = tryDecryptWithSecret(cipherText, sharedSecretRaw);
  if (plainByRaw != null) {
    return {
      fromGlobalMetaId: normalizeText(input.payload.fromGlobalMetaId),
      replyPinId: normalizeText(input.payload.replyPinId),
      plaintext: plainByRaw,
      plaintextJson: tryParsePlaintextJson(plainByRaw),
      sharedSecret: sharedSecretRaw,
      secretVariant: 'raw',
    };
  }

  throw new Error('Failed to decrypt private chat payload');
}
