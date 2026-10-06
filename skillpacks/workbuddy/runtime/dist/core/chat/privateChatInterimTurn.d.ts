/**
 * Host-issued "turn ticket" for bot-initiated interim private-chat messages
 * (IDBots send_private_chat parity, adapted to OAC's single-shot reply
 * runner: local runtimes execute skills as shell commands, so the controlled
 * send surface is a CLI command gated by a ticket file instead of an MCP
 * tool).
 *
 * Before each reply turn with a chat workspace, the reply runner writes
 * `.oac-private-chat-turn.json` into the workspace. It locks the recipient
 * to the turn's peer, caps how many interim updates the turn may deliver,
 * and expires shortly after the turn. `metabot chat interim --turn-file …`
 * validates and consumes the ticket before sending, so interim messaging
 * stays: turn-scoped, single-recipient, quota-capped, and time-boxed.
 */
export declare const PRIVATE_CHAT_TURN_CONTEXT_FILE_NAME = ".oac-private-chat-turn.json";
export declare const DEFAULT_INTERIM_MESSAGE_QUOTA = 3;
export declare const MAX_INTERIM_MESSAGE_LENGTH = 600;
export declare const PRIVATE_CHAT_TURN_CONTEXT_TTL_MS: number;
export declare const CHAT_INTERIM_EXTENSION = "chatInterim";
export interface PrivateChatTurnContext {
    version: 1;
    conversationId: string;
    peerGlobalMetaId: string;
    remaining: number;
    issuedAt: number;
    expiresAt: number;
}
export declare function privateChatTurnContextPath(workspaceDir: string): string;
/** Issues (overwrites) the ticket for a fresh reply turn. */
export declare function writePrivateChatTurnContext(input: {
    workspaceDir: string;
    conversationId: string;
    peerGlobalMetaId: string;
    now?: number;
    ttlMs?: number;
    quota?: number;
}): Promise<PrivateChatTurnContext>;
export declare function readPrivateChatTurnContext(turnFilePath: string): Promise<PrivateChatTurnContext | null>;
export type PrivateChatTurnQuotaResult = {
    ok: true;
    context: PrivateChatTurnContext;
} | {
    ok: false;
    error: 'ticket_not_found' | 'ticket_expired' | 'ticket_exhausted';
};
/**
 * Validates the ticket and atomically spends one interim slot. The recipient
 * comes from the ticket (never from the caller), so a spent or forged file
 * cannot redirect a send.
 */
export declare function consumePrivateChatTurnQuota(input: {
    turnFilePath: string;
    now?: number;
}): Promise<PrivateChatTurnQuotaResult>;
/** Normalizes candidate interim text: trimmed, length-capped, no close markers. */
export declare function normalizeInterimMessageText(value: unknown): {
    ok: true;
    text: string;
} | {
    ok: false;
    error: string;
};
