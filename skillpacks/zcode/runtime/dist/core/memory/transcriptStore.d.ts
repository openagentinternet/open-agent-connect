import type { MetabotPaths } from '../state/paths';
export interface TranscriptTurn {
    turn?: number;
    role: 'user' | 'assistant';
    text: string;
    ts: number;
    channel: string;
    peerGlobalMetaId?: string | null;
}
/** One session's readable conversation, DSH transcript or A2A private chat. */
export interface SessionReadSummary {
    sessionId: string;
    channel: string;
    peerGlobalMetaId: string | null;
    peerName: string | null;
    messageCount: number;
    firstMessageAt: number;
    lastMessageAt: number;
    turns: TranscriptTurn[];
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
/** Append one turn mirror line. Fire-and-forget friendly: never throws on ENOENT races. */
export declare function appendTranscriptTurn(paths: MetabotPaths, input: TranscriptTurn & {
    sessionId: string;
}): Promise<void>;
export declare function readTranscript(paths: MetabotPaths, sessionId: string, options?: {
    limit?: number;
}): Promise<TranscriptTurn[]>;
/**
 * Normalize one session reference the way tool outputs print it. Accepts the
 * bare id, a `session:` prefix, or a `session://` scheme; returns null for ids
 * that could not name a stored session (the IDBots cross-session contract).
 */
export declare function normalizeSessionReference(input: string): string | null;
/**
 * Read one session's visible messages by id: the mirrored DSH transcript
 * first, then the A2A private-chat store (ids as recent-chats prints them).
 * Returns null when neither store holds the session.
 */
export declare function readSessionMessages(paths: MetabotPaths, sessionId: string): Promise<SessionReadSummary | null>;
/** Recent chats across mirrored DSH transcripts and on-chain A2A conversations, newest first. */
export declare function listRecentChats(paths: MetabotPaths, options?: {
    limit?: number;
    sortOrder?: 'asc' | 'desc';
}): Promise<ChatSummary[]>;
/** Keyword search over mirrored DSH transcripts and A2A conversation messages. */
export declare function searchConversations(paths: MetabotPaths, options: {
    query: string;
    maxResults?: number;
    before?: number;
    after?: number;
}): Promise<ConversationSearchRecord[]>;
