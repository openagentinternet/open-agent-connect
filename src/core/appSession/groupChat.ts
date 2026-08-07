/**
 * Group chat client for the App/Game Runtime.
 *
 * Docs/10: Agent-Game-v2 reuses the existing simplegroupchat group as an
 * event bus. The runtime reads through `group-chat-list-by-index` (socket is
 * only a realtime notification; history is the source of truth), decrypts
 * `simplegroupchat` content with the public AES group scheme and parses the
 * `agent-game/1` envelope.
 */

import { createDecipheriv, createCipheriv } from 'node:crypto';
import {
  AGENT_GAME_PROTOCOL,
  type AgentGameEnvelope,
  type GroupChatMessage,
} from './types';

const GROUP_AES_KEY_CHAR_LEN = 16;
const GROUP_AES_IV = '0000000000000000';
const DEFAULT_PAGE_SIZE = 50;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Group message secret key: the first 16 UTF-8 characters of groupId, padded
 * with '0'. Matches idchat / the chess MetaApp (`js/groupCrypto.js`).
 */
export function groupIdToSecretKey(groupId: string): string {
  const text = normalizeText(groupId);
  if (text.length >= GROUP_AES_KEY_CHAR_LEN) {
    return text.slice(0, GROUP_AES_KEY_CHAR_LEN);
  }
  return text.padEnd(GROUP_AES_KEY_CHAR_LEN, '0');
}

/**
 * AES-128-CBC + PKCS7 group message encryption with the public IV
 * "0000000000000000"; ciphertext is hex encoded. Host-side write path uses
 * this to encrypt the game event before the pin write.
 */
export function encryptGroupContent(plaintext: string, groupId: string): string {
  const key = Buffer.from(groupIdToSecretKey(groupId), 'utf8');
  const iv = Buffer.from(GROUP_AES_IV, 'utf8');
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(String(plaintext), 'utf8')),
    cipher.final(),
  ]);
  return encrypted.toString('hex');
}

/**
 * Decrypt a simplegroupchat content field. When the ciphertext does not
 * decrypt (public/unencrypted group or foreign message), return the original
 * text unchanged — matching idchat convention.
 */
export function decryptGroupContent(content: string, groupId: string): string {
  const hex = normalizeText(content);
  if (!hex || hex.length % 16 !== 0 || /[^0-9a-f]/iu.test(hex)) {
    return content;
  }
  try {
    const key = Buffer.from(groupIdToSecretKey(groupId), 'utf8');
    const iv = Buffer.from(GROUP_AES_IV, 'utf8');
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(hex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return content;
  }
}

function toMilliseconds(value: unknown): number {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) {
    return Date.now();
  }
  return Math.trunc(num < 1_000_000_000_000 ? num * 1000 : num);
}

function normalizeIndex(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.trunc(num) : 0;
}

function extractList(rawData: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(rawData)) {
    return rawData.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  }
  if (!rawData || typeof rawData !== 'object') {
    return [];
  }
  const record = rawData as Record<string, unknown>;
  const data = record.data;
  if (data && typeof data === 'object') {
    const dataRecord = data as Record<string, unknown>;
    for (const key of ['list', 'items', 'messages']) {
      if (Array.isArray(dataRecord[key])) {
        return dataRecord[key] as Array<Record<string, unknown>>;
      }
    }
    return [];
  }
  for (const key of ['list', 'items', 'messages']) {
    if (Array.isArray(record[key])) {
      return record[key] as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function senderMetaIdFrom(item: Record<string, unknown>): string {
  const userInfo = item.userInfo && typeof item.userInfo === 'object'
    ? item.userInfo as Record<string, unknown>
    : null;
  const fromUserInfo = item.fromUserInfo && typeof item.fromUserInfo === 'object'
    ? item.fromUserInfo as Record<string, unknown>
    : null;
  return normalizeText(
    item.globalMetaId
    || item.fromGlobalMetaId
    || item.createGlobalMetaId
    || userInfo?.globalMetaId
    || fromUserInfo?.globalMetaId
    || item.metaId
    || item.metaid,
  );
}

export function normalizeGroupChatMessage(raw: unknown): GroupChatMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const item = raw as Record<string, unknown>;
  const content = normalizeText(item.content);
  if (!content) {
    return null;
  }
  const groupId = normalizeText(
    item.groupId || item.groupID || item.channelId || item.channelID || item.metanetId,
  );
  const senderMetaId = senderMetaIdFrom(item);
  if (!groupId || !senderMetaId) {
    return null;
  }
  return {
    index: normalizeIndex(item.index ?? item.msgIndex),
    senderMetaId,
    timestamp: toMilliseconds(item.timestamp ?? item.time ?? item.createTime),
    content,
    encryption: normalizeText(item.encryption ?? item.Encryption).toLowerCase(),
    protocol: normalizeText(item.protocol ?? item.protocolPath ?? item.path),
    pinId: normalizeText(item.pinId ?? item.pinID ?? item.id),
    groupId,
  };
}

/**
 * Fetch messages with index >= startIndex from `group-chat-list-by-index`.
 * Returns messages sorted by index ascending; callers deduplicate by index.
 */
export async function fetchGroupMessages(input: {
  chatApiBaseUrl: string;
  groupId: string;
  startIndex: number;
  size?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<GroupChatMessage[]> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const baseUrl = normalizeText(input.chatApiBaseUrl).replace(/\/+$/u, '');
  if (!baseUrl) {
    throw new Error('chatApiBaseUrl is required.');
  }
  const url = new URL(`${baseUrl}/group-chat-list-by-index`);
  url.searchParams.set('groupId', normalizeText(input.groupId));
  url.searchParams.set('startIndex', String(Math.max(0, Math.trunc(Number(input.startIndex) || 0))));
  url.searchParams.set('size', String(input.size && input.size > 0 ? Math.trunc(input.size) : DEFAULT_PAGE_SIZE));
  const response = await fetchImpl(url.toString(), {
    headers: { 'content-type': 'application/json' },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok) {
    const error = new Error(`group-chat-list-by-index failed: ${response.status}`);
    (error as { status?: number }).status = response.status;
    throw error;
  }
  const raw = await response.json();
  const list = extractList(raw);
  const messages = list
    .map(normalizeGroupChatMessage)
    .filter((message): message is GroupChatMessage => message !== null)
    .sort((left, right) => left.index - right.index);
  return messages;
}

/**
 * Parse the decrypted simplegroupchat plaintext as an agent-game/1 envelope.
 * Returns null for non-game content so normal group traffic is ignored.
 */
export function parseAgentGameEnvelope(plaintext: string): AgentGameEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (normalizeText(record.protocol) !== AGENT_GAME_PROTOCOL) {
    return null;
  }
  const gameId = normalizeText(record.gameId);
  const matchId = normalizeText(record.matchId);
  const rulesHash = normalizeText(record.rulesHash);
  const type = normalizeText(record.type);
  if (!gameId || !matchId || !rulesHash || !type) {
    return null;
  }
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload as Record<string, unknown>
    : {};
  return {
    protocol: AGENT_GAME_PROTOCOL,
    gameId,
    matchId,
    rulesHash,
    type,
    ...(normalizeText(record.eventId) ? { eventId: normalizeText(record.eventId) } : {}),
    ...(Number.isInteger(record.actionSeq) ? { actionSeq: Number(record.actionSeq) } : {}),
    ...(normalizeText(record.prevStateHash) ? { prevStateHash: normalizeText(record.prevStateHash) } : {}),
    ...(normalizeText(record.stateHash) ? { stateHash: normalizeText(record.stateHash) } : {}),
    payload,
  };
}

/**
 * Build a group chat write payload body (the JSON value of the
 * simplegroupchat pin), matching the idchat / chess MetaApp shape exactly.
 */
export function buildGroupChatWritePayload(input: {
  groupId: string;
  plaintext: string;
  nickName?: string;
  replyPin?: string;
  mention?: string[];
  now?: number;
}): Record<string, unknown> {
  return {
    groupId: normalizeText(input.groupId),
    nickName: normalizeText(input.nickName) || '',
    content: encryptGroupContent(input.plaintext, input.groupId),
    contentType: 'text/plain',
    encryption: 'aes',
    timestamp: input.now ?? Date.now(),
    replyPin: normalizeText(input.replyPin) || '',
    mention: Array.isArray(input.mention) ? input.mention.filter((value) => normalizeText(value)) : [],
  };
}
