// Transcript mirror store: per-session JSONL turn mirrors under
// `.runtime/memory/transcripts/`. The dsh-plugin post-turn observer appends
// DSH session turns here so that memory extraction, recall tools, and dream
// activity gathering treat local DSH sessions and on-chain A2A conversations
// uniformly. This module also reads the existing `.runtime/A2A/chat-*.json`
// stores for the recent-chats / conversation-search surfaces.
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { MetabotPaths } from '../state/paths';
import { extractConversationSearchTerms } from './memoryText';

export interface TranscriptTurn {
  turn?: number;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  channel: string;
  peerGlobalMetaId?: string | null;
}

export interface ChatSummary {
  sessionId: string;
  channel: string;
  peerGlobalMetaId?: string | null;
  peerName?: string | null;
  messageCount: number;
  lastMessageText: string;
  lastMessageAt: number;
}

export interface ConversationSearchRecord {
  sessionId: string;
  channel: string;
  peerGlobalMetaId?: string | null;
  peerName?: string | null;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
}

const TRANSCRIPT_TEXT_MAX_CHARS = 4000;
const SNIPPET_MAX_CHARS = 280;

function sanitizeSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, '');
  if (safe && safe.length <= 120) return safe;
  return `sid-${crypto.createHash('sha1').update(trimmed).digest('hex').slice(0, 16)}`;
}

function transcriptPath(paths: MetabotPaths, sessionId: string): string {
  return path.join(paths.memoryTranscriptsRoot, `${sanitizeSessionId(sessionId)}.jsonl`);
}

function truncateText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function normalizeTurn(value: unknown): TranscriptTurn | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null;
  const text = typeof record.text === 'string' ? record.text : '';
  if (!role || !text.trim()) return null;
  return {
    ...(typeof record.turn === 'number' && Number.isFinite(record.turn) ? { turn: record.turn } : {}),
    role,
    text,
    ts: typeof record.ts === 'number' && Number.isFinite(record.ts) ? record.ts : 0,
    channel: typeof record.channel === 'string' && record.channel.trim() ? record.channel.trim() : 'dsh',
    peerGlobalMetaId: typeof record.peerGlobalMetaId === 'string' && record.peerGlobalMetaId.trim()
      ? record.peerGlobalMetaId.trim()
      : null,
  };
}

/** Append one turn mirror line. Fire-and-forget friendly: never throws on ENOENT races. */
export async function appendTranscriptTurn(
  paths: MetabotPaths,
  input: TranscriptTurn & { sessionId: string },
): Promise<void> {
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  if (!sessionId) {
    throw new Error('A transcript turn requires a sessionId.');
  }
  const normalized = normalizeTurn(input);
  if (!normalized) {
    throw new Error('A transcript turn requires role (user|assistant) and non-empty text.');
  }
  await fs.mkdir(paths.memoryTranscriptsRoot, { recursive: true });
  const line = `${JSON.stringify(normalized)}\n`;
  await fs.appendFile(transcriptPath(paths, sessionId), line, 'utf8');
}

export async function readTranscript(
  paths: MetabotPaths,
  sessionId: string,
  options: { limit?: number } = {},
): Promise<TranscriptTurn[]> {
  let raw: string;
  try {
    raw = await fs.readFile(transcriptPath(paths, sessionId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const turns = raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return normalizeTurn(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((turn): turn is TranscriptTurn => turn !== null);
  // No limit by default: gatherActivity needs the whole day, not just the
  // last turn. Callers that pass a limit get the capped tail.
  const limit = options.limit === undefined ? 0 : Math.max(0, Math.floor(options.limit));
  return limit > 0 ? turns.slice(-limit) : turns;
}

interface A2AConversationMessageLike {
  direction?: string;
  content?: string;
  timestamp?: number;
}

interface A2AConversationFileLike {
  peer?: { globalMetaId?: string | null; name?: string | null } | null;
  messages?: A2AConversationMessageLike[];
}

async function listA2AConversationFiles(paths: MetabotPaths): Promise<string[]> {
  try {
    const entries = await fs.readdir(paths.a2aRoot);
    return entries.filter((entry) => entry.startsWith('chat-') && entry.endsWith('.json'));
  } catch {
    return [];
  }
}

async function readA2AConversation(paths: MetabotPaths, fileName: string): Promise<A2AConversationFileLike | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(paths.a2aRoot, fileName), 'utf8')) as A2AConversationFileLike;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function listTranscriptSessions(paths: MetabotPaths): Promise<string[]> {
  try {
    const entries = await fs.readdir(paths.memoryTranscriptsRoot);
    return entries
      .filter((entry) => entry.endsWith('.jsonl'))
      .map((entry) => entry.slice(0, -'.jsonl'.length));
  } catch {
    return [];
  }
}

/** Recent chats across mirrored DSH transcripts and on-chain A2A conversations, newest first. */
export async function listRecentChats(
  paths: MetabotPaths,
  options: { limit?: number; sortOrder?: 'asc' | 'desc' } = {},
): Promise<ChatSummary[]> {
  const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 10)));
  const chats: ChatSummary[] = [];

  for (const sessionId of await listTranscriptSessions(paths)) {
    const turns = await readTranscript(paths, sessionId);
    if (turns.length === 0) continue;
    const last = turns[turns.length - 1];
    chats.push({
      sessionId,
      channel: last.channel,
      peerGlobalMetaId: last.peerGlobalMetaId ?? null,
      peerName: null,
      messageCount: turns.length,
      lastMessageText: truncateText(last.text, SNIPPET_MAX_CHARS),
      lastMessageAt: last.ts,
    });
  }

  for (const fileName of await listA2AConversationFiles(paths)) {
    const conversation = await readA2AConversation(paths, fileName);
    if (!conversation || !Array.isArray(conversation.messages) || conversation.messages.length === 0) continue;
    const messages = conversation.messages.filter((message) => (
      typeof message?.content === 'string' && message.content.trim()
    ));
    if (messages.length === 0) continue;
    const last = messages[messages.length - 1];
    chats.push({
      sessionId: fileName.slice(0, -'.json'.length),
      channel: 'metaweb_private',
      peerGlobalMetaId: conversation.peer?.globalMetaId ?? null,
      peerName: conversation.peer?.name ?? null,
      messageCount: messages.length,
      lastMessageText: truncateText(last.content ?? '', SNIPPET_MAX_CHARS),
      lastMessageAt: typeof last.timestamp === 'number' ? last.timestamp : 0,
    });
  }

  chats.sort((left, right) => right.lastMessageAt - left.lastMessageAt);
  if (options.sortOrder === 'asc') chats.reverse();
  return chats.slice(0, limit);
}

/** Keyword search over mirrored DSH transcripts and A2A conversation messages. */
export async function searchConversations(
  paths: MetabotPaths,
  options: { query: string; maxResults?: number; before?: number; after?: number },
): Promise<ConversationSearchRecord[]> {
  const terms = extractConversationSearchTerms(options.query);
  if (terms.length === 0) return [];
  const maxResults = Math.max(1, Math.min(10, Math.floor(options.maxResults ?? 5)));
  const before = typeof options.before === 'number' && Number.isFinite(options.before) ? options.before : null;
  const after = typeof options.after === 'number' && Number.isFinite(options.after) ? options.after : null;

  const matches: ConversationSearchRecord[] = [];
  const consider = (record: ConversationSearchRecord): void => {
    if (before !== null && record.ts >= before) return;
    if (after !== null && record.ts <= after) return;
    const haystack = record.text.toLowerCase();
    if (!terms.some((term) => haystack.includes(term))) return;
    matches.push(record);
  };

  for (const sessionId of await listTranscriptSessions(paths)) {
    for (const turn of await readTranscript(paths, sessionId)) {
      consider({
        sessionId,
        channel: turn.channel,
        peerGlobalMetaId: turn.peerGlobalMetaId ?? null,
        peerName: null,
        role: turn.role,
        text: truncateText(turn.text, SNIPPET_MAX_CHARS),
        ts: turn.ts,
      });
    }
  }

  for (const fileName of await listA2AConversationFiles(paths)) {
    const conversation = await readA2AConversation(paths, fileName);
    if (!conversation || !Array.isArray(conversation.messages)) continue;
    for (const message of conversation.messages) {
      if (typeof message?.content !== 'string' || !message.content.trim()) continue;
      consider({
        sessionId: fileName.slice(0, -'.json'.length),
        channel: 'metaweb_private',
        peerGlobalMetaId: conversation.peer?.globalMetaId ?? null,
        peerName: conversation.peer?.name ?? null,
        role: message.direction === 'outgoing' ? 'assistant' : 'user',
        text: truncateText(message.content, SNIPPET_MAX_CHARS),
        ts: typeof message.timestamp === 'number' ? message.timestamp : 0,
      });
    }
  }

  matches.sort((left, right) => right.ts - left.ts);
  return matches.slice(0, maxResults);
}
