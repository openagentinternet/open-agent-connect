import { io, type Socket } from 'socket.io-client';
import { listIdentityProfiles, type IdentityProfileRecord } from '../identity/identityProfiles';
import { createFileSecretStore } from '../secrets/fileSecretStore';
import type { LocalIdentitySecrets } from '../secrets/secretStore';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import { createLocalMnemonicSigner } from '../signing/localMnemonicSigner';
import {
  decryptPrivateChatSocketMessage,
  normalizePrivateChatSocketMessage,
  pinIdFromPrivateChatSocketMessage,
  type MetaWebPrivateMessage,
  type PrivateChatListenerIdentity,
} from '../chat/privateChatListener';
import type { PrivateChatInboundMessage } from '../chat/privateChatTypes';
import {
  persistA2AConversationMessage,
  persistA2AConversationMessageBestEffort,
  type A2AConversationMessagePersister,
} from './conversationPersistence';

const DEFAULT_SOCKET_ENDPOINTS = [
  { url: 'wss://api.idchat.io', path: '/socket/socket.io' },
  { url: 'wss://www.show.now', path: '/socket/socket.io' },
];

const DEFAULT_RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const MAX_SEEN_PIN_IDS = 5_000;

export interface A2ASimplemsgSocketEndpoint {
  url: string;
  path: string;
}

export interface A2ASimplemsgSocketClient {
  on(event: string, handler: (...args: any[]) => void | Promise<void>): A2ASimplemsgSocketClient;
  removeAllListeners(): unknown;
  disconnect(): unknown;
}

export interface A2ASimplemsgSocketOptions {
  path: string;
  query: {
    metaid: string;
    type: 'pc';
  };
  reconnection: boolean;
  reconnectionDelay: number;
  reconnectionDelayMax: number;
  transports: string[];
}

export type A2ASimplemsgSocketClientFactory = (
  endpoint: A2ASimplemsgSocketEndpoint,
  options: A2ASimplemsgSocketOptions
) => A2ASimplemsgSocketClient;

export interface A2ASimplemsgStartedProfile {
  slug: string;
  name: string;
  homeDir: string;
  globalMetaId: string;
}

export interface A2ASimplemsgSkippedProfile {
  slug: string;
  name: string;
  homeDir: string;
  globalMetaId: string | null;
  reason: string;
}

export interface A2ASimplemsgListenerStartReport {
  started: A2ASimplemsgStartedProfile[];
  skipped: A2ASimplemsgSkippedProfile[];
}

export interface A2ASimplemsgListenerManager {
  start(): Promise<A2ASimplemsgListenerStartReport>;
  stop(): void;
  isRunning(): boolean;
}

interface LoadedProfileIdentity {
  paths: MetabotPaths;
  identity: PrivateChatListenerIdentity;
}

interface ProfileSimplemsgListener {
  start(): void;
  stop(): void;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toFiniteTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : Date.now();
}

function defaultSocketClientFactory(
  endpoint: A2ASimplemsgSocketEndpoint,
  options: A2ASimplemsgSocketOptions,
): A2ASimplemsgSocketClient {
  return io(endpoint.url, options) as Socket;
}

function deduplicateByPinId(seenPinIds: Set<string>, pinId: string | null): boolean {
  if (!pinId) return true;
  if (seenPinIds.has(pinId)) return false;
  seenPinIds.add(pinId);
  if (seenPinIds.size > MAX_SEEN_PIN_IDS) {
    const iterator = seenPinIds.values();
    for (let i = 0; i < 1000; i += 1) {
      const next = iterator.next();
      if (next.done) break;
      seenPinIds.delete(next.value);
    }
  }
  return true;
}

async function loadProfileIdentity(profile: IdentityProfileRecord): Promise<LoadedProfileIdentity | null> {
  const paths = resolveMetabotPaths(profile.homeDir);
  const profileGlobalMetaId = normalizeText(profile.globalMetaId);
  const secretStore = createFileSecretStore(paths);
  const secrets = await secretStore.readIdentitySecrets<LocalIdentitySecrets>();
  const secretGlobalMetaId = normalizeText(secrets?.globalMetaId);
  let globalMetaId = secretGlobalMetaId || profileGlobalMetaId;
  let privateKeyHex = normalizeText(secrets?.privateKeyHex);
  let chatPublicKey = normalizeText(secrets?.chatPublicKey);

  if (profileGlobalMetaId && secretGlobalMetaId && profileGlobalMetaId !== secretGlobalMetaId) {
    return null;
  }

  if (!globalMetaId || !privateKeyHex || !chatPublicKey) {
    const signer = createLocalMnemonicSigner({ secretStore });
    const derived = await signer.getPrivateChatIdentity();
    globalMetaId = normalizeText(derived.globalMetaId);
    privateKeyHex = normalizeText(derived.privateKeyHex);
    chatPublicKey = normalizeText(derived.chatPublicKey);
  }

  if (!globalMetaId || !privateKeyHex || !chatPublicKey) {
    return null;
  }
  if (profileGlobalMetaId && profileGlobalMetaId !== globalMetaId) {
    return null;
  }

  return {
    paths,
    identity: {
      globalMetaId,
      privateKeyHex,
      chatPublicKey,
    },
  };
}

export function normalizeSimplemsgSocketMessage(data: unknown): MetaWebPrivateMessage | null {
  return normalizePrivateChatSocketMessage(data);
}

function createProfileSimplemsgListener(input: {
  profile: IdentityProfileRecord;
  paths: MetabotPaths;
  identity: PrivateChatListenerIdentity;
  endpoints: A2ASimplemsgSocketEndpoint[];
  socketClientFactory: A2ASimplemsgSocketClientFactory;
  resolvePeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
  persister: A2AConversationMessagePersister;
  reconnectDelayMs: number;
  maxReconnectDelayMs: number;
  onMessage?: (profile: IdentityProfileRecord, message: PrivateChatInboundMessage) => void | Promise<void>;
  onError?: (error: Error) => void;
}): ProfileSimplemsgListener {
  let sockets: A2ASimplemsgSocketClient[] = [];
  const seenPinIds = new Set<string>();

  const handleSocketPayload = async (payload: unknown): Promise<void> => {
    const message = normalizeSimplemsgSocketMessage(payload);
    if (!message) return;

    const fromGlobalMetaId = normalizeText(message.fromGlobalMetaId);
    if (!fromGlobalMetaId) return;

    const localGlobalMetaId = normalizeText(input.identity.globalMetaId);
    const toGlobalMetaId = normalizeText(message.toGlobalMetaId);
    if (toGlobalMetaId !== localGlobalMetaId) {
      return;
    }
    if (fromGlobalMetaId === localGlobalMetaId) {
      return;
    }

    const messagePinId = pinIdFromPrivateChatSocketMessage(message);
    if (!deduplicateByPinId(seenPinIds, messagePinId)) return;

    let peerChatPublicKey = normalizeText(message.fromUserInfo?.chatPublicKey) || null;
    if (!peerChatPublicKey && input.resolvePeerChatPublicKey) {
      try {
        peerChatPublicKey = await input.resolvePeerChatPublicKey(fromGlobalMetaId);
      } catch {
        // Peer key lookup is best-effort; decryption will skip if it is unavailable.
      }
    }

    const plaintext = decryptPrivateChatSocketMessage(message, input.identity, peerChatPublicKey);
    if (!plaintext) return;

    const inboundMessage: PrivateChatInboundMessage = {
      fromGlobalMetaId,
      content: plaintext,
      messagePinId,
      fromChatPublicKey: peerChatPublicKey,
      timestamp: toFiniteTimestamp(message.timestamp),
      rawMessage: normalizeObject(message),
    };

    await persistA2AConversationMessageBestEffort({
      paths: input.paths,
      local: {
        profileSlug: input.profile.slug,
        globalMetaId: localGlobalMetaId,
        name: input.profile.name,
        chatPublicKey: input.identity.chatPublicKey,
      },
      peer: {
        globalMetaId: fromGlobalMetaId,
        name: normalizeText(message.fromUserInfo?.name) || null,
        avatar: normalizeText(message.fromUserInfo?.avatar) || null,
        chatPublicKey: peerChatPublicKey,
      },
      message: {
        messageId: messagePinId,
        direction: 'incoming',
        content: plaintext,
        pinId: messagePinId,
        txid: normalizeText(message.txId) || null,
        replyPinId: normalizeText(message.replyPin) || null,
        chain: 'mvc',
        timestamp: inboundMessage.timestamp,
        raw: inboundMessage.rawMessage,
      },
    }, input.persister);
    await input.onMessage?.(input.profile, inboundMessage);
  };

  const registerSocket = (socket: A2ASimplemsgSocketClient): void => {
    socket.on('message', async (data: unknown) => {
      await handleSocketPayload(data).catch((error) => {
        input.onError?.(error instanceof Error ? error : new Error(String(error)));
      });
    });
    socket.on('WS_SERVER_NOTIFY_PRIVATE_CHAT', async (data: unknown) => {
      await handleSocketPayload(['WS_SERVER_NOTIFY_PRIVATE_CHAT', data]).catch((error) => {
        input.onError?.(error instanceof Error ? error : new Error(String(error)));
      });
    });
    socket.on('WS_RESPONSE_SUCCESS', async (data: unknown) => {
      await handleSocketPayload(['WS_RESPONSE_SUCCESS', data]).catch((error) => {
        input.onError?.(error instanceof Error ? error : new Error(String(error)));
      });
    });
    socket.on('connect_error', (error: Error) => {
      input.onError?.(error);
    });
  };

  return {
    start() {
      if (sockets.length > 0) return;
      for (const endpoint of input.endpoints) {
        const socket = input.socketClientFactory(endpoint, {
          path: endpoint.path,
          query: {
            metaid: input.identity.globalMetaId,
            type: 'pc',
          },
          reconnection: true,
          reconnectionDelay: input.reconnectDelayMs,
          reconnectionDelayMax: input.maxReconnectDelayMs,
          transports: ['websocket'],
        });
        registerSocket(socket);
        sockets.push(socket);
      }
    },

    stop() {
      for (const socket of sockets) {
        try {
          socket.removeAllListeners();
          socket.disconnect();
        } catch {
          // Best effort shutdown.
        }
      }
      sockets = [];
      seenPinIds.clear();
    },
  };
}

export function createA2ASimplemsgListenerManager(input: {
  systemHomeDir: string;
  socketEndpoints?: A2ASimplemsgSocketEndpoint[];
  socketClientFactory?: A2ASimplemsgSocketClientFactory;
  resolvePeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
  persister?: A2AConversationMessagePersister;
  listProfiles?: (systemHomeDir: string) => Promise<IdentityProfileRecord[]>;
  loadProfileIdentity?: (profile: IdentityProfileRecord) => Promise<LoadedProfileIdentity | null>;
  onMessage?: (profile: IdentityProfileRecord, message: PrivateChatInboundMessage) => void | Promise<void>;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  onError?: (error: Error) => void;
}): A2ASimplemsgListenerManager {
  const endpoints = input.socketEndpoints ?? DEFAULT_SOCKET_ENDPOINTS;
  const socketClientFactory = input.socketClientFactory ?? defaultSocketClientFactory;
  const persister = input.persister ?? persistA2AConversationMessage;
  const listProfiles = input.listProfiles ?? listIdentityProfiles;
  const loadIdentity = input.loadProfileIdentity ?? loadProfileIdentity;
  const reconnectDelayMs = input.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const maxReconnectDelayMs = input.maxReconnectDelayMs ?? MAX_RECONNECT_DELAY_MS;
  let listeners: ProfileSimplemsgListener[] = [];
  let running = false;
  let lastReport: A2ASimplemsgListenerStartReport = { started: [], skipped: [] };

  return {
    async start() {
      if (running) {
        return lastReport;
      }

      const profiles = await listProfiles(input.systemHomeDir);
      const started: A2ASimplemsgStartedProfile[] = [];
      const skipped: A2ASimplemsgSkippedProfile[] = [];
      const nextListeners: ProfileSimplemsgListener[] = [];

      for (const profile of profiles) {
        const globalMetaId = normalizeText(profile.globalMetaId) || null;
        let loaded: LoadedProfileIdentity | null = null;
        try {
          loaded = await loadIdentity(profile);
        } catch (error) {
          skipped.push({
            slug: profile.slug,
            name: profile.name,
            homeDir: profile.homeDir,
            globalMetaId,
            reason: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        if (!loaded) {
          skipped.push({
            slug: profile.slug,
            name: profile.name,
            homeDir: profile.homeDir,
            globalMetaId,
            reason: 'identity_secret_missing',
          });
          continue;
        }

        const listener = createProfileSimplemsgListener({
          profile,
          paths: loaded.paths,
          identity: loaded.identity,
          endpoints,
          socketClientFactory,
          resolvePeerChatPublicKey: input.resolvePeerChatPublicKey,
          persister,
          reconnectDelayMs,
          maxReconnectDelayMs,
          onMessage: input.onMessage,
          onError: input.onError,
        });
        listener.start();
        nextListeners.push(listener);
        started.push({
          slug: profile.slug,
          name: profile.name,
          homeDir: profile.homeDir,
          globalMetaId: loaded.identity.globalMetaId,
        });
      }

      listeners = nextListeners;
      running = true;
      lastReport = { started, skipped };
      return lastReport;
    },

    stop() {
      for (const listener of listeners) {
        listener.stop();
      }
      listeners = [];
      running = false;
      lastReport = { started: [], skipped: [] };
    },

    isRunning() {
      return running;
    },
  };
}
