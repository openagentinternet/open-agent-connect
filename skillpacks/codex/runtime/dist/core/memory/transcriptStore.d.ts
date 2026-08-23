import type { MetabotPaths } from '../state/paths';
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
/** Append one turn mirror line. Fire-and-forget friendly: never throws on ENOENT races. */
export declare function appendTranscriptTurn(paths: MetabotPaths, input: TranscriptTurn & {
    sessionId: string;
}): Promise<void>;
export declare function readTranscript(paths: MetabotPaths, sessionId: string, options?: {
    limit?: number;
}): Promise<TranscriptTurn[]>;
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
