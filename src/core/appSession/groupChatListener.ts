/**
 * Daemon-side group chat socket listener for the App/Game Runtime.
 *
 * Reuses the existing Metaso socket infrastructure (same endpoint and
 * `type: 'pc'` connection parameters as the MetaApp chat client and the A2A
 * simplemsg listener). The socket is a realtime notification only: the
 * runtime always catches up through `group-chat-list-by-index`. Messages that
 * do not belong to a running app session are ignored (normal group chat
 * traffic is not processed by the daemon).
 */

import { io, type Socket } from 'socket.io-client';
import type { IdentityProfileRecord } from '../identity/identityProfiles';
import type { GroupChatMessage } from './types';

const DEFAULT_RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export interface GroupChatSocketEndpoint {
  url: string;
  path: string;
}

export interface GroupChatSocketClient {
  on(event: string, handler: (...args: any[]) => void | Promise<void>): GroupChatSocketClient;
  emit(event: string, ...args: unknown[]): unknown;
  removeAllListeners(): unknown;
  disconnect(): unknown;
}

export interface GroupChatSocketOptions {
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

export type GroupChatSocketClientFactory = (
  endpoint: GroupChatSocketEndpoint,
  options: GroupChatSocketOptions,
) => GroupChatSocketClient;

export interface GroupChatListenerManager {
  start(): Promise<{ started: string[]; skipped: Array<{ slug: string; reason: string }> }>;
  stop(): void;
  isRunning(): boolean;
}

export interface GroupChatListenerOptions {
  systemHomeDir: string;
  listProfiles: () => Promise<IdentityProfileRecord[]>;
  resolveSocketEndpoints: () => Promise<GroupChatSocketEndpoint[]>;
  onGroupMessage: (profile: IdentityProfileRecord, message: GroupChatMessage) => void | Promise<void>;
  onError?: (error: Error) => void;
  socketClientFactory?: GroupChatSocketClientFactory;
  now?: () => number;
  logger?: (...args: unknown[]) => void;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function defaultSocketClientFactory(
  endpoint: GroupChatSocketEndpoint,
  options: GroupChatSocketOptions,
): GroupChatSocketClient {
  return io(endpoint.url, options) as Socket;
}

/**
 * Normalize a socket payload into a group chat message. Accepts the raw
 * message object, a `{ M, D }` envelope, or the two-element array form used by
 * older clients. Only group chat notifications are returned.
 */
export function normalizeGroupChatSocketPayload(data: unknown): GroupChatMessage | null {
  let parsed: unknown = data;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  if (Array.isArray(parsed) && parsed.length >= 2) {
    const eventName = normalizeText(parsed[0]);
    if (eventName === 'WS_SERVER_NOTIFY_GROUP_CHAT') {
      return normalizeGroupChatMessagePayload(parsed[1]);
    }
    return null;
  }
  const wrapper = normalizeObject(parsed);
  if (!wrapper) {
    return null;
  }
  const eventName = normalizeText(wrapper.M);
  if (eventName === 'WS_SERVER_NOTIFY_GROUP_CHAT') {
    return normalizeGroupChatMessagePayload(wrapper.D);
  }
  if (eventName === 'WS_RESPONSE_SUCCESS') {
    return normalizeGroupChatMessagePayload(
      normalizeObject(wrapper.D)?.data ?? wrapper.D,
    );
  }
  if (!eventName) {
    return normalizeGroupChatMessagePayload(parsed);
  }
  return null;
}

function normalizeGroupChatMessagePayload(raw: unknown): GroupChatMessage | null {
  const item = normalizeObject(raw);
  if (!item) {
    return null;
  }
  const groupId = normalizeText(
    item.groupId || item.groupID || item.channelId || item.channelID || item.metanetId,
  );
  if (!groupId) {
    return null;
  }
  const protocol = normalizeText(item.protocol || item.protocolPath || item.path);
  if (protocol && !['/protocols/simplegroupchat', '/protocols/simplefilegroupchat'].includes(protocol)) {
    return null;
  }
  return {
    groupId,
    index: Number.isFinite(Number(item.index)) ? Math.max(0, Math.trunc(Number(item.index))) : 0,
    senderMetaId: normalizeText(
      item.globalMetaId
      || item.fromGlobalMetaId
      || item.createGlobalMetaId
      || normalizeObject(item.userInfo)?.globalMetaId
      || normalizeObject(item.fromUserInfo)?.globalMetaId,
    ),
    timestamp: Number.isFinite(Number(item.timestamp))
      ? Math.trunc(Number(item.timestamp) < 1_000_000_000_000 ? Number(item.timestamp) * 1000 : Number(item.timestamp))
      : Date.now(),
    content: normalizeText(item.content),
    encryption: normalizeText(item.encryption || item.Encryption).toLowerCase(),
    protocol,
    pinId: normalizeText(item.pinId || item.pinID || item.id),
  };
}

export function createGroupChatListenerManager(options: GroupChatListenerOptions): GroupChatListenerManager {
  const socketClientFactory = options.socketClientFactory ?? defaultSocketClientFactory;
  const nowMs = options.now ?? (() => Date.now());
  const log = options.logger ?? (() => undefined);
  const listeners = new Map<string, GroupChatSocketClient>();
  const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
  let running = false;
  let lastStarted: string[] = [];
  let lastSkipped: Array<{ slug: string; reason: string }> = [];

  function startHeartbeat(socket: GroupChatSocketClient, slug: string): void {
    stopHeartbeat(slug);
    const timer = setInterval(() => {
      try {
        socket.emit?.('heartbeat', { metaid: '', at: nowMs() });
      } catch {
        // Heartbeat is best effort.
      }
    }, DEFAULT_HEARTBEAT_INTERVAL_MS);
    heartbeatTimers.set(slug, timer);
  }

  function stopHeartbeat(slug: string): void {
    const timer = heartbeatTimers.get(slug);
    if (timer) {
      clearInterval(timer);
      heartbeatTimers.delete(slug);
    }
  }

  async function connectProfile(profile: IdentityProfileRecord): Promise<{ ok: true } | { ok: false; reason: string }> {
    const slug = normalizeText(profile.slug) || normalizeText(profile.name);
    const globalMetaId = normalizeText(profile.globalMetaId);
    if (!slug || !globalMetaId) {
      return { ok: false, reason: 'profile has no globalMetaId' };
    }
    const endpoints = await options.resolveSocketEndpoints();
    if (!endpoints.length) {
      return { ok: false, reason: 'no socket endpoints configured' };
    }
    let activeEndpointIndex = 0;

    const registerSocket = (socket: GroupChatSocketClient, endpointIndex: number): void => {
      const handlePayload = async (data: unknown): Promise<void> => {
        const message = normalizeGroupChatSocketPayload(data);
        if (!message || !message.groupId) {
          return;
        }
        await options.onGroupMessage(profile, message);
      };
      socket.on('connect', () => {
        startHeartbeat(socket, slug);
        log(`[app-session group listener] ${slug} connected`);
      });
      socket.on('disconnect', () => {
        stopHeartbeat(slug);
      });
      socket.on('message', (data: unknown) => {
        void handlePayload(data).catch((error) => {
          options.onError?.(error instanceof Error ? error : new Error(String(error)));
        });
      });
      socket.on('WS_SERVER_NOTIFY_GROUP_CHAT', (data: unknown) => {
        void handlePayload(data).catch((error) => {
          options.onError?.(error instanceof Error ? error : new Error(String(error)));
        });
      });
      socket.on('connect_error', (error: Error) => {
        options.onError?.(error);
        stopHeartbeat(slug);
        if (endpointIndex !== activeEndpointIndex || endpointIndex >= endpoints.length - 1) {
          return;
        }
        activeEndpointIndex += 1;
        try {
          socket.removeAllListeners();
          socket.disconnect();
        } catch {
          // Best effort fallback shutdown.
        }
        connectEndpoint(activeEndpointIndex);
      });
    };

    const connectEndpoint = (endpointIndex: number): void => {
      const endpoint = endpoints[endpointIndex];
      if (!endpoint) {
        return;
      }
      const socket = socketClientFactory(endpoint, {
        path: endpoint.path,
        query: { metaid: globalMetaId, type: 'pc' },
        reconnection: true,
        reconnectionDelay: DEFAULT_RECONNECT_DELAY_MS,
        reconnectionDelayMax: MAX_RECONNECT_DELAY_MS,
        transports: ['websocket', 'polling'],
      });
      listeners.set(slug, socket);
      registerSocket(socket, endpointIndex);
    };

    connectEndpoint(0);
    return { ok: true };
  }

  return {
    async start() {
      if (running) {
        return { started: lastStarted, skipped: lastSkipped };
      }
      running = true;
      lastStarted = [];
      lastSkipped = [];
      const profiles = await options.listProfiles();
      for (const profile of profiles) {
        const slug = normalizeText(profile.slug) || normalizeText(profile.name);
        if (!slug) {
          continue;
        }
        try {
          const result = await connectProfile(profile);
          if (result.ok) {
            lastStarted.push(slug);
          } else {
            lastSkipped.push({ slug, reason: result.reason });
          }
        } catch (error) {
          lastSkipped.push({
            slug,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { started: lastStarted, skipped: lastSkipped };
    },
    stop() {
      running = false;
      for (const [slug, socket] of listeners.entries()) {
        stopHeartbeat(slug);
        try {
          socket.removeAllListeners();
          socket.disconnect();
        } catch {
          // Best effort shutdown.
        }
      }
      listeners.clear();
    },
    isRunning() {
      return running;
    },
  };
}
