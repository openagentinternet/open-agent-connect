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
  senderGlobalMetaIdFromPrivateChatSocketMessage,
  type MetaWebPrivateMessage,
  type PrivateChatListenerIdentity,
} from '../chat/privateChatListener';
import type { PrivateChatInboundMessage } from '../chat/privateChatTypes';
import {
  persistA2AConversationMessage,
  persistA2AConversationMessageBestEffort,
  type A2AConversationMessagePersister,
} from './conversationPersistence';
import { resolveMetasoInfrastructureEndpoints } from '../network/metasoInfrastructure';

const DEFAULT_SOCKET_ENDPOINTS = [resolveMetasoInfrastructureEndpoints().socket];

const DEFAULT_RECONNECT_DELAY_MS = 15_000;
const MAX_RECONNECT_DELAY_MS = 300_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
// Circuit breaker: after this many consecutive handshake failures the profile
// stops reconnecting entirely and probes once per breaker-probe interval, so
// an unreachable relay degrades to a trickle instead of a reconnect storm.
const CIRCUIT_BREAKER_FAILURES_BEFORE_OPEN = 5;
const CIRCUIT_BREAKER_PROBE_MS = 10 * 60_000;
const MAX_SEEN_PIN_IDS = 5_000;

export interface A2ASimplemsgSocketEndpoint {
  url: string;
  path: string;
}

export interface A2ASimplemsgSocketClient {
  on(event: string, handler: (...args: any[]) => void | Promise<void>): A2ASimplemsgSocketClient;
  emit(event: string, ...args: any[]): unknown;
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
  /** socket.io retry knobs; unused when `reconnection` is false (the listener owns retries). */
  reconnectionDelay?: number;
  reconnectionDelayMax?: number;
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
  getLastReport(): A2ASimplemsgListenerStartReport;
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
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return Date.now();
  }
  // MetaSO delivers timestamps in Unix seconds; normalize to milliseconds so
  // stored messages order correctly next to locally persisted millisecond ones.
  return Math.trunc(value < 1_000_000_000_000 ? value * 1000 : value);
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
  heartbeatIntervalMs: number;
  onMessage?: (profile: IdentityProfileRecord, message: PrivateChatInboundMessage) => void | Promise<void>;
  onError?: (error: Error) => void;
}): ProfileSimplemsgListener {
  let sockets: A2ASimplemsgSocketClient[] = [];
  const seenPinIds = new Set<string>();
  let activeEndpointIndex = 0;
  let heartbeatSocket: A2ASimplemsgSocketClient | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  // Reconnection circuit breaker state (the profile listener is recreated on
  // every manager start, so this state naturally resets across watchdog
  // restarts).
  let failureStreak = 0;
  let breakerOpen = false;
  let everConnected = false;
  let manuallyStopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let probeTimer: ReturnType<typeof setTimeout> | null = null;

  const stopHeartbeat = (socket?: A2ASimplemsgSocketClient): void => {
    if (socket && heartbeatSocket !== socket) return;
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    heartbeatSocket = null;
  };

  const sendHeartbeat = (socket: A2ASimplemsgSocketClient): void => {
    try {
      socket.emit('ping');
    } catch (error) {
      input.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const startHeartbeat = (socket: A2ASimplemsgSocketClient): void => {
    stopHeartbeat();
    heartbeatSocket = socket;
    sendHeartbeat(socket);
    heartbeatInterval = setInterval(() => {
      if (heartbeatSocket) {
        sendHeartbeat(heartbeatSocket);
      }
    }, input.heartbeatIntervalMs);
    heartbeatInterval.unref?.();
  };

  const handleSocketPayload = async (payload: unknown): Promise<void> => {
    const message = normalizeSimplemsgSocketMessage(payload);
    if (!message) return;

    const fromGlobalMetaId = senderGlobalMetaIdFromPrivateChatSocketMessage(message);
    if (!fromGlobalMetaId) return;

    const localGlobalMetaId = normalizeText(input.identity.globalMetaId);
    const toGlobalMetaId = normalizeText(message.toGlobalMetaId);
    if (toGlobalMetaId && toGlobalMetaId !== localGlobalMetaId) {
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
    if (!plaintext) {
      // Allow a redelivery (e.g. after reconnect) to succeed once the peer key
      // becomes resolvable, and keep the drop observable instead of silent.
      if (messagePinId) {
        seenPinIds.delete(messagePinId);
      }
      input.onError?.(new Error(
        `dropped undecryptable simplemsg push (pinId: ${messagePinId ?? 'unknown'}, from: ${fromGlobalMetaId})`,
      ));
      return;
    }

    const inboundMessage: PrivateChatInboundMessage = {
      fromGlobalMetaId,
      content: plaintext,
      contentType: normalizeText(message.contentType) || normalizeText(message.content_type) || null,
      messagePinId,
      fromChatPublicKey: peerChatPublicKey,
      timestamp: toFiniteTimestamp(message.timestamp),
      rawMessage: normalizeObject(message),
    };

    const persistResult = await persistA2AConversationMessageBestEffort({
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
        contentType: inboundMessage.contentType,
        pinId: messagePinId,
        txid: normalizeText(message.txId) || null,
        replyPinId: normalizeText(message.replyPin) || null,
        chain: 'mvc',
        timestamp: inboundMessage.timestamp,
        raw: inboundMessage.rawMessage,
      },
    }, input.persister);
    if (!persistResult.persisted) {
      input.onError?.(new Error(
        `failed to persist simplemsg push (pinId: ${messagePinId ?? 'unknown'}, from: ${fromGlobalMetaId}): ${persistResult.errorMessage ?? 'unknown error'}`,
      ));
    }
    await input.onMessage?.(input.profile, inboundMessage);
  };

  const registerSocket = (socket: A2ASimplemsgSocketClient, endpointIndex: number): void => {
    socket.on('connect', () => {
      everConnected = true;
      failureStreak = 0;
      breakerOpen = false;
      if (probeTimer) {
        clearTimeout(probeTimer);
        probeTimer = null;
      }
      startHeartbeat(socket);
    });
    socket.on('disconnect', () => {
      stopHeartbeat(socket);
      if (manuallyStopped) return;
      // A failed handshake surfaces through connect_error; only an established
      // connection dropping here counts toward the breaker.
      if (!everConnected) return;
      activeEndpointIndex = 0;
      recordConnectionFailure();
    });
    socket.on('heartbeat_ack', () => {
      // The ack confirms that the Metaso socket registered the heartbeat ping.
    });
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
      stopHeartbeat(socket);
      if (manuallyStopped) return;
      if (endpointIndex === activeEndpointIndex && endpointIndex < input.endpoints.length - 1) {
        // Fail over to the next endpoint once.
        activeEndpointIndex += 1;
        try {
          socket.removeAllListeners();
          socket.disconnect();
        } catch {
          // Best effort fallback shutdown.
        }
        connectEndpoint(activeEndpointIndex);
        return;
      }
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {
        // Best effort fallback shutdown.
      }
      recordConnectionFailure();
    });
  };

  const connectEndpoint = (endpointIndex: number): void => {
    const endpoint = input.endpoints[endpointIndex];
    if (!endpoint) return;
    // The listener owns reconnection through the circuit breaker below, so
    // socket.io's built-in retry loop stays off.
    const socket = input.socketClientFactory(endpoint, {
      path: endpoint.path,
      query: {
        metaid: input.identity.globalMetaId,
        type: 'pc',
      },
      reconnection: false,
      transports: ['websocket'],
    });
    registerSocket(socket, endpointIndex);
    sockets.push(socket);
  };

  const clearReconnectTimers = (): void => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (probeTimer) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
  };

  /** Stop retrying and wait for a half-open probe instead of hammering. */
  const openBreaker = (): void => {
    breakerOpen = true;
    probeTimer = setTimeout(() => {
      probeTimer = null;
      if (manuallyStopped) return;
      breakerOpen = false;
      failureStreak = 0;
      activeEndpointIndex = 0;
      connectEndpoint(activeEndpointIndex);
    }, CIRCUIT_BREAKER_PROBE_MS);
    probeTimer.unref?.();
  };

  /** Retry once after an exponential backoff between 15s and 5min. */
  const scheduleReconnect = (): void => {
    if (retryTimer || breakerOpen || manuallyStopped) return;
    const exponent = Math.min(Math.max(failureStreak - 1, 0), 8);
    const delay = Math.min(input.reconnectDelayMs * (2 ** exponent), input.maxReconnectDelayMs);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (manuallyStopped || breakerOpen) return;
      activeEndpointIndex = 0;
      connectEndpoint(activeEndpointIndex);
    }, delay);
    retryTimer.unref?.();
  };

  const recordConnectionFailure = (): void => {
    if (manuallyStopped) return;
    failureStreak += 1;
    if (failureStreak >= CIRCUIT_BREAKER_FAILURES_BEFORE_OPEN) {
      openBreaker();
      return;
    }
    scheduleReconnect();
  };

  return {
    start() {
      if (sockets.length > 0) return;
      manuallyStopped = false;
      breakerOpen = false;
      failureStreak = 0;
      everConnected = false;
      activeEndpointIndex = 0;
      connectEndpoint(activeEndpointIndex);
    },

    stop() {
      manuallyStopped = true;
      stopHeartbeat();
      clearReconnectTimers();
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
  resolveSocketEndpoints?: (
    profile: IdentityProfileRecord,
  ) => Promise<A2ASimplemsgSocketEndpoint[]> | A2ASimplemsgSocketEndpoint[];
  socketClientFactory?: A2ASimplemsgSocketClientFactory;
  resolvePeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
  persister?: A2AConversationMessagePersister;
  listProfiles?: (systemHomeDir: string) => Promise<IdentityProfileRecord[]>;
  loadProfileIdentity?: (profile: IdentityProfileRecord) => Promise<LoadedProfileIdentity | null>;
  onMessage?: (profile: IdentityProfileRecord, message: PrivateChatInboundMessage) => void | Promise<void>;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
  onError?: (error: Error) => void;
}): A2ASimplemsgListenerManager {
  const socketClientFactory = input.socketClientFactory ?? defaultSocketClientFactory;
  const persister = input.persister ?? persistA2AConversationMessage;
  const listProfiles = input.listProfiles ?? listIdentityProfiles;
  const loadIdentity = input.loadProfileIdentity ?? loadProfileIdentity;
  const reconnectDelayMs = input.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const maxReconnectDelayMs = input.maxReconnectDelayMs ?? MAX_RECONNECT_DELAY_MS;
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
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

        const endpoints = input.socketEndpoints
          ?? await input.resolveSocketEndpoints?.(profile)
          ?? DEFAULT_SOCKET_ENDPOINTS;

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
          heartbeatIntervalMs,
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

    getLastReport() {
      return {
        started: lastReport.started.map((profile) => ({ ...profile })),
        skipped: lastReport.skipped.map((profile) => ({ ...profile })),
      };
    },
  };
}
