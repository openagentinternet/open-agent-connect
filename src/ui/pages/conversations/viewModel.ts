export type ConversationSource = 'private_chat' | 'service_trace';

export interface ConversationActionViewModel {
  label: string;
  href: string;
}

export interface ConversationSummaryViewModel {
  conversationId: string;
  peerLabel: string;
  peerGlobalMetaId: string;
  source: ConversationSource;
  latestText: string;
  latestAt: number;
  latestAtLabel: string;
  kinds: string[];
  stateLabel: string;
  turnCountLabel: string;
  localBotLabel: string;
  serviceName: string;
  traceHref: string;
  sessionHref: string;
  refundHref: string;
  advancedActions: ConversationActionViewModel[];
  isSelected: boolean;
}

export interface ConversationMessageViewModel {
  messageId: string;
  directionLabel: string;
  content: string;
  timestampLabel: string;
}

export interface ConversationsEmptyStateViewModel {
  title: string;
  message: string;
}

export interface ConversationsPageViewModel {
  conversations: ConversationSummaryViewModel[];
  selectedConversation: ConversationSummaryViewModel | null;
  messages: ConversationMessageViewModel[];
  emptyState: ConversationsEmptyStateViewModel;
  detailEmptyState: ConversationsEmptyStateViewModel;
}

export interface ConversationsPageViewModelInput {
  conversations?: unknown[];
  conversationsResponse?: unknown;
  traceSessions?: unknown[];
  traceSessionsResponse?: unknown;
  messages?: unknown[];
  messagesResponse?: unknown;
  selectedConversationId?: string;
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeTimestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
    }
    const dateMs = new Date(value).getTime();
    return Number.isFinite(dateMs) ? dateMs : 0;
  }
  return 0;
}

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (part: number) => String(part).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join('-') + ' ' + [pad(date.getUTCHours()), pad(date.getUTCMinutes())].join(':');
}

function titleCase(value: string): string {
  if (!value) return 'Unknown';
  return value
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'Unknown';
}

function extractConversations(input: ConversationsPageViewModelInput): unknown[] {
  if (Array.isArray(input.conversations)) return input.conversations;
  const response = readObject(input.conversationsResponse);
  const data = readObject(response.data);
  return readArray(data.conversations).length > 0
    ? readArray(data.conversations)
    : readArray(response.conversations);
}

function extractMessages(input: ConversationsPageViewModelInput): unknown[] {
  if (Array.isArray(input.messages)) return input.messages;
  const response = readObject(input.messagesResponse);
  const data = readObject(response.data);
  return readArray(data.messages).length > 0
    ? readArray(data.messages)
    : readArray(response.messages);
}

function extractTraceSessions(input: ConversationsPageViewModelInput): unknown[] {
  if (Array.isArray(input.traceSessions)) return input.traceSessions;
  const response = readObject(input.traceSessionsResponse);
  const data = readObject(response.data);
  return readArray(data.sessions).length > 0
    ? readArray(data.sessions)
    : readArray(response.sessions);
}

function serviceConversationId(sessionId: string): string {
  return `service-${sessionId}`;
}

function buildTraceHref(traceId: string): string {
  return traceId ? `/ui/trace?traceId=${encodeURIComponent(traceId)}` : '';
}

function buildSessionHref(sessionId: string): string {
  return sessionId ? `/ui/trace?sessionId=${encodeURIComponent(sessionId)}` : '';
}

function buildRefundHref(record: Record<string, unknown>): string {
  const order = readObject(record.order);
  const source = Object.keys(order).length > 0 ? order : record;
  const orderId = normalizeText(source.id)
    || normalizeText(source.serviceOrderPinId)
    || normalizeText(source.orderReference)
    || normalizeText(record.refundOrderId)
    || normalizeText(record.orderId)
    || normalizeText(record.serviceOrderPinId);
  if (!orderId) return '';
  const status = normalizeText(source.status) || normalizeText(record.refundStatus) || normalizeText(record.status);
  const refundRequestPinId = normalizeText(source.refundRequestPinId) || normalizeText(record.refundRequestPinId);
  const requiresRefundAction = status === 'refund_pending'
    || Boolean(refundRequestPinId)
    || record.refundActionRequired === true
    || record.manualActionRequired === true;
  return requiresRefundAction ? `/ui/refund?orderId=${encodeURIComponent(orderId)}` : '';
}

function hasServiceConversationContext(record: Record<string, unknown>, order: Record<string, unknown>): boolean {
  return Boolean(
    normalizeText(record.servicePinId)
    || normalizeText(record.serviceName)
    || normalizeText(record.displayName)
    || normalizeText(record.orderId)
    || normalizeText(record.serviceOrderPinId)
    || normalizeText(order.id)
    || normalizeText(order.servicePinId)
    || normalizeText(order.serviceName)
    || normalizeText(order.serviceOrderPinId)
    || normalizeText(order.orderReference),
  );
}

function buildConversationSummary(row: unknown, selectedConversationId: string): ConversationSummaryViewModel {
  const record = readObject(row);
  const conversationId = normalizeText(record.conversationId) || normalizeText(record.id);
  const peerGlobalMetaId = normalizeText(record.peerGlobalMetaId) || normalizeText(record.peer);
  const peerLabel = normalizeText(record.peerName) || normalizeText(record.peerDisplayName) || peerGlobalMetaId || 'Unknown peer';
  const direction = normalizeText(record.lastDirection);
  const latestAt = normalizeTimestampMs(record.updatedAt || record.lastMessageAt || record.createdAt);
  const stateLabel = titleCase(normalizeText(record.state) || 'active');
  const turnCount = typeof record.turnCount === 'number' && Number.isFinite(record.turnCount)
    ? record.turnCount
    : Number(record.turnCount || 0);
  const normalizedTurnCount = Number.isFinite(turnCount) && turnCount >= 0 ? turnCount : 0;
  return {
    conversationId,
    peerLabel,
    peerGlobalMetaId,
    source: 'private_chat',
    latestText: `${titleCase(direction || 'private')} private chat with ${peerLabel}`,
    latestAt,
    latestAtLabel: formatTimestamp(latestAt),
    kinds: ['Chat'],
    stateLabel,
    turnCountLabel: `${normalizedTurnCount} ${normalizedTurnCount === 1 ? 'turn' : 'turns'}`,
    localBotLabel: normalizeText(record.localMetabotName) || normalizeText(record.localBotName),
    serviceName: '',
    traceHref: '',
    sessionHref: '',
    refundHref: '',
    advancedActions: [],
    isSelected: Boolean(selectedConversationId && conversationId === selectedConversationId),
  };
}

function buildServiceSummary(row: unknown, selectedConversationId: string): ConversationSummaryViewModel | null {
  const record = readObject(row);
  const sessionId = normalizeText(record.sessionId) || normalizeText(record.id);
  const conversationId = serviceConversationId(sessionId);
  const traceId = normalizeText(record.traceId);
  const peerGlobalMetaId = normalizeText(record.peerGlobalMetaId)
    || normalizeText(record.providerGlobalMetaId)
    || normalizeText(record.callerGlobalMetaId);
  const peerLabel = normalizeText(record.peerName)
    || normalizeText(record.providerName)
    || normalizeText(record.callerName)
    || peerGlobalMetaId
    || 'Remote Bot';
  const order = readObject(record.order);
  if (!sessionId || !hasServiceConversationContext(record, order)) {
    return null;
  }
  const serviceName = normalizeText(record.serviceName)
    || normalizeText(order.serviceName)
    || normalizeText(record.displayName)
    || normalizeText(record.servicePinId)
    || 'Service';
  const serviceText = serviceName === 'Service' ? 'Service session' : `${serviceName} service session`;
  const latestAt = normalizeTimestampMs(record.updatedAt || record.completedAt || record.createdAt);
  const traceHref = buildTraceHref(traceId);
  const sessionHref = buildSessionHref(sessionId);
  const refundHref = buildRefundHref(record);
  const advancedActions: ConversationActionViewModel[] = [
    ...(traceHref ? [{ label: 'Trace', href: traceHref }] : []),
    ...(sessionHref ? [{ label: 'Session', href: sessionHref }] : []),
    ...(refundHref ? [{ label: 'Refund', href: refundHref }] : []),
  ];
  return {
    conversationId,
    peerLabel,
    peerGlobalMetaId,
    source: 'service_trace',
    latestText: `${serviceText} with ${peerLabel}`,
    latestAt,
    latestAtLabel: formatTimestamp(latestAt),
    kinds: ['Service'],
    stateLabel: titleCase(normalizeText(record.state) || 'service'),
    turnCountLabel: sessionId,
    localBotLabel: normalizeText(record.localMetabotName) || normalizeText(record.localBotName),
    serviceName,
    traceHref,
    sessionHref,
    refundHref,
    advancedActions,
    isSelected: Boolean(selectedConversationId && conversationId === selectedConversationId),
  };
}

function buildMessage(row: unknown): ConversationMessageViewModel {
  const record = readObject(row);
  const direction = normalizeText(record.direction).toLowerCase();
  const timestamp = normalizeTimestampMs(record.timestamp || record.createdAt);
  return {
    messageId: normalizeText(record.messageId) || normalizeText(record.id) || normalizeText(record.messagePinId),
    directionLabel: direction === 'outbound' ? 'Bot' : 'Peer',
    content: normalizeText(record.content) || normalizeText(record.text) || normalizeText(record.body),
    timestampLabel: formatTimestamp(timestamp),
  };
}

export function buildConversationsPageViewModel(input: ConversationsPageViewModelInput = {}): ConversationsPageViewModel {
  const selectedInput = normalizeText(input.selectedConversationId);
  const privateSummaries = extractConversations(input)
    .map((row) => buildConversationSummary(row, normalizeText(input.selectedConversationId)))
    .filter((summary) => summary.conversationId);
  const serviceSummaries = extractTraceSessions(input)
    .map((row) => buildServiceSummary(row, selectedInput))
    .filter((summary): summary is ConversationSummaryViewModel => Boolean(summary));
  const summaries = [...privateSummaries, ...serviceSummaries]
    .sort((left, right) => right.latestAt - left.latestAt);
  const selectedConversationId = selectedInput || (summaries[0] ? summaries[0].conversationId : '');
  const conversations = summaries.map((summary) => ({
    ...summary,
    isSelected: summary.conversationId === selectedConversationId,
  }));
  const selectedConversation = conversations.find((summary) => summary.isSelected) || null;
  const messages = selectedConversation?.source === 'private_chat'
    ? extractMessages(input)
      .filter((row) => {
        if (!selectedConversationId) return true;
        const record = readObject(row);
        const conversationId = normalizeText(record.conversationId);
        return !conversationId || conversationId === selectedConversationId;
      })
      .sort((left, right) => {
        const leftRecord = readObject(left);
        const rightRecord = readObject(right);
        return normalizeTimestampMs(leftRecord.timestamp || leftRecord.createdAt)
          - normalizeTimestampMs(rightRecord.timestamp || rightRecord.createdAt);
      })
      .map(buildMessage)
    : [];

  return {
    conversations,
    selectedConversation,
    messages,
    emptyState: {
      title: 'No conversations yet',
      message: 'Private chat conversations will appear here after your Bot receives or sends messages.',
    },
    detailEmptyState: {
      title: selectedConversation?.source === 'service_trace'
        ? 'Service conversation'
        : selectedConversation ? 'No messages yet' : 'Select a conversation',
      message: selectedConversation
        ? selectedConversation.source === 'service_trace'
          ? 'Open Trace, Session, or Refund for the full service context.'
          : 'Messages for this conversation will appear here.'
        : 'Choose a private chat thread from the conversation list.',
    },
  };
}

export function buildConversationsPageViewModelRuntimeSource(): string {
  return [
    normalizeText,
    readObject,
    readArray,
    normalizeTimestampMs,
    formatTimestamp,
    titleCase,
    extractConversations,
    extractMessages,
    extractTraceSessions,
    serviceConversationId,
    buildTraceHref,
    buildSessionHref,
    buildRefundHref,
    hasServiceConversationContext,
    buildConversationSummary,
    buildServiceSummary,
    buildMessage,
    buildConversationsPageViewModel,
  ].map((fn) => fn.toString()).join('\n');
}
