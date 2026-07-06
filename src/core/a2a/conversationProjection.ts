import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths } from '../state/paths';
import type {
  A2AConversationActor,
  A2AConversationMessage,
  A2AConversationMessageKind,
  A2AConversationSession,
  A2AConversationState,
} from './conversationTypes';
import { normalizeSimplemsgDisplayContent, readSimplemsgPayloadContentType } from './simplemsgPayload';

const CHAT_FILE_RE = /^chat-[a-z0-9]+-[a-z0-9]+\.json$/u;

export interface PeerConversationSummary {
  conversationId: string;
  localGlobalMetaId: string;
  localName: string | null;
  localAvatar: string | null;
  peerGlobalMetaId: string;
  peerName: string | null;
  peerAvatar: string | null;
  latestText: string;
  latestAt: number;
  messageCount: number;
  kinds: A2AConversationMessageKind[];
  state: string;
}

export interface ListPeerConversationSummariesInput {
  homeDir: string;
  localGlobalMetaId: string;
  limit?: number;
}

export interface ListPeerConversationSummariesResult {
  localBot: {
    globalMetaId: string;
    name: string | null;
    avatar: string | null;
  };
  conversations: PeerConversationSummary[];
}

export interface ReadPeerConversationMessagesInput {
  homeDir: string;
  localGlobalMetaId: string;
  peerGlobalMetaId: string;
  before?: number;
  after?: number;
  limit?: number;
}

export interface ReadPeerConversationMessagesResult {
  localBot: {
    globalMetaId: string;
    name: string | null;
    avatar: string | null;
  };
  peerBot: {
    globalMetaId: string;
    name: string | null;
    avatar: string | null;
  };
  messages: A2AConversationMessage[];
  pagination: {
    beforeCursor: number | null;
    afterCursor: number | null;
    hasMoreBefore: boolean;
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimestamp(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  const normalized = parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
  return Math.trunc(normalized);
}

function normalizeLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(100, Math.max(1, Math.trunc(parsed)));
}

function normalizeActor(value: unknown): A2AConversationActor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Partial<A2AConversationActor>;
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

function normalizeMessage(value: unknown): A2AConversationMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const message = value as A2AConversationMessage;
  if (!normalizeText(message.messageId)) {
    return null;
  }
  const display = normalizeSimplemsgDisplayContent({
    content: message.content,
    contentType: message.contentType,
    payloadContentType: readSimplemsgPayloadContentType(message.raw),
  });
  return {
    ...message,
    messageId: normalizeText(message.messageId),
    content: display.content,
    contentType: display.contentType,
    timestamp: normalizeTimestamp(message.timestamp),
  };
}

function normalizeSession(value: unknown): A2AConversationSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const session = value as A2AConversationSession;
  return normalizeText(session.sessionId) ? session : null;
}

function normalizeConversationState(value: unknown): A2AConversationState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Partial<A2AConversationState>;
  const local = normalizeActor(record.local);
  const peer = normalizeActor(record.peer);
  if (!local || !peer) {
    return null;
  }
  const messages = Array.isArray(record.messages)
    ? record.messages.map(normalizeMessage).filter((entry): entry is A2AConversationMessage => Boolean(entry))
    : [];
  const sessions = Array.isArray(record.sessions)
    ? record.sessions.map(normalizeSession).filter((entry): entry is A2AConversationSession => Boolean(entry))
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
    updatedAt: normalizeTimestamp(record.updatedAt),
  };
}

function sortMessages(messages: A2AConversationMessage[]): A2AConversationMessage[] {
  return [...messages].sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }
    return left.messageId.localeCompare(right.messageId);
  });
}

function latestPeerSession(conversation: A2AConversationState): A2AConversationSession | null {
  return [...conversation.sessions]
    .filter((session) => session.type === 'peer')
    .sort((left, right) => normalizeTimestamp(right.updatedAt) - normalizeTimestamp(left.updatedAt))[0] ?? null;
}

function conversationIdFor(conversation: A2AConversationState): string {
  const peerSession = latestPeerSession(conversation);
  if (peerSession) {
    return peerSession.sessionId;
  }
  return `peer-${conversation.local.globalMetaId}-${conversation.peer.globalMetaId}`;
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

async function readConversations(homeDir: string): Promise<A2AConversationState[]> {
  const files = await listConversationFiles(homeDir);
  const conversations: A2AConversationState[] = [];
  for (const filePath of files) {
    const conversation = normalizeConversationState(await readJsonFile(filePath));
    if (conversation) {
      conversations.push(conversation);
    }
  }
  return conversations;
}

function filterLocalConversations(
  conversations: A2AConversationState[],
  localGlobalMetaId: string,
): A2AConversationState[] {
  const normalizedLocal = normalizeText(localGlobalMetaId);
  return conversations.filter((conversation) => conversation.local.globalMetaId === normalizedLocal);
}

function summarizeConversation(conversation: A2AConversationState): PeerConversationSummary {
  const messages = sortMessages(conversation.messages);
  const latestMessage = messages[messages.length - 1] ?? null;
  const kinds: A2AConversationMessageKind[] = [];
  for (const message of messages) {
    if (!kinds.includes(message.kind)) {
      kinds.push(message.kind);
    }
  }
  const peerSession = latestPeerSession(conversation);
  return {
    conversationId: conversationIdFor(conversation),
    localGlobalMetaId: conversation.local.globalMetaId,
    localName: conversation.local.name ?? null,
    localAvatar: conversation.local.avatar ?? null,
    peerGlobalMetaId: conversation.peer.globalMetaId,
    peerName: conversation.peer.name ?? null,
    peerAvatar: conversation.peer.avatar ?? null,
    latestText: latestMessage?.content ?? '',
    latestAt: latestMessage?.timestamp ?? conversation.updatedAt,
    messageCount: messages.length,
    kinds,
    state: normalizeText(peerSession?.state) || 'active',
  };
}

export async function listPeerConversationSummaries(
  input: ListPeerConversationSummariesInput,
): Promise<ListPeerConversationSummariesResult> {
  const conversations = filterLocalConversations(
    await readConversations(input.homeDir),
    input.localGlobalMetaId,
  );
  const first = conversations[0] ?? null;
  const limit = normalizeLimit(input.limit, 100);
  return {
    localBot: {
      globalMetaId: normalizeText(input.localGlobalMetaId),
      name: first?.local.name ?? null,
      avatar: first?.local.avatar ?? null,
    },
    conversations: conversations
      .map(summarizeConversation)
      .sort((left, right) => right.latestAt - left.latestAt)
      .slice(0, limit),
  };
}

export async function readPeerConversationMessages(
  input: ReadPeerConversationMessagesInput,
): Promise<ReadPeerConversationMessagesResult> {
  const localGlobalMetaId = normalizeText(input.localGlobalMetaId);
  const peerGlobalMetaId = normalizeText(input.peerGlobalMetaId);
  const conversation = (await readConversations(input.homeDir)).find((entry) => (
    entry.local.globalMetaId === localGlobalMetaId
      && entry.peer.globalMetaId === peerGlobalMetaId
  )) ?? null;
  const sortedMessages = sortMessages(conversation?.messages ?? []);
  const limit = normalizeLimit(input.limit);
  const before = Number.isFinite(input.before) ? Math.trunc(Number(input.before)) : null;
  const after = Number.isFinite(input.after) ? Math.trunc(Number(input.after)) : null;
  const windowed = (() => {
    if (after !== null) {
      return sortedMessages.filter((message) => message.timestamp > after).slice(0, limit);
    }
    if (before !== null) {
      return sortedMessages.filter((message) => message.timestamp < before).slice(-limit);
    }
    return sortedMessages.slice(-limit);
  })();
  const firstMessage = windowed[0] ?? null;
  const lastMessage = windowed[windowed.length - 1] ?? null;
  return {
    localBot: {
      globalMetaId: localGlobalMetaId,
      name: conversation?.local.name ?? null,
      avatar: conversation?.local.avatar ?? null,
    },
    peerBot: {
      globalMetaId: peerGlobalMetaId,
      name: conversation?.peer.name ?? null,
      avatar: conversation?.peer.avatar ?? null,
    },
    messages: windowed,
    pagination: {
      beforeCursor: firstMessage?.timestamp ?? null,
      afterCursor: lastMessage?.timestamp ?? null,
      hasMoreBefore: firstMessage
        ? sortedMessages.some((message) => message.timestamp < firstMessage.timestamp)
        : false,
    },
  };
}
