import { createHash } from 'node:crypto';
import { receivePrivateChat } from './privateChat';
import { resolveMetasoInfrastructureEndpoints } from '../network/metasoInfrastructure';

const DEFAULT_CONVERSATION_LIMIT = 50;
const MAX_CONVERSATION_LIMIT = 200;
const UNABLE_TO_DECRYPT_TEXT = '[Unable to decrypt message]';
const UNSUPPORTED_FILE_TEXT = '[Unsupported file message]';

export interface ChatViewerUserInfo {
  globalMetaId?: string;
  metaid?: string;
  metaId?: string;
  name?: string;
  nickname?: string;
  avatar?: string;
  avatarUri?: string;
}

export interface ChatViewerMessage {
  id: string;
  pinId?: string;
  txId?: string;
  protocol: string;
  type?: '2';
  content: string;
  contentType?: string;
  timestamp: number;
  index: number;
  fromGlobalMetaId: string;
  toGlobalMetaId: string;
  fromUserInfo?: ChatViewerUserInfo | null;
  toUserInfo?: ChatViewerUserInfo | null;
  userInfo?: ChatViewerUserInfo | null;
  replyPin?: string;
  replyInfo?: Record<string, unknown> | null;
  mention?: Array<unknown>;
  chain?: string;
}

export interface FetchPrivateHistoryInput {
  selfGlobalMetaId: string;
  peerGlobalMetaId: string;
  afterIndex?: number;
  limit: number;
}

export interface FetchPrivateHistoryPageInput {
  selfGlobalMetaId: string;
  peerGlobalMetaId: string;
  startIndex?: number;
  limit: number;
  timeoutMs?: number;
}

export interface PrivateChatHistoryPage {
  rows: unknown[];
  total: number | null;
  nextTimestamp: number | null;
}

export interface FetchPrivateChatPeerGlobalMetaIdsInput {
  selfGlobalMetaId: string;
  knownPeers?: Array<{
    globalMetaId: string;
    chatPublicKey?: string | null;
  }>;
  fetchImpl?: typeof fetch;
  chatApiBaseUrl?: string;
  timeoutMs?: number;
}

export type FetchPrivateHistory = (
  input: FetchPrivateHistoryInput
) => Promise<unknown[]>;

/** @internal */
export interface BuildPrivateConversationResponseInput {
  selfGlobalMetaId: string;
  peerGlobalMetaId: string;
  localPrivateKeyHex: string;
  peerChatPublicKey: string;
  afterIndex?: number;
  limit?: number;
  fetchHistory?: FetchPrivateHistory;
  fetchImpl?: typeof fetch;
  chatApiBaseUrl?: string;
  now?: () => number;
}

export interface PrivateConversationResponse {
  ok: true;
  selfGlobalMetaId: string;
  peerGlobalMetaId: string;
  messages: ChatViewerMessage[];
  nextPollAfterIndex: number;
  serverTime: number;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeConversationLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_CONVERSATION_LIMIT;
  }
  return Math.min(MAX_CONVERSATION_LIMIT, Math.max(1, Math.floor(numeric)));
}

export function normalizeConversationAfterIndex(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }
  return Math.floor(numeric);
}

function normalizeBaseUrl(value: string | undefined): string {
  return (normalizeText(value) || resolveMetasoInfrastructureEndpoints().chatApiBaseUrl).replace(/\/+$/, '');
}

function getFetchImpl(fetchImpl: typeof fetch | undefined): typeof fetch {
  return fetchImpl ?? fetch;
}

function extractList(rawData: unknown): unknown[] {
  if (Array.isArray(rawData)) return rawData;
  if (!rawData || typeof rawData !== 'object') return [];
  const record = rawData as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data;
  if (record.data && typeof record.data === 'object') {
    const data = record.data as Record<string, unknown>;
    if (Array.isArray(data.list)) return data.list;
    if (Array.isArray(data.items)) return data.items;
  }
  if (Array.isArray(record.list)) return record.list;
  if (Array.isArray(record.items)) return record.items;
  return [];
}

function extractHistoryPage(rawData: unknown): PrivateChatHistoryPage {
  const rows = extractList(rawData);
  const record = readObject(rawData);
  const data = readObject(record?.data);
  const totalCandidate = data?.total ?? record?.total;
  const nextTimestampCandidate = data?.nextTimestamp ?? record?.nextTimestamp;
  const total = Number(totalCandidate);
  const nextTimestamp = Number(nextTimestampCandidate);
  return {
    rows,
    total: Number.isFinite(total) && total >= 0 ? Math.floor(total) : null,
    nextTimestamp: Number.isFinite(nextTimestamp) ? Math.floor(nextTimestamp) : null,
  };
}

function isModernGlobalMetaId(value: string): boolean {
  return /^idq1[a-z0-9]+$/iu.test(value);
}

export function extractPrivateChatPeerGlobalMetaIds(
  rawData: unknown,
  selfGlobalMetaId: string,
  knownPeers: FetchPrivateChatPeerGlobalMetaIdsInput['knownPeers'] = [],
): string[] {
  const normalizedSelf = normalizeText(selfGlobalMetaId).toLowerCase();
  const peers = new Map<string, string>();
  const knownPeerByChatPublicKey = new Map<string, string>();
  for (const knownPeer of knownPeers) {
    const globalMetaId = normalizeText(knownPeer.globalMetaId);
    const chatPublicKey = normalizeText(knownPeer.chatPublicKey).toLowerCase();
    if (globalMetaId && globalMetaId.toLowerCase() !== normalizedSelf && chatPublicKey) {
      knownPeerByChatPublicKey.set(chatPublicKey, globalMetaId);
    }
  }

  for (const rawRow of extractList(rawData)) {
    const row = readObject(rawRow);
    if (!row) continue;
    const chatType = firstText(row.type, row.chatType, row.chat_type).toLowerCase();
    if (chatType && chatType !== '2' && chatType !== 'msg') continue;

    const userInfo = readObject(row.userInfo);
    const lastMessage = readObject(row.lastMessage) ?? readObject(row.last_message);
    let foundPeerGlobalMetaId = false;
    const candidates = [
      row.globalMetaId,
      row.global_meta_id,
      userInfo?.globalMetaId,
      userInfo?.globalmetaid,
      lastMessage?.fromGlobalMetaId,
      lastMessage?.toGlobalMetaId,
    ];
    for (const candidate of candidates) {
      const peer = normalizeText(candidate);
      const normalizedPeer = peer.toLowerCase();
      if (!isModernGlobalMetaId(peer) || normalizedPeer === normalizedSelf) continue;
      peers.set(normalizedPeer, peer);
      foundPeerGlobalMetaId = true;
    }
    if (!foundPeerGlobalMetaId) {
      const chatPublicKey = firstText(
        userInfo?.chatPublicKey,
        userInfo?.chatpubkey,
        row.chatPublicKey,
        row.chatpubkey,
      ).toLowerCase();
      const mappedPeer = knownPeerByChatPublicKey.get(chatPublicKey);
      if (mappedPeer) {
        peers.set(mappedPeer.toLowerCase(), mappedPeer);
      }
    }
  }

  return Array.from(peers.values());
}

export async function fetchPrivateChatPeerGlobalMetaIds(
  input: FetchPrivateChatPeerGlobalMetaIdsInput,
): Promise<string[]> {
  const selfGlobalMetaId = normalizeText(input.selfGlobalMetaId);
  if (!selfGlobalMetaId) {
    throw new Error('selfGlobalMetaId is required');
  }

  const url = new URL(`${normalizeBaseUrl(input.chatApiBaseUrl)}/user/latest-chat-info-list`);
  url.searchParams.set('metaId', selfGlobalMetaId);
  const timeoutMs = Number.isFinite(Number(input.timeoutMs))
    ? Math.max(1, Math.floor(Number(input.timeoutMs)))
    : 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  let response: Response;
  try {
    response = await getFetchImpl(input.fetchImpl)(url.toString(), {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`peer_directory_fetch_http_${response.status}`);
  }

  const rawData = await response.json();
  const apiCode = Number(readObject(rawData)?.code);
  if (Number.isFinite(apiCode) && apiCode !== 0) {
    throw new Error(`peer_directory_fetch_api_${Math.floor(apiCode)}`);
  }

  return extractPrivateChatPeerGlobalMetaIds(
    rawData,
    selfGlobalMetaId,
    input.knownPeers,
  );
}

export async function fetchPrivateChatHistoryPage(input: FetchPrivateHistoryPageInput & {
  fetchImpl?: typeof fetch;
  chatApiBaseUrl?: string;
}): Promise<PrivateChatHistoryPage> {
  const selfGlobalMetaId = normalizeText(input.selfGlobalMetaId);
  const peerGlobalMetaId = normalizeText(input.peerGlobalMetaId);
  if (!selfGlobalMetaId || !peerGlobalMetaId) {
    throw new Error('selfGlobalMetaId and peerGlobalMetaId are required');
  }

  const startIndex = Number(input.startIndex);
  const fetchImpl = getFetchImpl(input.fetchImpl);
  const url = new URL(`${normalizeBaseUrl(input.chatApiBaseUrl)}/private-chat-list-by-index`);
  url.searchParams.set('metaId', selfGlobalMetaId);
  url.searchParams.set('otherMetaId', peerGlobalMetaId);
  url.searchParams.set('startIndex', String(Number.isFinite(startIndex) && startIndex >= 0
    ? Math.floor(startIndex)
    : 0));
  url.searchParams.set('size', String(normalizeConversationLimit(input.limit)));

  // A hung history request must not wedge the backfill loop that relies on this
  // fetch for all gap recovery, so bound it with an explicit timeout.
  const timeoutMs = Number.isFinite(Number(input.timeoutMs))
    ? Math.max(1, Math.floor(Number(input.timeoutMs)))
    : 15_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`history_fetch_http_${response.status}`);
  }

  return extractHistoryPage(await response.json());
}

export async function fetchPrivateChatHistory(input: FetchPrivateHistoryInput & {
  fetchImpl?: typeof fetch;
  chatApiBaseUrl?: string;
}): Promise<unknown[]> {
  const selfGlobalMetaId = normalizeText(input.selfGlobalMetaId);
  const peerGlobalMetaId = normalizeText(input.peerGlobalMetaId);
  if (!selfGlobalMetaId || !peerGlobalMetaId) {
    throw new Error('selfGlobalMetaId and peerGlobalMetaId are required');
  }

  const page = await fetchPrivateChatHistoryPage({
    selfGlobalMetaId,
    peerGlobalMetaId,
    startIndex: (input.afterIndex ?? -1) + 1,
    limit: input.limit,
    fetchImpl: input.fetchImpl,
    chatApiBaseUrl: input.chatApiBaseUrl,
  });
  return page.rows;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  const raw = normalizeText(value);
  if (!raw || !raw.startsWith('{')) return null;
  try {
    return readObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return '';
}

function resolveKnownParticipant(
  selfGlobalMetaId: string,
  peerGlobalMetaId: string,
  ...values: unknown[]
): string {
  const normalizedSelf = selfGlobalMetaId.toLowerCase();
  const normalizedPeer = peerGlobalMetaId.toLowerCase();
  for (const value of values) {
    const candidate = normalizeText(value).toLowerCase();
    if (candidate === normalizedSelf) return selfGlobalMetaId;
    if (candidate === normalizedPeer) return peerGlobalMetaId;
  }
  return '';
}

function oppositeParticipant(
  participant: string,
  selfGlobalMetaId: string,
  peerGlobalMetaId: string,
): string {
  if (participant === selfGlobalMetaId) return peerGlobalMetaId;
  if (participant === peerGlobalMetaId) return selfGlobalMetaId;
  return '';
}

function normalizeTimestamp(raw: unknown, fallbackNowMs: number): number {
  let value = Number(raw || 0);
  if (!Number.isFinite(value) || value <= 0) {
    value = fallbackNowMs;
  }
  if (value > 1_000_000_000_000) {
    return Math.floor(value / 1000);
  }
  return Math.floor(value);
}

function normalizeChain(rawChain: unknown): string {
  const raw = normalizeText(rawChain).toLowerCase();
  if (!raw) return '';
  if (raw === 'bsv' || raw === 'btc') return 'btc';
  if (raw === 'dogecoin' || raw === 'doge') return 'doge';
  if (raw === 'microvisionchain' || raw === 'mvc') return 'mvc';
  return raw;
}

function normalizeUserInfo(value: unknown): ChatViewerUserInfo | null {
  const record = readObject(value);
  if (!record) return null;

  const info: ChatViewerUserInfo = {};
  const globalMetaId = firstText(record.globalMetaId, record.globalmetaid);
  const metaid = firstText(record.metaid);
  const metaId = firstText(record.metaId);
  const name = firstText(record.name);
  const nickname = firstText(record.nickname, record.nickName);
  const avatar = firstText(record.avatar, record.avatarUrl, record.avatarImage);
  const avatarUri = firstText(record.avatarUri, record.avatar_uri);

  if (globalMetaId) info.globalMetaId = globalMetaId;
  if (metaid) info.metaid = metaid;
  if (metaId) info.metaId = metaId;
  if (name) info.name = name;
  if (nickname) info.nickname = nickname;
  if (avatar) info.avatar = avatar;
  if (avatarUri) info.avatarUri = avatarUri;

  return Object.keys(info).length > 0 ? info : null;
}

function buildStableId(input: {
  fromGlobalMetaId: string;
  toGlobalMetaId: string;
  index: number;
  timestamp: number;
  content: string;
}): string {
  const hash = createHash('sha256')
    .update([
      input.fromGlobalMetaId,
      input.toGlobalMetaId,
      String(input.index),
      String(input.timestamp),
      input.content,
    ].join('\n'))
    .digest('hex')
    .slice(0, 16);
  return `private_${hash}`;
}

function buildPayloadSnapshot(row: Record<string, unknown>): {
  rawData: string;
  cipherContent: string;
  payload: Record<string, unknown> | null;
} {
  const rawDataCandidate = firstText(row.rawData, row.raw_data);
  const contentCandidate = firstText(row.content, row.message);
  const rawPayload = parseJsonObject(rawDataCandidate);
  const contentPayload = parseJsonObject(contentCandidate);
  const payload = rawPayload || contentPayload;

  if (payload) {
    return {
      rawData: JSON.stringify(payload),
      cipherContent: firstText(payload.content, contentCandidate),
      payload,
    };
  }

  return {
    rawData: rawDataCandidate,
    cipherContent: contentCandidate,
    payload: null,
  };
}

function resolveFromGlobalMetaId(input: {
  row: Record<string, unknown>;
  fromUserInfo: ChatViewerUserInfo | null;
  userInfo: ChatViewerUserInfo | null;
  payloadTo: string;
  selfGlobalMetaId: string;
  peerGlobalMetaId: string;
}): string {
  const direct = resolveKnownParticipant(
    input.selfGlobalMetaId,
    input.peerGlobalMetaId,
    input.row.fromGlobalMetaId,
    input.row.from_meta_id,
    input.row.createGlobalMetaId,
    input.row.createUserMetaId,
    input.fromUserInfo?.globalMetaId,
    input.userInfo?.globalMetaId,
  );
  if (direct) return direct;

  const recipient = resolveKnownParticipant(
    input.selfGlobalMetaId,
    input.peerGlobalMetaId,
    input.row.toGlobalMetaId,
    input.row.to_meta_id,
    input.row.receiveGlobalMetaId,
    input.row.targetGlobalMetaId,
    input.payloadTo,
  );
  if (recipient) {
    return oppositeParticipant(recipient, input.selfGlobalMetaId, input.peerGlobalMetaId);
  }

  return firstText(
    input.row.fromGlobalMetaId,
    input.row.from_meta_id,
    input.row.createGlobalMetaId,
    input.row.createUserMetaId,
    input.fromUserInfo?.globalMetaId,
    input.userInfo?.globalMetaId,
  );
}

function resolveToGlobalMetaId(input: {
  row: Record<string, unknown>;
  payloadTo: string;
  fromGlobalMetaId: string;
  selfGlobalMetaId: string;
  peerGlobalMetaId: string;
}): string {
  const direct = resolveKnownParticipant(
    input.selfGlobalMetaId,
    input.peerGlobalMetaId,
    input.row.toGlobalMetaId,
    input.row.to_meta_id,
    input.row.receiveGlobalMetaId,
    input.row.targetGlobalMetaId,
    input.payloadTo,
  );
  if (direct) return direct;

  const sender = resolveKnownParticipant(
    input.selfGlobalMetaId,
    input.peerGlobalMetaId,
    input.fromGlobalMetaId,
  );
  if (sender) {
    return oppositeParticipant(sender, input.selfGlobalMetaId, input.peerGlobalMetaId);
  }

  return firstText(
    input.row.toGlobalMetaId,
    input.row.to_meta_id,
    input.row.receiveGlobalMetaId,
    input.row.targetGlobalMetaId,
    input.payloadTo,
  );
}

function normalizeTransactionId(rawTxId: unknown, pinId: string): string {
  const txId = normalizeText(rawTxId);
  if (!txId || txId !== pinId) return txId;
  const pinMatch = /^([0-9a-f]{64})i\d+$/iu.exec(pinId);
  return pinMatch?.[1] ?? txId;
}

function isFileProtocol(protocol: string): boolean {
  return protocol === '/protocols/simplefilemsg';
}

function decryptMessageContent(input: {
  localPrivateKeyHex: string;
  selfGlobalMetaId: string;
  peerChatPublicKey: string;
  fromGlobalMetaId: string;
  cipherContent: string;
  rawData: string;
  replyPin: string;
  protocol: string;
}): string {
  if (isFileProtocol(input.protocol)) {
    return UNSUPPORTED_FILE_TEXT;
  }

  try {
    const decrypted = receivePrivateChat({
      localIdentity: {
        globalMetaId: input.selfGlobalMetaId,
        privateKeyHex: input.localPrivateKeyHex,
      },
      peerChatPublicKey: input.peerChatPublicKey,
      payload: {
        fromGlobalMetaId: input.fromGlobalMetaId,
        content: input.cipherContent,
        rawData: input.rawData,
        replyPinId: input.replyPin,
      },
    });
    return decrypted.plaintext;
  } catch {
    return UNABLE_TO_DECRYPT_TEXT;
  }
}

function normalizeConversationRow(input: {
  row: unknown;
  selfGlobalMetaId: string;
  peerGlobalMetaId: string;
  localPrivateKeyHex: string;
  peerChatPublicKey: string;
  nowMs: number;
}): ChatViewerMessage {
  const row = readObject(input.row) ?? {};
  const fromUserInfo = normalizeUserInfo(row.fromUserInfo ?? row.from_user_info);
  const toUserInfo = normalizeUserInfo(row.toUserInfo ?? row.to_user_info);
  const userInfo = normalizeUserInfo(row.userInfo ?? row.user_info ?? row.fromUserInfo);
  const payloadSnapshot = buildPayloadSnapshot(row);
  const payloadTo = firstText(payloadSnapshot.payload?.to);
  const fromGlobalMetaId = resolveFromGlobalMetaId({
    row,
    fromUserInfo,
    userInfo,
    payloadTo,
    selfGlobalMetaId: input.selfGlobalMetaId,
    peerGlobalMetaId: input.peerGlobalMetaId,
  });
  const toGlobalMetaId = resolveToGlobalMetaId({
    row,
    payloadTo,
    fromGlobalMetaId,
    selfGlobalMetaId: input.selfGlobalMetaId,
    peerGlobalMetaId: input.peerGlobalMetaId,
  });
  const attachment = firstText(row.attachment);
  const protocol = firstText(row.protocol, row.path) || (attachment ? '/protocols/simplefilemsg' : '/protocols/simplemsg');
  const replyPin = firstText(row.replyPin, row.reply_pin, payloadSnapshot.payload?.replyPin, payloadSnapshot.payload?.replyPinId);
  const content = decryptMessageContent({
    localPrivateKeyHex: input.localPrivateKeyHex,
    selfGlobalMetaId: input.selfGlobalMetaId,
    peerChatPublicKey: input.peerChatPublicKey,
    fromGlobalMetaId,
    cipherContent: payloadSnapshot.cipherContent,
    rawData: payloadSnapshot.rawData,
    replyPin,
    protocol,
  });
  const timestamp = normalizeTimestamp(
    row.timestamp ?? row.time ?? payloadSnapshot.payload?.timestamp,
    input.nowMs,
  );
  const index = Number.isFinite(Number(row.index)) ? Math.floor(Number(row.index)) : 0;
  const pinId = firstText(row.pinId, row.pin_id);
  const txId = normalizeTransactionId(firstText(row.txId, row.tx_id, row.txid), pinId);
  const id = pinId || txId || buildStableId({
    fromGlobalMetaId,
    toGlobalMetaId,
    index,
    timestamp,
    content,
  });
  const chain = normalizeChain(row.chain ?? row.chainName ?? row.network ?? row.blockchain);

  return {
    id,
    ...(pinId ? { pinId } : {}),
    ...(txId ? { txId } : {}),
    protocol,
    type: '2',
    content,
    ...(firstText(row.contentType, row.content_type, payloadSnapshot.payload?.contentType) ? {
      contentType: firstText(row.contentType, row.content_type, payloadSnapshot.payload?.contentType),
    } : {}),
    timestamp,
    index,
    fromGlobalMetaId,
    toGlobalMetaId,
    ...(fromUserInfo ? { fromUserInfo } : {}),
    ...(toUserInfo ? { toUserInfo } : {}),
    ...(userInfo ? { userInfo } : {}),
    ...(replyPin ? { replyPin } : {}),
    replyInfo: null,
    ...(Array.isArray(row.mention) ? { mention: row.mention.slice() } : {}),
    ...(chain ? { chain } : {}),
  };
}

function sortMessages(messages: ChatViewerMessage[]): ChatViewerMessage[] {
  return messages.slice().sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return a.timestamp - b.timestamp;
  });
}

/** @internal */
export async function buildPrivateConversationResponse(
  input: BuildPrivateConversationResponseInput
): Promise<PrivateConversationResponse> {
  const selfGlobalMetaId = normalizeText(input.selfGlobalMetaId);
  const peerGlobalMetaId = normalizeText(input.peerGlobalMetaId);
  const localPrivateKeyHex = normalizeText(input.localPrivateKeyHex);
  const peerChatPublicKey = normalizeText(input.peerChatPublicKey);
  if (!selfGlobalMetaId) {
    throw new Error('selfGlobalMetaId is required');
  }
  if (!peerGlobalMetaId) {
    throw new Error('peerGlobalMetaId is required');
  }
  if (!localPrivateKeyHex) {
    throw new Error('localPrivateKeyHex is required');
  }
  if (!peerChatPublicKey) {
    throw new Error('peerChatPublicKey is required');
  }

  const limit = normalizeConversationLimit(input.limit);
  const afterIndex = normalizeConversationAfterIndex(input.afterIndex);
  const fetchHistory = input.fetchHistory ?? ((historyInput) => fetchPrivateChatHistory({
    ...historyInput,
    fetchImpl: input.fetchImpl,
    chatApiBaseUrl: input.chatApiBaseUrl,
  }));
  const rows = await fetchHistory({
    selfGlobalMetaId,
    peerGlobalMetaId,
    afterIndex,
    limit,
  });
  const nowMs = input.now ? input.now() : Date.now();
  const messages = sortMessages(rows.map((row) => normalizeConversationRow({
    row,
    selfGlobalMetaId,
    peerGlobalMetaId,
    localPrivateKeyHex,
    peerChatPublicKey,
    nowMs,
  })));
  const nextPollAfterIndex = messages.reduce((max, message) => {
    return Math.max(max, Number(message.index || 0));
  }, afterIndex ?? 0);

  return {
    ok: true,
    selfGlobalMetaId,
    peerGlobalMetaId,
    messages,
    nextPollAfterIndex,
    serverTime: Math.floor(nowMs),
  };
}
