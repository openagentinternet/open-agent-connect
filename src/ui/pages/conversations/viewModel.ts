export interface ConversationSummaryViewModel {
  conversationId: string;
  peerLabel: string;
  peerGlobalMetaId: string;
  latestText: string;
  latestAt: number;
  latestAtLabel: string;
  kinds: string[];
  stateLabel: string;
  turnCountLabel: string;
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
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
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
    latestText: `${titleCase(direction || 'private')} private chat with ${peerLabel}`,
    latestAt,
    latestAtLabel: formatTimestamp(latestAt),
    kinds: ['Chat'],
    stateLabel,
    turnCountLabel: `${normalizedTurnCount} ${normalizedTurnCount === 1 ? 'turn' : 'turns'}`,
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
  const summaries = extractConversations(input)
    .map((row) => buildConversationSummary(row, normalizeText(input.selectedConversationId)))
    .filter((summary) => summary.conversationId)
    .sort((left, right) => right.latestAt - left.latestAt);
  const selectedConversationId = normalizeText(input.selectedConversationId)
    || (summaries[0] ? summaries[0].conversationId : '');
  const conversations = summaries.map((summary) => ({
    ...summary,
    isSelected: summary.conversationId === selectedConversationId,
  }));
  const selectedConversation = conversations.find((summary) => summary.isSelected) || null;
  const messages = extractMessages(input)
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
    .map(buildMessage);

  return {
    conversations,
    selectedConversation,
    messages,
    emptyState: {
      title: 'No conversations yet',
      message: 'Private chat conversations will appear here after your Bot receives or sends messages.',
    },
    detailEmptyState: {
      title: selectedConversation ? 'No messages yet' : 'Select a conversation',
      message: selectedConversation
        ? 'Messages for this conversation will appear here.'
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
    buildConversationSummary,
    buildMessage,
    buildConversationsPageViewModel,
  ].map((fn) => fn.toString()).join('\n');
}
