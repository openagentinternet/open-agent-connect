import path from 'node:path';
import { type MetabotPaths, resolveMetabotPaths } from '../state/paths';
import {
  createA2AConversationStore,
} from './conversationStore';
import type {
  A2AConversationActor,
  A2AConversationLocalProfile,
  A2AConversationMessage,
  A2AConversationPeerProfile,
  A2AOrderConversationSession,
} from './conversationTypes';
import { classifySimplemsgContent } from './simplemsgClassifier';

const SENSITIVE_RAW_METADATA_KEYS = new Set([
  'content',
  'payload',
  'rawdata',
  'encryptedcontent',
  'encryptedpayload',
  'secret',
  'secretvariant',
  'privatekey',
  'privatekeyhex',
]);

export interface PersistA2AConversationMessageInput {
  homeDir?: string;
  paths?: MetabotPaths;
  local: A2AConversationLocalProfile;
  peer: A2AConversationPeerProfile;
  message: {
    messageId?: string | null;
    direction: 'incoming' | 'outgoing';
    content: string;
    contentType?: string | null;
    chain?: string | null;
    pinId?: string | null;
    txid?: string | null;
    txids?: string[] | null;
    replyPinId?: string | null;
    timestamp?: number | null;
    chainTimestamp?: number | null;
    orderTxid?: string | null;
    paymentTxid?: string | null;
    raw?: Record<string, unknown> | null;
  };
  orderSession?: Partial<A2AOrderConversationSession> | null;
}

export type A2AConversationMessagePersister = (
  input: PersistA2AConversationMessageInput
) => Promise<A2AConversationMessage>;

export interface PersistA2AConversationMessageBestEffortResult {
  persisted: boolean;
  message: A2AConversationMessage | null;
  errorMessage: string | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeGlobalMetaIdPrefix(value: unknown): string {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized.length < 8) {
    throw new Error('globalMetaId must be at least 8 characters for A2A conversation persistence.');
  }
  return normalized.slice(0, 8);
}

function normalizeTxids(value: string[] | null | undefined): string[] {
  return Array.isArray(value)
    ? value.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
}

function isSensitiveRawMetadataKey(key: string): boolean {
  return SENSITIVE_RAW_METADATA_KEYS.has(key.toLowerCase());
}

function sanitizeRawMetadataValue(
  value: unknown,
  seen: WeakSet<object>,
  depth = 0,
): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth > 16 || seen.has(value)) {
    return null;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeRawMetadataValue(entry, seen, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveRawMetadataKey(key)) {
      continue;
    }
    const nextValue = sanitizeRawMetadataValue(nestedValue, seen, depth + 1);
    if (nextValue !== undefined) {
      sanitized[key] = nextValue;
    }
  }
  return sanitized;
}

export function sanitizeA2ARawMetadata(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  const sanitized = sanitizeRawMetadataValue(raw, new WeakSet<object>());
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : null;
}

function normalizeActor(actor: A2AConversationActor): A2AConversationActor {
  return {
    ...actor,
    globalMetaId: normalizeText(actor.globalMetaId),
    name: normalizeText(actor.name) || null,
    avatar: normalizeText(actor.avatar) || null,
    chatPublicKey: normalizeText(actor.chatPublicKey) || null,
  };
}

export function buildA2APeerSessionId(localGlobalMetaId: string, peerGlobalMetaId: string): string {
  return `a2a-peer-${normalizeGlobalMetaIdPrefix(localGlobalMetaId)}-${normalizeGlobalMetaIdPrefix(peerGlobalMetaId)}`;
}

export function buildA2AOrderSessionId(orderTxid: string): string {
  const normalized = normalizeText(orderTxid);
  if (!normalized) {
    throw new Error('orderTxid is required to build an A2A order session id.');
  }
  return `a2a-order-${normalized}`;
}

function buildMessageId(input: {
  explicit?: string | null;
  pinId?: string | null;
  txid?: string | null;
  txids: string[];
  sessionId: string;
  direction: 'incoming' | 'outgoing';
  timestamp: number;
}): string {
  return normalizeText(input.explicit)
    || normalizeText(input.pinId)
    || normalizeText(input.txid)
    || normalizeText(input.txids[0])
    || `${input.sessionId}-${input.direction}-${input.timestamp}`;
}

export async function persistA2AConversationMessage(
  input: PersistA2AConversationMessageInput,
): Promise<A2AConversationMessage> {
  const paths = input.paths ?? (input.homeDir ? resolveMetabotPaths(input.homeDir) : null);
  if (!paths) {
    throw new Error('homeDir or paths is required for A2A conversation persistence.');
  }

  const local = {
    ...input.local,
    profileSlug: normalizeText(input.local.profileSlug) || path.basename(paths.profileRoot),
  };
  const peer = input.peer;
  const localGlobalMetaId = normalizeText(local.globalMetaId);
  const peerGlobalMetaId = normalizeText(peer.globalMetaId);
  const sessionId = buildA2APeerSessionId(localGlobalMetaId, peerGlobalMetaId);
  const txids = normalizeTxids(input.message.txids);
  const txid = normalizeText(input.message.txid) || txids[0] || null;
  const timestamp = Number.isFinite(input.message.timestamp)
    ? Math.trunc(Number(input.message.timestamp))
    : Date.now();
  const classification = classifySimplemsgContent(input.message.content);
  const classifiedOrderTxid = classification.kind === 'order_protocol'
    ? classification.orderTxid
    : null;
  const orderTxid = normalizeText(input.message.orderTxid) || classifiedOrderTxid || null;
  const orderSessionId = orderTxid ? buildA2AOrderSessionId(orderTxid) : null;
  const sender = normalizeActor(input.message.direction === 'outgoing' ? local : peer);
  const recipient = normalizeActor(input.message.direction === 'outgoing' ? peer : local);
  const message: A2AConversationMessage = {
    messageId: buildMessageId({
      explicit: input.message.messageId,
      pinId: input.message.pinId,
      txid,
      txids,
      sessionId,
      direction: input.message.direction,
      timestamp,
    }),
    sessionId,
    orderSessionId,
    direction: input.message.direction,
    kind: classification.kind,
    protocolTag: classification.kind === 'order_protocol' ? classification.tag : null,
    orderTxid,
    paymentTxid: normalizeText(input.message.paymentTxid) || null,
    content: String(input.message.content ?? ''),
    contentType: normalizeText(input.message.contentType) || 'text/plain',
    chain: normalizeText(input.message.chain) || null,
    pinId: normalizeText(input.message.pinId) || null,
    txid,
    txids,
    replyPinId: normalizeText(input.message.replyPinId) || null,
    timestamp,
    chainTimestamp: Number.isFinite(input.message.chainTimestamp)
      ? Math.trunc(Number(input.message.chainTimestamp))
      : null,
    sender,
    recipient,
    raw: sanitizeA2ARawMetadata(input.message.raw),
  };

  const store = createA2AConversationStore({ paths, local, peer });
  await store.appendMessages([message]);
  await store.upsertSession({
    sessionId,
    type: 'peer',
    state: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
    latestMessageId: message.messageId,
  });
  if (orderSessionId && orderTxid) {
    await store.upsertSession({
      sessionId: orderSessionId,
      type: 'service_order',
      role: input.orderSession?.role ?? 'caller',
      state: input.orderSession?.state ?? 'awaiting_delivery',
      orderTxid,
      paymentTxid: normalizeText(input.orderSession?.paymentTxid) || message.paymentTxid,
      servicePinId: normalizeText(input.orderSession?.servicePinId) || null,
      serviceName: normalizeText(input.orderSession?.serviceName) || null,
      outputType: normalizeText(input.orderSession?.outputType) || null,
      createdAt: Number.isFinite(input.orderSession?.createdAt)
        ? Math.trunc(Number(input.orderSession?.createdAt))
        : timestamp,
      updatedAt: timestamp,
      firstResponseAt: input.orderSession?.firstResponseAt ?? null,
      deliveredAt: input.orderSession?.deliveredAt ?? null,
      ratingRequestedAt: input.orderSession?.ratingRequestedAt ?? null,
      endedAt: input.orderSession?.endedAt ?? null,
      endReason: normalizeText(input.orderSession?.endReason) || null,
      failureReason: normalizeText(input.orderSession?.failureReason) || null,
    });
  }
  return message;
}

export async function persistA2AConversationMessageBestEffort(
  input: PersistA2AConversationMessageInput,
  persister: A2AConversationMessagePersister = persistA2AConversationMessage,
): Promise<PersistA2AConversationMessageBestEffortResult> {
  try {
    const message = await persister(input);
    return {
      persisted: true,
      message,
      errorMessage: null,
    };
  } catch (error) {
    return {
      persisted: false,
      message: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
