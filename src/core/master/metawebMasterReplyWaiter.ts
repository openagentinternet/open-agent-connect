import { io, type Socket } from 'socket.io-client';
import { receivePrivateChat } from '../chat/privateChat';
import { parseMasterResponse, type MasterResponseMessage } from './masterMessageSchema';

const DEFAULT_SOCKET_ENDPOINTS = [
  { url: 'wss://api.idchat.io', path: '/socket/socket.io' },
  { url: 'wss://www.show.now', path: '/socket/socket.io' },
];

export interface AwaitMetaWebMasterReplyInput {
  callerGlobalMetaId: string;
  callerPrivateKeyHex: string;
  providerGlobalMetaId: string;
  providerChatPublicKey?: string | null;
  masterServicePinId: string;
  requestId: string;
  traceId: string;
  timeoutMs: number;
}

export type AwaitMetaWebMasterReplyResult =
  | {
      state: 'completed';
      response: MasterResponseMessage;
      responseJson: string;
      deliveryPinId: string | null;
      observedAt: number | null;
      rawMessage: Record<string, unknown> | null;
    }
  | {
      state: 'timeout';
    };

export interface MetaWebMasterReplyWaiter {
  awaitMasterReply(input: AwaitMetaWebMasterReplyInput): Promise<AwaitMetaWebMasterReplyResult>;
}

interface MetaWebUserInfo {
  chatPublicKey?: string | null;
}

interface MetaWebPrivateMessage {
  txId?: string | null;
  pinId?: string | null;
  content?: string | null;
  timestamp?: number | null;
  replyPin?: string | null;
  fromGlobalMetaId?: string | null;
  toGlobalMetaId?: string | null;
  fromUserInfo?: MetaWebUserInfo | null;
  toUserInfo?: MetaWebUserInfo | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pinIdFromMessage(message: MetaWebPrivateMessage): string | null {
  const pinId = normalizeText(message.pinId);
  if (pinId) return pinId;
  const txId = normalizeText(message.txId);
  return txId ? `${txId}i0` : null;
}

function extractSocketMessage(data: unknown): MetaWebPrivateMessage | null {
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
    const payload = normalizeObject(parsed[1]);
    if (eventName === 'WS_SERVER_NOTIFY_PRIVATE_CHAT') {
      return payload as MetaWebPrivateMessage;
    }
    if (eventName === 'WS_RESPONSE_SUCCESS') {
      return normalizeObject(payload?.data) as MetaWebPrivateMessage | null;
    }
    return null;
  }

  const wrapper = normalizeObject(parsed);
  if (!wrapper) {
    return null;
  }

  const eventName = normalizeText(wrapper.M);
  const payload = normalizeObject(wrapper.D);
  if (eventName === 'WS_SERVER_NOTIFY_PRIVATE_CHAT') {
    return payload as MetaWebPrivateMessage;
  }
  if (eventName === 'WS_RESPONSE_SUCCESS') {
    return normalizeObject(payload?.data) as MetaWebPrivateMessage | null;
  }
  return null;
}

function matchesExpectedPeer(
  message: MetaWebPrivateMessage,
  input: AwaitMetaWebMasterReplyInput,
): boolean {
  return (
    normalizeText(message.fromGlobalMetaId) === normalizeText(input.providerGlobalMetaId)
    && normalizeText(message.toGlobalMetaId) === normalizeText(input.callerGlobalMetaId)
  );
}

function decryptInboundPlaintext(
  message: MetaWebPrivateMessage,
  input: AwaitMetaWebMasterReplyInput,
): string | null {
  const peerChatPublicKey = normalizeText(message.fromUserInfo?.chatPublicKey)
    || normalizeText(input.providerChatPublicKey);
  if (!peerChatPublicKey) {
    return null;
  }

  try {
    const received = receivePrivateChat({
      localIdentity: {
        globalMetaId: input.callerGlobalMetaId,
        privateKeyHex: input.callerPrivateKeyHex,
      },
      peerChatPublicKey,
      payload: {
        fromGlobalMetaId: normalizeText(message.fromGlobalMetaId),
        content: normalizeText(message.content) || null,
        rawData: normalizeText(message.content)
          ? JSON.stringify({ content: normalizeText(message.content) })
          : null,
        replyPinId: normalizeText(message.replyPin),
      },
    });
    return normalizeText(received.plaintextJson) || null;
  } catch {
    return null;
  }
}

function matchesExpectedResponse(
  response: MasterResponseMessage,
  input: AwaitMetaWebMasterReplyInput,
): boolean {
  return (
    normalizeText(response.requestId) === normalizeText(input.requestId)
    && normalizeText(response.traceId) === normalizeText(input.traceId)
    && normalizeText(response.responder.providerGlobalMetaId) === normalizeText(input.providerGlobalMetaId)
    && normalizeText(response.responder.masterServicePinId) === normalizeText(input.masterServicePinId)
  );
}

export function createSocketIoMetaWebMasterReplyWaiter(): MetaWebMasterReplyWaiter {
  return {
    awaitMasterReply(input: AwaitMetaWebMasterReplyInput): Promise<AwaitMetaWebMasterReplyResult> {
      const timeoutMs = Number.isFinite(input.timeoutMs)
        ? Math.max(250, Math.floor(input.timeoutMs))
        : 15_000;

      return new Promise((resolve) => {
        let settled = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        const sockets: Socket[] = [];

        const finish = (result: AwaitMetaWebMasterReplyResult) => {
          if (settled) return;
          settled = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
          for (const socket of sockets) {
            try {
              socket.removeAllListeners();
              socket.disconnect();
            } catch {
              // Best effort cleanup.
            }
          }
          resolve(result);
        };

        timeoutHandle = setTimeout(() => {
          finish({ state: 'timeout' });
        }, timeoutMs);

        for (const endpoint of DEFAULT_SOCKET_ENDPOINTS) {
          const socket = io(endpoint.url, {
            path: endpoint.path,
            query: {
              metaid: input.callerGlobalMetaId,
              type: 'pc',
            },
            reconnection: false,
            transports: ['websocket'],
          });
          sockets.push(socket);

          socket.on('message', (data: unknown) => {
            if (settled) return;
            const message = extractSocketMessage(data);
            if (!message || !matchesExpectedPeer(message, input)) {
              return;
            }

            const plaintext = decryptInboundPlaintext(message, input);
            if (!plaintext) {
              return;
            }

            const parsed = parseMasterResponse(plaintext);
            if (!parsed.ok || !matchesExpectedResponse(parsed.value, input)) {
              return;
            }

            finish({
              state: 'completed',
              response: parsed.value,
              responseJson: plaintext,
              deliveryPinId: pinIdFromMessage(message),
              observedAt: typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
                ? message.timestamp
                : null,
              rawMessage: normalizeObject(message),
            });
          });
        }
      });
    },
  };
}
