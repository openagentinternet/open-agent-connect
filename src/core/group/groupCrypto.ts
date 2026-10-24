/**
 * Group-chat message crypto for MetaWeb group chats (SimpleGroupChat).
 *
 * The group encryption scheme is fully public — the key is derived from the
 * group id itself, so there is no secret key material on either side:
 * - key: first 16 characters of the group id (UTF-8 bytes), right-padded
 *   with '0' when the id is shorter (IDBots metaWebCrypto groupIdToSecretKey).
 * - cipher: AES-128-CBC, IV = the 16 ASCII '0' characters (UTF-8 bytes,
 *   16 x 0x30), PKCS7 padding.
 * - encoding: ciphertext bytes as lowercase hex.
 *
 * Implemented with node:crypto only (no crypto-js, no new dependencies).
 * The three cross-implementation vectors pinned in
 * tests/group/groupCrypto.test.mjs were produced by an independent openssl
 * implementation and must match byte for byte.
 */
import { createCipheriv, createDecipheriv } from 'node:crypto';

/** Secret-key length in characters (the AES-128 key size). */
const GROUP_KEY_CHAR_LEN = 16;
const GROUP_CIPHER_ALGO = 'aes-128-cbc';
/** Fixed IV: sixteen ASCII '0' characters, used as their UTF-8 bytes. */
const GROUP_IV_TEXT = '0000000000000000';

/**
 * Secret key for a group: the first 16 characters of the groupId, padded
 * with '0' when shorter. Mirrors IDBots metaWebCrypto.ts groupIdToSecretKey
 * ("直接取该群聊 groupId 的前 16 个字符").
 * Exposed so decrypt callers and tests can derive the same key.
 */
export function groupIdToSecretKey(groupId: string): string {
  const normalized = typeof groupId === 'string' ? groupId.trim() : '';
  if (normalized.length >= GROUP_KEY_CHAR_LEN) {
    return normalized.slice(0, GROUP_KEY_CHAR_LEN);
  }
  return normalized.padEnd(GROUP_KEY_CHAR_LEN, '0');
}

/**
 * Encrypt one group-chat message for broadcast. Returns the ciphertext bytes
 * as lowercase hex (the wire form of the simplegroupchat content field).
 * Mirrors IDBots encryptGroupMessageECB (AES-128-CBC despite the name).
 */
export function encryptGroupMessage(message: string, groupId: string): string {
  const key = Buffer.from(groupIdToSecretKey(groupId), 'utf8');
  const iv = Buffer.from(GROUP_IV_TEXT, 'utf8');
  const cipher = createCipheriv(GROUP_CIPHER_ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(message ?? ''), 'utf8'),
    cipher.final(),
  ]);
  return ciphertext.toString('hex');
}

/**
 * Decrypt one group-chat message (hex ciphertext) back to plaintext.
 * Exported for the core tests and a future group read surface; the write
 * path only ever needs encryptGroupMessage. Throws on malformed hex or
 * padding — callers decide how to surface that.
 */
export function decryptGroupMessage(cipherHex: string, groupId: string): string {
  const key = Buffer.from(groupIdToSecretKey(groupId), 'utf8');
  const iv = Buffer.from(GROUP_IV_TEXT, 'utf8');
  const decipher = createDecipheriv(GROUP_CIPHER_ALGO, key, iv);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(String(cipherHex ?? ''), 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
