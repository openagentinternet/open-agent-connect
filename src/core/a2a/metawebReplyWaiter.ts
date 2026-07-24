import { io, type Socket } from 'socket.io-client';
import { receivePrivateChat } from '../chat/privateChat';
import {
  normalizeOrderProtocolTxid,
  parseNeedsRatingMessage as parseA2ANeedsRatingMessage,
} from './protocol/orderProtocol';
import {
  cleanServiceResultText,
  parseDeliveryMessage,
} from '../orders/serviceOrderProtocols';
import {
  normalizeDeliveryArtifacts,
  type A2ADeliveryArtifact,
} from './deliveryArtifacts';
import {
  resolveMetasoInfrastructureEndpoints,
  type MetasoSocketEndpoint,
} from '../network/metasoInfrastructure';

const DEFAULT_SOCKET_ENDPOINTS = [resolveMetasoInfrastructureEndpoints().socket];
const DEFAULT_NEEDS_RATING_GRACE_MS = 3_000;

export interface AwaitMetaWebServiceReplyInput {
  callerGlobalMetaId: string;
  callerPrivateKeyHex: string;
  providerGlobalMetaId: string;
  providerChatPublicKey?: string | null;
  servicePinId: string;
  paymentTxid: string;
  orderTxid?: string | null;
  timeoutMs: number;
}

export type AwaitMetaWebServiceReplyResult =
  | {
      state: 'completed';
      responseText: string;
      deliveryPinId: string | null;
      observedAt: number | null;
      rawMessage: Record<string, unknown> | null;
      artifacts: A2ADeliveryArtifact[];
      ratingRequestText?: string | null;
      ratingRequestOrderPinId?: string | null;
      ratingRequestPinId?: string | null;
      ratingRequestObservedAt?: number | null;
      ratingRawMessage?: Record<string, unknown> | null;
    }
  | {
      state: 'timeout';
    };

export interface MetaWebServiceReplyWaiter {
  awaitServiceReply(input: AwaitMetaWebServiceReplyInput): Promise<AwaitMetaWebServiceReplyResult>;
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

export function normalizeOrderProtocolReference(value: unknown): string {
  const text = normalizeText(value).toLowerCase();
  const normalizedTxid = normalizeOrderProtocolTxid(text);
  if (normalizedTxid) return normalizedTxid;
  const pinMatch = text.match(/^([0-9a-f]{64})i\d+$/i);
  return pinMatch ? normalizeOrderProtocolTxid(pinMatch[1]) : '';
}

export function shouldAcceptServiceDeliveryForReplyWaiter(input: {
  delivery: {
    orderTxid?: unknown;
    paymentTxid?: unknown;
    servicePinId?: unknown;
  };
  expected: {
    orderTxid?: unknown;
    paymentTxid?: unknown;
    servicePinId?: unknown;
  };
}): boolean {
  const deliveryOrderTxid = normalizeOrderProtocolReference(input.delivery.orderTxid);
  const expectedOrderTxid = normalizeOrderProtocolReference(input.expected.orderTxid);
  const deliveryPaymentTxid = normalizeText(input.delivery.paymentTxid);
  const expectedPaymentTxid = normalizeText(input.expected.paymentTxid);
  const deliveryServicePinId = normalizeText(input.delivery.servicePinId);
  const expectedServicePinId = normalizeText(input.expected.servicePinId);
  const matchesPayment = Boolean(
    deliveryPaymentTxid
    && expectedPaymentTxid
    && deliveryPaymentTxid === expectedPaymentTxid
  );
  const matchesService = Boolean(
    deliveryServicePinId
    && expectedServicePinId
    && deliveryServicePinId === expectedServicePinId
  );

  if (deliveryOrderTxid) {
    if (expectedOrderTxid) {
      return deliveryOrderTxid === expectedOrderTxid;
    }
    return matchesPayment;
  }

  return matchesPayment || matchesService;
}

export function shouldAcceptServiceRatingRequestForReplyWaiter(input: {
  ratingOrderTxid?: unknown;
  expectedOrderTxid?: unknown;
  pendingDeliveryOrderTxid?: unknown;
}): boolean {
  const ratingOrderTxid = normalizeOrderProtocolReference(input.ratingOrderTxid);
  if (!ratingOrderTxid) {
    return true;
  }

  const expectedOrderTxid = normalizeOrderProtocolReference(input.expectedOrderTxid);
  if (expectedOrderTxid) {
    return ratingOrderTxid === expectedOrderTxid;
  }

  const pendingDeliveryOrderTxid = normalizeOrderProtocolReference(input.pendingDeliveryOrderTxid);
  return Boolean(pendingDeliveryOrderTxid && ratingOrderTxid === pendingDeliveryOrderTxid);
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
  input: AwaitMetaWebServiceReplyInput,
): boolean {
  return (
    normalizeText(message.fromGlobalMetaId) === normalizeText(input.providerGlobalMetaId)
    && normalizeText(message.toGlobalMetaId) === normalizeText(input.callerGlobalMetaId)
  );
}

function decryptInboundPlaintext(
  message: MetaWebPrivateMessage,
  input: AwaitMetaWebServiceReplyInput,
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
    return normalizeText(received.plaintext) || null;
  } catch {
    return null;
  }
}

export function createSocketIoMetaWebReplyWaiter(options: {
  resolveSocketEndpoints?: () => Promise<MetasoSocketEndpoint[]> | MetasoSocketEndpoint[];
} = {}): MetaWebServiceReplyWaiter {
  return {
    async awaitServiceReply(input: AwaitMetaWebServiceReplyInput): Promise<AwaitMetaWebServiceReplyResult> {
      const timeoutMs = Number.isFinite(input.timeoutMs)
        ? Math.max(250, Math.floor(input.timeoutMs))
        : 15_000;
      const endpoints = options.resolveSocketEndpoints
        ? await options.resolveSocketEndpoints()
        : DEFAULT_SOCKET_ENDPOINTS;

      return new Promise((resolve) => {
        let settled = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        let ratingGraceHandle: ReturnType<typeof setTimeout> | null = null;
        const sockets: Socket[] = [];
        let pendingDelivery: Omit<Extract<AwaitMetaWebServiceReplyResult, { state: 'completed' }>, 'state'> | null = null;
        let pendingDeliveryOrderTxid: string | null = null;

        const finish = (result: AwaitMetaWebServiceReplyResult) => {
          if (settled) return;
          settled = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
          if (ratingGraceHandle) {
            clearTimeout(ratingGraceHandle);
            ratingGraceHandle = null;
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

        for (const endpoint of endpoints) {
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

          const handleSocketData = (data: unknown) => {
            if (settled) return;
            const message = extractSocketMessage(data);
            if (!message || !matchesExpectedPeer(message, input)) {
              return;
            }

            const plaintext = decryptInboundPlaintext(message, input);
            if (!plaintext) {
              return;
            }

            const ratingRequest = parseA2ANeedsRatingMessage(plaintext);
            if (ratingRequest && pendingDelivery) {
              if (!shouldAcceptServiceRatingRequestForReplyWaiter({
                ratingOrderTxid: ratingRequest.orderTxid,
                expectedOrderTxid: input.orderTxid,
                pendingDeliveryOrderTxid,
              })) {
                return;
              }
              finish({
                state: 'completed',
                ...pendingDelivery,
                ratingRequestText: ratingRequest.content,
                ratingRequestOrderPinId: ratingRequest.orderPinId ?? null,
                ratingRequestPinId: pinIdFromMessage(message),
                ratingRequestObservedAt: typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
                  ? message.timestamp
                  : null,
                ratingRawMessage: normalizeObject(message),
              });
              return;
            }

            const delivery = parseDeliveryMessage(plaintext);
            if (!delivery) {
              return;
            }

            if (!shouldAcceptServiceDeliveryForReplyWaiter({
              delivery,
              expected: input,
            })) {
              return;
            }

            pendingDeliveryOrderTxid = normalizeOrderProtocolReference(delivery.orderTxid) || null;
            const resultText = normalizeText(delivery.result);
            pendingDelivery = {
              responseText: cleanServiceResultText(resultText) || resultText,
              deliveryPinId: pinIdFromMessage(message),
              observedAt: typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
                ? message.timestamp
                : null,
              rawMessage: normalizeObject(message),
              artifacts: normalizeDeliveryArtifacts({
                artifacts: delivery.artifacts,
                resultText,
              }),
              ratingRequestText: null,
            };
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
              timeoutHandle = null;
            }
            if (ratingGraceHandle) {
              clearTimeout(ratingGraceHandle);
            }
            ratingGraceHandle = setTimeout(() => {
              if (!pendingDelivery) {
                finish({ state: 'timeout' });
                return;
              }
              finish({
                state: 'completed',
                ...pendingDelivery,
              });
            }, DEFAULT_NEEDS_RATING_GRACE_MS);
          };

          // MetaSO may deliver private-chat pushes either on the raw 'message'
          // channel or as named socket.io events; subscribe to all of them so a
          // reply delivered via a named event does not silently time out.
          socket.on('message', handleSocketData);
          socket.on('WS_SERVER_NOTIFY_PRIVATE_CHAT', (data: unknown) => {
            handleSocketData(['WS_SERVER_NOTIFY_PRIVATE_CHAT', data]);
          });
          socket.on('WS_RESPONSE_SUCCESS', (data: unknown) => {
            handleSocketData(['WS_RESPONSE_SUCCESS', data]);
          });
        }
      });
    },
  };
}
