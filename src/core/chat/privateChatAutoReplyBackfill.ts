import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';
import type { PrivateChatStateStore } from './privateChatStateStore';
import type {
  PrivateChatInboundMessage,
  PrivateChatMessage,
  PrivateChatState,
} from './privateChatTypes';
import {
  buildPrivateConversationResponse,
  fetchPrivateChatHistoryPage,
  type ChatViewerMessage,
  type PrivateConversationResponse,
} from './privateConversation';

const CURSOR_STATE_VERSION = 1;
const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_RECENT_LIMIT = 100;
const DEFAULT_STARTUP_CATCH_UP_MS = 6 * 60 * 60 * 1000;
const UNABLE_TO_DECRYPT_TEXT = '[Unable to decrypt message]';
const UNSUPPORTED_FILE_TEXT = '[Unsupported file message]';

export interface LocalPrivateChatIdentity {
  globalMetaId?: string | null;
  privateKeyHex: string;
  chatPublicKey?: string | null;
}

export interface PrivateChatAutoReplyBackfillHistoryInput {
  selfGlobalMetaId: string;
  peerGlobalMetaId: string;
  localPrivateKeyHex: string;
  peerChatPublicKey: string;
  limit: number;
}

export interface PrivateChatAutoReplyBackfillHistoryAfterInput
  extends PrivateChatAutoReplyBackfillHistoryInput {
  afterIndex: number;
}

export interface PrivateChatAutoReplyBackfillHistoryClient {
  fetchRecent(input: PrivateChatAutoReplyBackfillHistoryInput): Promise<PrivateConversationResponse>;
  fetchAfter(input: PrivateChatAutoReplyBackfillHistoryAfterInput): Promise<PrivateConversationResponse>;
}

export interface PrivateChatAutoReplyBackfillDependencies {
  paths: MetabotPaths;
  stateStore: PrivateChatStateStore;
  selfGlobalMetaId: () => Promise<string | null>;
  getLocalPrivateChatIdentity: () => Promise<LocalPrivateChatIdentity>;
  resolvePeerChatPublicKey: (globalMetaId: string) => Promise<string | null>;
  handleInboundMessage: (message: PrivateChatInboundMessage) => Promise<void>;
  historyClient?: PrivateChatAutoReplyBackfillHistoryClient;
  listPeerGlobalMetaIds?: () => Promise<string[]>;
  now?: () => number;
  onError?: (error: Error) => void;
}

export interface PrivateChatAutoReplyBackfillOptions {
  intervalMs?: number;
  recentLimit?: number;
  startupCatchUpMs?: number;
  cursorPath?: string;
}

export interface PrivateChatAutoReplyBackfillSyncResult {
  peers: number;
  processed: number;
  skipped: number;
  failed: number;
}

export interface PrivateChatAutoReplyBackfillLoop {
  syncOnce(): Promise<PrivateChatAutoReplyBackfillSyncResult>;
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

interface CursorPeerState {
  afterIndex: number;
  updatedAt: number;
}

interface CursorState {
  version: number;
  peers: Record<string, CursorPeerState>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeGlobalMetaId(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function normalizeEpochSeconds(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric > 1_000_000_000_000 ? numeric / 1000 : numeric);
}

function emptyCursorState(): CursorState {
  return {
    version: CURSOR_STATE_VERSION,
    peers: {},
  };
}

function normalizeCursorState(value: unknown): CursorState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptyCursorState();
  }
  const record = value as Record<string, unknown>;
  const peersRecord = record.peers && typeof record.peers === 'object' && !Array.isArray(record.peers)
    ? record.peers as Record<string, unknown>
    : {};
  const peers: Record<string, CursorPeerState> = {};
  for (const [rawPeer, rawState] of Object.entries(peersRecord)) {
    const peer = normalizeGlobalMetaId(rawPeer);
    const state = rawState && typeof rawState === 'object' && !Array.isArray(rawState)
      ? rawState as Record<string, unknown>
      : null;
    const afterIndex = Number(state?.afterIndex);
    if (!peer || !Number.isFinite(afterIndex) || afterIndex < 0) {
      continue;
    }
    peers[peer] = {
      afterIndex: Math.floor(afterIndex),
      updatedAt: Number.isFinite(Number(state?.updatedAt))
        ? Math.floor(Number(state?.updatedAt))
        : 0,
    };
  }
  return {
    version: CURSOR_STATE_VERSION,
    peers,
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function readCursorState(cursorPath: string): Promise<CursorState> {
  return normalizeCursorState(await readJsonFile<CursorState>(cursorPath));
}

async function writeCursorState(cursorPath: string, state: CursorState): Promise<void> {
  await writeJsonFileAtomically(cursorPath, normalizeCursorState(state));
}

async function listA2AConversationPeerGlobalMetaIds(paths: MetabotPaths): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(paths.a2aRoot);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw error;
  }

  const peers: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith('chat-') || !entry.endsWith('.json')) {
      continue;
    }
    try {
      const raw = await fs.readFile(path.join(paths.a2aRoot, entry), 'utf8');
      const parsed = JSON.parse(raw) as { peer?: { globalMetaId?: unknown } };
      const peer = normalizeText(parsed.peer?.globalMetaId);
      if (peer) peers.push(peer);
    } catch {
      continue;
    }
  }
  return peers;
}

function collectProcessedMessageIds(state: PrivateChatState): Set<string> {
  const ids = new Set<string>();
  for (const message of state.messages) {
    const messageId = normalizeText(message.messageId);
    const pinId = normalizeText(message.messagePinId);
    if (messageId) ids.add(messageId);
    if (pinId) ids.add(pinId);
  }
  return ids;
}

function mapConversationPeerById(state: PrivateChatState): Map<string, string> {
  const byId = new Map<string, string>();
  for (const conversation of state.conversations) {
    const conversationId = normalizeText(conversation.conversationId);
    const peer = normalizeText(conversation.peerGlobalMetaId);
    if (conversationId && peer) {
      byId.set(conversationId, peer);
    }
  }
  return byId;
}

function collectLatestInboundTimestampByPeer(state: PrivateChatState): Map<string, number> {
  const conversationPeerById = mapConversationPeerById(state);
  const latestByPeer = new Map<string, number>();
  for (const message of state.messages) {
    if (message.direction !== 'inbound') continue;
    const peer = normalizeGlobalMetaId(
      conversationPeerById.get(message.conversationId) || message.senderGlobalMetaId,
    );
    if (!peer) continue;
    const timestampSeconds = normalizeEpochSeconds(message.timestamp);
    latestByPeer.set(peer, Math.max(latestByPeer.get(peer) ?? 0, timestampSeconds));
  }
  return latestByPeer;
}

async function collectKnownPeerGlobalMetaIds(
  deps: PrivateChatAutoReplyBackfillDependencies,
  state: PrivateChatState,
  selfGlobalMetaId: string,
): Promise<string[]> {
  const peers = new Map<string, string>();
  const addPeer = (value: unknown): void => {
    const peer = normalizeText(value);
    const key = normalizeGlobalMetaId(peer);
    if (!peer || !key || key === normalizeGlobalMetaId(selfGlobalMetaId)) return;
    peers.set(key, peer);
  };

  for (const conversation of state.conversations) {
    addPeer(conversation.peerGlobalMetaId);
  }
  for (const peer of await listA2AConversationPeerGlobalMetaIds(deps.paths)) {
    addPeer(peer);
  }
  if (deps.listPeerGlobalMetaIds) {
    for (const peer of await deps.listPeerGlobalMetaIds()) {
      addPeer(peer);
    }
  }

  return Array.from(peers.values());
}

function isReplyableIncomingMessage(
  message: ChatViewerMessage,
  selfGlobalMetaId: string,
  peerGlobalMetaId: string,
): boolean {
  if (normalizeGlobalMetaId(message.fromGlobalMetaId) !== normalizeGlobalMetaId(peerGlobalMetaId)) {
    return false;
  }
  if (normalizeGlobalMetaId(message.toGlobalMetaId) !== normalizeGlobalMetaId(selfGlobalMetaId)) {
    return false;
  }
  if (message.protocol && message.protocol !== '/protocols/simplemsg') {
    return false;
  }
  const content = normalizeText(message.content);
  return Boolean(content)
    && content !== UNABLE_TO_DECRYPT_TEXT
    && content !== UNSUPPORTED_FILE_TEXT;
}

function shouldProcessInitialMessage(input: {
  message: ChatViewerMessage;
  peerGlobalMetaId: string;
  latestInboundTimestampByPeer: Map<string, number>;
  nowMs: number;
  startupCatchUpMs: number;
}): boolean {
  const messageTimestampSeconds = normalizeEpochSeconds(input.message.timestamp);
  if (!messageTimestampSeconds) return false;
  const nowSeconds = normalizeEpochSeconds(input.nowMs);
  const catchUpCutoffSeconds = nowSeconds - Math.floor(input.startupCatchUpMs / 1000);
  if (messageTimestampSeconds < catchUpCutoffSeconds) return false;
  const latestInbound = input.latestInboundTimestampByPeer.get(
    normalizeGlobalMetaId(input.peerGlobalMetaId),
  ) ?? 0;
  return latestInbound <= 0 || messageTimestampSeconds > latestInbound;
}

function createRawBackfillMessage(message: ChatViewerMessage): Record<string, unknown> {
  return {
    source: 'private-chat-history-backfill',
    pinId: normalizeText(message.pinId) || null,
    txId: normalizeText(message.txId) || null,
    index: message.index,
    protocol: message.protocol,
  };
}

function toInboundMessage(message: ChatViewerMessage, peerChatPublicKey: string): PrivateChatInboundMessage {
  return {
    fromGlobalMetaId: message.fromGlobalMetaId,
    content: message.content,
    messagePinId: normalizeText(message.pinId) || normalizeText(message.txId) || message.id || null,
    fromChatPublicKey: peerChatPublicKey,
    timestamp: message.timestamp,
    rawMessage: createRawBackfillMessage(message),
  };
}

function createDefaultHistoryClient(): PrivateChatAutoReplyBackfillHistoryClient {
  return {
    async fetchRecent(input) {
      const firstPage = await fetchPrivateChatHistoryPage({
        selfGlobalMetaId: input.selfGlobalMetaId,
        peerGlobalMetaId: input.peerGlobalMetaId,
        startIndex: 0,
        limit: 1,
      });
      const startIndex = firstPage.total === null
        ? 0
        : Math.max(0, firstPage.total - input.limit);
      const page = await fetchPrivateChatHistoryPage({
        selfGlobalMetaId: input.selfGlobalMetaId,
        peerGlobalMetaId: input.peerGlobalMetaId,
        startIndex,
        limit: input.limit,
      });
      return buildPrivateConversationResponse({
        selfGlobalMetaId: input.selfGlobalMetaId,
        peerGlobalMetaId: input.peerGlobalMetaId,
        localPrivateKeyHex: input.localPrivateKeyHex,
        peerChatPublicKey: input.peerChatPublicKey,
        afterIndex: startIndex > 0 ? startIndex - 1 : undefined,
        limit: input.limit,
        fetchHistory: async () => page.rows,
      });
    },

    async fetchAfter(input) {
      return buildPrivateConversationResponse({
        selfGlobalMetaId: input.selfGlobalMetaId,
        peerGlobalMetaId: input.peerGlobalMetaId,
        localPrivateKeyHex: input.localPrivateKeyHex,
        peerChatPublicKey: input.peerChatPublicKey,
        afterIndex: input.afterIndex,
        limit: input.limit,
      });
    },
  };
}

function getMessageDedupId(message: ChatViewerMessage): string {
  return normalizeText(message.pinId) || normalizeText(message.txId) || normalizeText(message.id);
}

export function createPrivateChatAutoReplyBackfillLoop(
  deps: PrivateChatAutoReplyBackfillDependencies,
  options: PrivateChatAutoReplyBackfillOptions = {},
): PrivateChatAutoReplyBackfillLoop {
  const intervalMs = normalizePositiveInteger(options.intervalMs, DEFAULT_INTERVAL_MS);
  const recentLimit = normalizePositiveInteger(options.recentLimit, DEFAULT_RECENT_LIMIT);
  const startupCatchUpMs = normalizePositiveInteger(
    options.startupCatchUpMs,
    DEFAULT_STARTUP_CATCH_UP_MS,
  );
  const cursorPath = options.cursorPath
    ?? path.join(deps.paths.stateRoot, 'private-chat-auto-reply-backfill.json');
  const historyClient = deps.historyClient ?? createDefaultHistoryClient();
  const getNow = deps.now ?? (() => Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;
  let syncing = false;

  const syncOnce = async (): Promise<PrivateChatAutoReplyBackfillSyncResult> => {
    const selfGlobalMetaId = normalizeText(await deps.selfGlobalMetaId());
    if (!selfGlobalMetaId) {
      return { peers: 0, processed: 0, skipped: 0, failed: 0 };
    }

    const localIdentity = await deps.getLocalPrivateChatIdentity();
    const localPrivateKeyHex = normalizeText(localIdentity.privateKeyHex);
    if (!localPrivateKeyHex) {
      return { peers: 0, processed: 0, skipped: 0, failed: 0 };
    }

    const state = await deps.stateStore.readState();
    const processedIds = collectProcessedMessageIds(state);
    const latestInboundTimestampByPeer = collectLatestInboundTimestampByPeer(state);
    const peers = await collectKnownPeerGlobalMetaIds(deps, state, selfGlobalMetaId);
    const cursorState = await readCursorState(cursorPath);
    let cursorChanged = false;
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const peerGlobalMetaId of peers) {
      const peerKey = normalizeGlobalMetaId(peerGlobalMetaId);
      const peerChatPublicKey = normalizeText(await deps.resolvePeerChatPublicKey(peerGlobalMetaId));
      if (!peerChatPublicKey) {
        skipped += 1;
        continue;
      }

      const existingCursor = cursorState.peers[peerKey];
      let response: PrivateConversationResponse;
      try {
        response = existingCursor
          ? await historyClient.fetchAfter({
            selfGlobalMetaId,
            peerGlobalMetaId,
            localPrivateKeyHex,
            peerChatPublicKey,
            afterIndex: existingCursor.afterIndex,
            limit: recentLimit,
          })
          : await historyClient.fetchRecent({
            selfGlobalMetaId,
            peerGlobalMetaId,
            localPrivateKeyHex,
            peerChatPublicKey,
            limit: recentLimit,
          });
      } catch (error) {
        failed += 1;
        deps.onError?.(error instanceof Error ? error : new Error(String(error)));
        continue;
      }

      let peerFailed = false;
      for (const message of response.messages) {
        if (!isReplyableIncomingMessage(message, selfGlobalMetaId, peerGlobalMetaId)) {
          skipped += 1;
          continue;
        }
        const dedupId = getMessageDedupId(message);
        if (dedupId && processedIds.has(dedupId)) {
          skipped += 1;
          continue;
        }
        if (!existingCursor && !shouldProcessInitialMessage({
          message,
          peerGlobalMetaId,
          latestInboundTimestampByPeer,
          nowMs: getNow(),
          startupCatchUpMs,
        })) {
          skipped += 1;
          continue;
        }

        try {
          await deps.handleInboundMessage(toInboundMessage(message, peerChatPublicKey));
          if (dedupId) processedIds.add(dedupId);
          processed += 1;
        } catch (error) {
          failed += 1;
          peerFailed = true;
          deps.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      }

      if (!peerFailed) {
        const nextAfterIndex = Math.max(
          existingCursor?.afterIndex ?? 0,
          Number.isFinite(Number(response.nextPollAfterIndex))
            ? Math.floor(Number(response.nextPollAfterIndex))
            : 0,
        );
        cursorState.peers[peerKey] = {
          afterIndex: nextAfterIndex,
          updatedAt: getNow(),
        };
        cursorChanged = true;
      }
    }

    if (cursorChanged) {
      await writeCursorState(cursorPath, cursorState);
    }

    return {
      peers: peers.length,
      processed,
      skipped,
      failed,
    };
  };

  const runBackgroundSync = (): void => {
    if (syncing) return;
    syncing = true;
    void syncOnce()
      .catch((error) => {
        deps.onError?.(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        syncing = false;
      });
  };

  return {
    syncOnce,

    start() {
      if (timer) return;
      runBackgroundSync();
      timer = setInterval(runBackgroundSync, intervalMs);
      timer.unref?.();
    },

    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },

    isRunning() {
      return timer !== null;
    },
  };
}
