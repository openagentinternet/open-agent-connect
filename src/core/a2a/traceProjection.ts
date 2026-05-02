import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths } from '../state/paths';
import {
  parseDeliveryMessage,
  parseNeedsRatingMessage,
  parseOrderEndMessage,
  parseOrderStatusMessage,
} from './protocol/orderProtocol';
import type {
  A2AConversationMessage,
  A2AConversationSession,
  A2AConversationState,
  A2AOrderConversationSession,
} from './conversationTypes';

export interface A2ATraceProjectionProfile {
  name?: string | null;
  slug?: string | null;
  homeDir: string;
  globalMetaId?: string | null;
}

export interface A2ATraceProjectionDaemon {
  baseUrl?: string | null;
}

export interface UnifiedA2ATraceSessionListItem {
  source: 'unified_a2a';
  sessionKind: 'peer' | 'service_order' | string;
  sessionId: string;
  traceId: string;
  role: 'caller' | 'provider';
  state: string;
  createdAt: number;
  updatedAt: number;
  localMetabotName: string;
  localMetabotGlobalMetaId: string;
  localMetabotAvatar: string | null;
  peerGlobalMetaId: string;
  peerName: string | null;
  peerAvatar: string | null;
  callerGlobalMetaId: string;
  providerGlobalMetaId: string;
  servicePinId: string;
  serviceName: string | null;
  outputType: string | null;
  orderTxid: string | null;
  paymentTxid: string | null;
  localUiUrl?: string;
}

export interface UnifiedA2ATraceTranscriptItem {
  id: string;
  sessionId: string;
  taskRunId: null;
  timestamp: number;
  type: string;
  sender: 'caller' | 'provider' | 'system';
  content: string;
  metadata: Record<string, unknown>;
}

export interface UnifiedA2ATraceSessionDetail {
  source: 'unified_a2a';
  traceId: string;
  sessionId: string;
  session: Record<string, unknown>;
  transcriptItems: UnifiedA2ATraceTranscriptItem[];
  taskRuns: [];
  publicStatusSnapshots: Array<Record<string, unknown>>;
  order: Record<string, unknown> | null;
  orderPinId: string | null;
  orderTxid: string | null;
  orderTxids: string[];
  paymentTxid: string | null;
  localUiUrl?: string;
  a2a: Record<string, unknown>;
  artifacts: {
    transcriptMarkdownPath: null;
    traceMarkdownPath: null;
    traceJsonPath: null;
  };
  resultText: string | null;
  responseText: string | null;
  resultObservedAt: number | null;
  resultDeliveryPinId: string | null;
  ratingRequestText: string | null;
  ratingRequestedAt: number | null;
  ratingRequested: boolean;
  ratingPublished: boolean;
  ratingPinId: string | null;
  ratingValue: number | null;
  ratingComment: string | null;
  ratingCreatedAt: number | null;
  ratingMessageSent: boolean | null;
  ratingMessagePinId: string | null;
  ratingMessageError: string | null;
  tStageCompleted: boolean;
  ratingSyncState: null;
  ratingSyncError: null;
  inspector: {
    session: Record<string, unknown>;
    sessions: Array<Record<string, unknown>>;
    taskRuns: [];
    transcriptItems: UnifiedA2ATraceTranscriptItem[];
    publicStatusSnapshots: Array<Record<string, unknown>>;
    transcriptMarkdown: null;
    traceMarkdown: null;
    conversationFilePath: string;
  };
  localMetabotName: string;
  localMetabotGlobalMetaId: string;
  localMetabotAvatar: string | null;
  peerGlobalMetaId: string;
  peerName: string | null;
  peerAvatar: string | null;
}

interface ReadConversationRecord {
  conversation: A2AConversationState;
  filePath: string;
}

const CHAT_FILE_RE = /^chat-[a-z0-9]{8}-[a-z0-9]{8}\.json$/i;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimestamp(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  if (normalized >= 1_000_000_000 && normalized < 1_000_000_000_000) {
    return normalized * 1000;
  }
  return normalized;
}

function normalizeActorRecord(value: unknown): {
  globalMetaId: string;
  name: string | null;
  avatar: string | null;
  chatPublicKey: string | null;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const globalMetaId = normalizeText(record.globalMetaId);
  if (!globalMetaId) {
    return null;
  }
  return {
    globalMetaId,
    name: normalizeText(record.name) || null,
    avatar: normalizeText(record.avatar) || null,
    chatPublicKey: normalizeText(record.chatPublicKey) || null,
  };
}

function normalizeConversationState(value: unknown): A2AConversationState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Partial<A2AConversationState>;
  const local = normalizeActorRecord(record.local);
  const peer = normalizeActorRecord(record.peer);
  if (!local || !peer) {
    return null;
  }
  const messages = Array.isArray(record.messages)
    ? record.messages.filter((message): message is A2AConversationMessage => (
        Boolean(normalizeText((message as A2AConversationMessage)?.messageId))
      ))
    : [];
  const sessions = Array.isArray(record.sessions)
    ? record.sessions.filter((session): session is A2AConversationSession => (
        Boolean(normalizeText((session as A2AConversationSession)?.sessionId))
      ))
    : [];

  return {
    version: 1,
    local,
    peer,
    messages,
    sessions,
    indexes: record.indexes ?? {
      messageIds: messages.map((message) => message.messageId),
      orderTxidToSessionId: {},
      paymentTxidToSessionId: {},
    },
    updatedAt: normalizeTimestamp(record.updatedAt, 0),
  };
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function listConversationFiles(homeDir: string): Promise<string[]> {
  const paths = resolveMetabotPaths(homeDir);
  try {
    const entries = await fs.readdir(paths.a2aRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && CHAT_FILE_RE.test(entry.name))
      .map((entry) => path.join(paths.a2aRoot, entry.name))
      .sort();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function readUnifiedConversations(profile: A2ATraceProjectionProfile): Promise<ReadConversationRecord[]> {
  const homeDir = normalizeText(profile.homeDir);
  if (!homeDir) {
    return [];
  }
  const files = await listConversationFiles(homeDir);
  const records = await Promise.all(files.map(async (filePath) => {
    const conversation = normalizeConversationState(await readJsonFile(filePath));
    return conversation ? { conversation, filePath } : null;
  }));
  return records.filter((record): record is ReadConversationRecord => record !== null);
}

function normalizeRole(value: unknown): 'caller' | 'provider' {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'provider' || normalized === 'seller' ? 'provider' : 'caller';
}

function resolveLocalProfileName(
  profile: A2ATraceProjectionProfile,
  conversation: A2AConversationState,
): string {
  return normalizeText(profile.name)
    || normalizeText(conversation.local.name)
    || normalizeText(profile.slug)
    || path.basename(profile.homeDir);
}

function resolveLocalGlobalMetaId(
  profile: A2ATraceProjectionProfile,
  conversation: A2AConversationState,
): string {
  return normalizeText(profile.globalMetaId) || normalizeText(conversation.local.globalMetaId);
}

function resolveCallerProvider(input: {
  role: 'caller' | 'provider';
  localGlobalMetaId: string;
  peerGlobalMetaId: string;
}): { callerGlobalMetaId: string; providerGlobalMetaId: string } {
  if (input.role === 'provider') {
    return {
      callerGlobalMetaId: input.peerGlobalMetaId,
      providerGlobalMetaId: input.localGlobalMetaId,
    };
  }
  return {
    callerGlobalMetaId: input.localGlobalMetaId,
    providerGlobalMetaId: input.peerGlobalMetaId,
  };
}

function isCallerVisibleSession(session: A2AConversationSession): boolean {
  return session.type === 'peer' || normalizeRole(session.role) === 'caller';
}

function isCallerServiceOrderSession(session: A2AConversationSession): session is A2AOrderConversationSession {
  return session.type === 'service_order' && normalizeRole(session.role) === 'caller';
}

function findPeerSession(conversation: A2AConversationState): A2AConversationSession | null {
  return conversation.sessions.find((session) => session.type === 'peer') ?? null;
}

function findLatestCallerOrderSession(conversation: A2AConversationState): A2AOrderConversationSession | null {
  return conversation.sessions
    .filter(isCallerServiceOrderSession)
    .sort((left, right) => normalizeTimestamp(left.updatedAt) - normalizeTimestamp(right.updatedAt))
    .at(-1)
    ?? null;
}

function messageBelongsToServiceOrder(
  message: A2AConversationMessage,
  session: A2AOrderConversationSession,
): boolean {
  const sessionId = normalizeText(session.sessionId);
  const orderTxid = normalizeText(session.orderTxid);
  const paymentTxid = normalizeText(session.paymentTxid);
  return Boolean(normalizeText(message.orderSessionId) === sessionId
    || (orderTxid && normalizeText(message.orderTxid) === orderTxid)
    || (paymentTxid && normalizeText(message.paymentTxid) === paymentTxid));
}

function protocolTagEquals(message: A2AConversationMessage, expected: string): boolean {
  return normalizeText(message.protocolTag).toUpperCase() === expected.toUpperCase();
}

function isFailureEndReason(reason: unknown): boolean {
  const normalized = normalizeText(reason).toLowerCase();
  return Boolean(normalized.match(/\b(fail|failed|failure|error|declined|cancelled|canceled|timeout|expired)\b/u));
}

function mapStoredOrderState(value: unknown): string {
  const state = normalizeText(value);
  if (!state) {
    return 'requesting_remote';
  }
  if (state === 'awaiting_delivery') {
    return 'remote_executing';
  }
  return state;
}

function deriveProjectedSessionState(input: {
  conversation: A2AConversationState;
  session: A2AConversationSession;
}): string {
  const { conversation, session } = input;
  if (session.type !== 'service_order') {
    return normalizeText(session.state) || 'active';
  }

  const scopedMessages = conversation.messages
    .filter((message) => messageBelongsToServiceOrder(message, session))
    .sort((left, right) => normalizeTimestamp(left.timestamp) - normalizeTimestamp(right.timestamp));

  for (let index = scopedMessages.length - 1; index >= 0; index -= 1) {
    const message = scopedMessages[index];
    if (protocolTagEquals(message, 'ORDER_END')) {
      const parsed = parseOrderEndMessage(String(message.content ?? ''));
      return isFailureEndReason(parsed?.reason) ? 'remote_failed' : 'completed';
    }
    if (protocolTagEquals(message, 'DELIVERY') || protocolTagEquals(message, 'NeedsRating')) {
      return 'completed';
    }
    if (message.direction === 'incoming' && protocolTagEquals(message, 'ORDER_STATUS')) {
      return 'remote_executing';
    }
  }

  return mapStoredOrderState(session.state);
}

function buildLocalUiUrl(
  daemon: A2ATraceProjectionDaemon | null | undefined,
  traceId: string,
  sessionId: string,
): string | undefined {
  const baseUrl = normalizeText(daemon?.baseUrl);
  if (!baseUrl) {
    return undefined;
  }
  const url = new URL('/ui/trace', baseUrl);
  url.searchParams.set('traceId', traceId);
  url.searchParams.set('sessionId', sessionId);
  return url.toString();
}

function projectListSession(input: {
  profile: A2ATraceProjectionProfile;
  daemon?: A2ATraceProjectionDaemon | null;
  conversation: A2AConversationState;
  session: A2AConversationSession;
}): UnifiedA2ATraceSessionListItem {
  const { profile, daemon, conversation, session } = input;
  const role = session.type === 'service_order' ? normalizeRole(session.role) : 'caller';
  const localMetabotName = resolveLocalProfileName(profile, conversation);
  const localMetabotGlobalMetaId = resolveLocalGlobalMetaId(profile, conversation);
  const peerGlobalMetaId = normalizeText(conversation.peer.globalMetaId);
  const callerProvider = resolveCallerProvider({
    role,
    localGlobalMetaId: localMetabotGlobalMetaId,
    peerGlobalMetaId,
  });
  const sessionId = normalizeText(session.sessionId);
  const traceId = sessionId;

  return {
    source: 'unified_a2a',
    sessionKind: session.type,
    sessionId,
    traceId,
    role,
    state: deriveProjectedSessionState({ conversation, session }),
    createdAt: normalizeTimestamp(session.createdAt, conversation.updatedAt),
    updatedAt: normalizeTimestamp(session.updatedAt, conversation.updatedAt),
    localMetabotName,
    localMetabotGlobalMetaId,
    localMetabotAvatar: normalizeText(conversation.local.avatar) || null,
    peerGlobalMetaId,
    peerName: normalizeText(conversation.peer.name) || null,
    peerAvatar: normalizeText(conversation.peer.avatar) || null,
    ...callerProvider,
    servicePinId: session.type === 'service_order' ? normalizeText(session.servicePinId) : '',
    serviceName: session.type === 'service_order' ? normalizeText(session.serviceName) || null : null,
    outputType: session.type === 'service_order' ? normalizeText(session.outputType) || null : null,
    orderTxid: session.type === 'service_order' ? normalizeText(session.orderTxid) || null : null,
    paymentTxid: session.type === 'service_order' ? normalizeText(session.paymentTxid) || null : null,
    localUiUrl: buildLocalUiUrl(daemon, traceId, sessionId),
  };
}

function messageBelongsToSession(
  message: A2AConversationMessage,
  session: A2AConversationSession,
): boolean {
  if (session.type === 'peer') {
    return true;
  }
  return messageBelongsToServiceOrder(message, session);
}

function stripOrderProtocolFallback(content: string): string {
  return content.replace(/^\[[A-Za-z_]+(?::[0-9a-fA-F]{64})?(?:\s+[A-Za-z0-9_-]+)?\]\s*/u, '').trim();
}

function projectProtocolMessage(input: {
  message: A2AConversationMessage;
  session: A2AConversationSession;
}): { type: string; content: string; metadata: Record<string, unknown> } {
  const { message, session } = input;
  const protocolTag = normalizeText(message.protocolTag);
  const rawContent = String(message.content ?? '');
  const metadata: Record<string, unknown> = {
    source: 'unified_a2a',
    messageId: normalizeText(message.messageId),
    direction: message.direction,
    kind: message.kind,
    protocolTag: protocolTag || null,
    orderTxid: normalizeText(message.orderTxid) || null,
    paymentTxid: normalizeText(message.paymentTxid) || null,
    pinId: normalizeText(message.pinId) || null,
    txid: normalizeText(message.txid) || null,
    txids: Array.isArray(message.txids) ? message.txids : [],
    replyPinId: normalizeText(message.replyPinId) || null,
    chain: normalizeText(message.chain) || null,
    contentType: normalizeText(message.contentType) || null,
    rawContent,
  };

  if (!protocolTag) {
    return {
      type: 'message',
      content: rawContent,
      metadata,
    };
  }

  if (protocolTag.toUpperCase() === 'ORDER') {
    return {
      type: 'order',
      content: stripOrderProtocolFallback(rawContent) || rawContent,
      metadata,
    };
  }

  if (protocolTag.toUpperCase() === 'ORDER_STATUS') {
    const parsed = parseOrderStatusMessage(rawContent);
    return {
      type: 'order_status',
      content: normalizeText(parsed?.content) || stripOrderProtocolFallback(rawContent) || rawContent,
      metadata,
    };
  }

  if (protocolTag.toUpperCase() === 'DELIVERY') {
    const parsed = parseDeliveryMessage(rawContent);
    const content = normalizeText(parsed?.result) || stripOrderProtocolFallback(rawContent) || rawContent;
    return {
      type: 'delivery',
      content,
      metadata: {
        ...metadata,
        deliveryPinId: normalizeText(message.pinId) || null,
        deliveryPayload: parsed ?? null,
        publicStatus: 'completed',
        event: 'provider_completed',
        servicePinId: normalizeText(parsed?.servicePinId)
          || (session.type === 'service_order' ? normalizeText(session.servicePinId) : null)
          || null,
        deliveredAt: normalizeTimestamp(parsed?.deliveredAt, normalizeTimestamp(message.timestamp)),
      },
    };
  }

  if (protocolTag.toUpperCase() === 'NEEDSRATING') {
    const parsed = parseNeedsRatingMessage(rawContent);
    return {
      type: 'needs_rating',
      content: normalizeText(parsed?.content) || stripOrderProtocolFallback(rawContent) || rawContent,
      metadata: {
        ...metadata,
        needsRating: true,
      },
    };
  }

  if (protocolTag.toUpperCase() === 'ORDER_END') {
    const parsed = parseOrderEndMessage(rawContent);
    return {
      type: 'order_end',
      content: normalizeText(parsed?.content) || stripOrderProtocolFallback(rawContent) || rawContent,
      metadata: {
        ...metadata,
        endReason: normalizeText(parsed?.reason) || null,
        publicStatus: normalizeText(parsed?.reason).toLowerCase() === 'failed' ? 'remote_failed' : 'completed',
      },
    };
  }

  return {
    type: protocolTag.toLowerCase(),
    content: stripOrderProtocolFallback(rawContent) || rawContent,
    metadata,
  };
}

function projectTranscriptItems(input: {
  conversation: A2AConversationState;
  session: A2AConversationSession;
  role: 'caller' | 'provider';
}): UnifiedA2ATraceTranscriptItem[] {
  const localSender = input.role;
  const peerSender = input.role === 'caller' ? 'provider' : 'caller';

  return input.conversation.messages
    .filter((message) => messageBelongsToSession(message, input.session))
    .map((message) => {
      const projected = projectProtocolMessage({ message, session: input.session });
      return {
        id: normalizeText(message.messageId),
        sessionId: normalizeText(input.session.sessionId),
        taskRunId: null,
        timestamp: normalizeTimestamp(message.timestamp),
        type: projected.type,
        sender: message.direction === 'outgoing' ? localSender : peerSender,
        content: projected.content,
        metadata: projected.metadata,
      };
    })
    .filter((item) => item.id)
    .sort((left, right) => left.timestamp - right.timestamp);
}

function extractProjectedResult(items: UnifiedA2ATraceTranscriptItem[]): {
  resultText: string | null;
  resultObservedAt: number | null;
  resultDeliveryPinId: string | null;
} {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.sender !== 'provider' || item.type !== 'delivery') {
      continue;
    }
    const content = normalizeText(item.content);
    if (!content) {
      continue;
    }
    return {
      resultText: content,
      resultObservedAt: normalizeTimestamp(item.timestamp),
      resultDeliveryPinId: normalizeText(item.metadata.deliveryPinId) || null,
    };
  }
  return {
    resultText: null,
    resultObservedAt: null,
    resultDeliveryPinId: null,
  };
}

function extractProjectedRatingRequest(items: UnifiedA2ATraceTranscriptItem[]): {
  ratingRequestText: string | null;
  ratingRequestedAt: number | null;
} {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.sender !== 'provider' || item.metadata.needsRating !== true) {
      continue;
    }
    const content = normalizeText(item.content);
    if (!content) {
      continue;
    }
    return {
      ratingRequestText: content,
      ratingRequestedAt: normalizeTimestamp(item.timestamp),
    };
  }
  return {
    ratingRequestText: null,
    ratingRequestedAt: null,
  };
}

function findOrderPinId(
  messages: A2AConversationMessage[],
  session: A2AConversationSession,
): string | null {
  if (session.type !== 'service_order') {
    return null;
  }
  const orderMessage = messages.find((message) => (
    messageBelongsToSession(message, session)
    && normalizeText(message.protocolTag).toUpperCase() === 'ORDER'
  ));
  return normalizeText(orderMessage?.pinId) || null;
}

function buildProjectedOrder(input: {
  conversation: A2AConversationState;
  session: A2AConversationSession;
  orderSession?: A2AOrderConversationSession | null;
  callerGlobalMetaId: string;
  providerGlobalMetaId: string;
}): Record<string, unknown> | null {
  const { conversation, session, orderSession, callerGlobalMetaId, providerGlobalMetaId } = input;
  const selectedOrderSession = orderSession ?? (session.type === 'service_order' ? session : null);
  if (!selectedOrderSession) {
    return null;
  }
  return {
    orderPinId: findOrderPinId(conversation.messages, selectedOrderSession),
    orderTxid: normalizeText(selectedOrderSession.orderTxid) || null,
    paymentTxid: normalizeText(selectedOrderSession.paymentTxid) || null,
    serviceId: normalizeText(selectedOrderSession.servicePinId) || null,
    servicePinId: normalizeText(selectedOrderSession.servicePinId) || null,
    serviceName: normalizeText(selectedOrderSession.serviceName) || null,
    outputType: normalizeText(selectedOrderSession.outputType) || null,
    callerGlobalMetaId,
    providerGlobalMetaId,
  };
}

function projectDetailSession(input: {
  profile: A2ATraceProjectionProfile;
  daemon?: A2ATraceProjectionDaemon | null;
  conversation: A2AConversationState;
  filePath: string;
  session: A2AConversationSession;
  orderSession?: A2AOrderConversationSession | null;
}): UnifiedA2ATraceSessionDetail {
  const listItem = projectListSession(input);
  const statusSession = input.orderSession ?? input.session;
  const projectedState = deriveProjectedSessionState({
    conversation: input.conversation,
    session: statusSession,
  });
  const transcriptItems = projectTranscriptItems({
    conversation: input.conversation,
    session: input.session,
    role: listItem.role,
  });
  const latestStatusSnapshot = {
    sessionId: listItem.sessionId,
    taskRunId: null,
    status: projectedState,
    mapped: true,
    rawEvent: 'unified_a2a_session_state',
    resolvedAt: listItem.updatedAt,
  };
  const result = extractProjectedResult(transcriptItems);
  const ratingRequest = extractProjectedRatingRequest(transcriptItems);
  const order = buildProjectedOrder({
    conversation: input.conversation,
    session: input.session,
    orderSession: input.orderSession ?? null,
    callerGlobalMetaId: listItem.callerGlobalMetaId,
    providerGlobalMetaId: listItem.providerGlobalMetaId,
  });
  const orderPinId = normalizeText(order?.orderPinId) || null;
  const orderTxid = normalizeText(order?.orderTxid) || null;
  const paymentTxid = normalizeText(order?.paymentTxid) || null;
  const servicePinId = normalizeText(order?.servicePinId) || normalizeText(listItem.servicePinId);
  const sessionRecord: Record<string, unknown> = {
    ...input.session,
    id: listItem.sessionId,
    sessionId: listItem.sessionId,
    traceId: listItem.traceId,
    role: listItem.role,
    state: listItem.state,
    title: normalizeText(order?.serviceName) || listItem.serviceName || listItem.peerName || null,
    type: 'a2a',
    source: 'unified_a2a',
    sessionKind: listItem.sessionKind,
    metabotId: null,
    callerGlobalMetaId: listItem.callerGlobalMetaId,
    providerGlobalMetaId: listItem.providerGlobalMetaId,
    servicePinId,
    serviceName: normalizeText(order?.serviceName) || listItem.serviceName,
    outputType: normalizeText(order?.outputType) || listItem.outputType,
    peerGlobalMetaId: listItem.peerGlobalMetaId,
    peerName: listItem.peerName,
    peerAvatar: listItem.peerAvatar,
    externalConversationId: null,
  };

  return {
    source: 'unified_a2a',
    traceId: listItem.traceId,
    sessionId: listItem.sessionId,
    session: sessionRecord,
    transcriptItems,
    taskRuns: [],
    publicStatusSnapshots: [latestStatusSnapshot],
    order,
    orderPinId,
    orderTxid,
    orderTxids: orderTxid ? [orderTxid] : [],
    paymentTxid,
    localUiUrl: buildLocalUiUrl(input.daemon, listItem.traceId, listItem.sessionId),
    a2a: {
      sessionId: listItem.sessionId,
      taskRunId: null,
      role: listItem.role,
      publicStatus: latestStatusSnapshot.status,
      latestEvent: latestStatusSnapshot.rawEvent,
      taskRunState: null,
      callerGlobalMetaId: listItem.callerGlobalMetaId,
      callerName: listItem.role === 'caller' ? listItem.localMetabotName : listItem.peerName,
      providerGlobalMetaId: listItem.providerGlobalMetaId,
      providerName: listItem.role === 'caller' ? listItem.peerName : listItem.localMetabotName,
      servicePinId,
    },
    artifacts: {
      transcriptMarkdownPath: null,
      traceMarkdownPath: null,
      traceJsonPath: null,
    },
    resultText: result.resultText,
    responseText: result.resultText,
    resultObservedAt: result.resultObservedAt,
    resultDeliveryPinId: result.resultDeliveryPinId,
    ratingRequestText: ratingRequest.ratingRequestText,
    ratingRequestedAt: ratingRequest.ratingRequestedAt,
    ratingRequested: Boolean(ratingRequest.ratingRequestText),
    ratingPublished: false,
    ratingPinId: null,
    ratingValue: null,
    ratingComment: null,
    ratingCreatedAt: null,
    ratingMessageSent: null,
    ratingMessagePinId: null,
    ratingMessageError: null,
    tStageCompleted: false,
    ratingSyncState: null,
    ratingSyncError: null,
    inspector: {
      session: sessionRecord,
      sessions: [sessionRecord],
      taskRuns: [],
      transcriptItems,
      publicStatusSnapshots: [latestStatusSnapshot],
      transcriptMarkdown: null,
      traceMarkdown: null,
      conversationFilePath: input.filePath,
    },
    localMetabotName: listItem.localMetabotName,
    localMetabotGlobalMetaId: listItem.localMetabotGlobalMetaId,
    localMetabotAvatar: listItem.localMetabotAvatar,
    peerGlobalMetaId: listItem.peerGlobalMetaId,
    peerName: listItem.peerName,
    peerAvatar: listItem.peerAvatar,
  };
}

export async function listUnifiedA2ATraceSessionsForProfile(input: {
  profile: A2ATraceProjectionProfile;
  daemon?: A2ATraceProjectionDaemon | null;
}): Promise<UnifiedA2ATraceSessionListItem[]> {
  const conversations = await readUnifiedConversations(input.profile);
  const sessions = conversations.flatMap((record) => (
    record.conversation.sessions
      .filter((session) => session.type === 'peer')
      .map((session) => projectListSession({
        profile: input.profile,
        daemon: input.daemon,
        conversation: record.conversation,
        session,
      }))
  ));

  return sessions.sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getUnifiedA2ATraceSessionForProfile(input: {
  profile: A2ATraceProjectionProfile;
  sessionId: string;
  daemon?: A2ATraceProjectionDaemon | null;
}): Promise<UnifiedA2ATraceSessionDetail | null> {
  const sessionId = normalizeText(input.sessionId);
  if (!sessionId) {
    return null;
  }

  const conversations = await readUnifiedConversations(input.profile);
  for (const record of conversations) {
    const requestedSession = record.conversation.sessions.find((entry) => (
      normalizeText(entry.sessionId) === sessionId && isCallerVisibleSession(entry)
    ));
    if (!requestedSession) {
      continue;
    }
    if (requestedSession.type === 'service_order' && !isCallerServiceOrderSession(requestedSession)) {
      continue;
    }
    const peerSession = requestedSession.type === 'peer'
      ? requestedSession
      : findPeerSession(record.conversation);
    if (!peerSession) {
      continue;
    }
    const orderSession = requestedSession.type === 'service_order'
      ? requestedSession
      : findLatestCallerOrderSession(record.conversation);
    return projectDetailSession({
      profile: input.profile,
      daemon: input.daemon,
      conversation: record.conversation,
      filePath: record.filePath,
      session: peerSession,
      orderSession,
    });
  }
  return null;
}

export async function findUnifiedA2ATraceSessionForProfileByOrder(input: {
  profile: A2ATraceProjectionProfile;
  orderTxid?: string | null;
  paymentTxid?: string | null;
  daemon?: A2ATraceProjectionDaemon | null;
}): Promise<UnifiedA2ATraceSessionDetail | null> {
  const orderTxid = normalizeText(input.orderTxid);
  const paymentTxid = normalizeText(input.paymentTxid);
  if (!orderTxid && !paymentTxid) {
    return null;
  }

  const conversations = await readUnifiedConversations(input.profile);
  for (const record of conversations) {
    const orderSession = record.conversation.sessions.find((entry): entry is A2AOrderConversationSession => {
      if (!isCallerServiceOrderSession(entry)) {
        return false;
      }
      return Boolean(
        (orderTxid && normalizeText(entry.orderTxid) === orderTxid)
        || (paymentTxid && normalizeText(entry.paymentTxid) === paymentTxid)
      );
    });
    if (!orderSession) {
      continue;
    }
    const peerSession = findPeerSession(record.conversation);
    if (!peerSession) {
      continue;
    }
    return projectDetailSession({
      profile: input.profile,
      daemon: input.daemon,
      conversation: record.conversation,
      filePath: record.filePath,
      session: peerSession,
      orderSession,
    });
  }
  return null;
}
