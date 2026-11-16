/**
 * Per-session mail queue (local session adapters P2a).
 *
 * Durable inbox for local agent sessions, persisted at
 * `<systemHome>/.metabot/sessions/session-mail.json` (0600, atomic
 * write-then-rename, serialized writes — same discipline as the session
 * registry). P2a exposes it over the daemon API and the `metabot mcp` pull
 * tier; P2b wires the real inbound flow (handleInboundMessage router) into
 * `enqueue`.
 *
 * Semantics (reason-network discipline):
 * - mail waits for its session for MAIL_TTL_MS (24h), then expires;
 * - `checkInbox` long-polls and hands over unread entries, marking them
 *   delivered; the session acks with `ackRead` once it has really seen them;
 * - `status` reports content-free per-id stages (queued/delivered/read/
 *   expired) so senders get receipts without reading bodies.
 */
export declare const MAIL_TTL_MS: number;
/** Long-poll ceiling: the daemon must answer well inside client timeouts. */
export declare const MAX_CHECK_WAIT_SECS = 25;
export type SessionMailStatus = 'queued' | 'delivered' | 'read' | 'expired';
export interface SessionMailEntry {
    id: string;
    /** Recipient session key (`<agent>:<session-id>`). */
    sessionKey: string;
    /** Sender identity (peer GlobalMetaID, or a session key for local senders). */
    from: string;
    fromName?: string;
    body: string;
    createdAt: number;
    deliveredAt?: number;
    readAt?: number;
    expiredAt?: number;
}
export interface SessionMailState {
    version: 1;
    updatedAt: string;
    entries: SessionMailEntry[];
}
/** Receipt projection: content-free, safe for senders and message_status. */
export interface SessionMailReceipt {
    id: string;
    sessionKey: string;
    status: SessionMailStatus;
    createdAt: number;
    deliveredAt?: number;
    readAt?: number;
    expiredAt?: number;
}
export interface EnqueueMailInput {
    sessionKey: string;
    from: string;
    body: string;
    fromName?: string;
}
export interface CheckInboxInput {
    sessionKey: string;
    /** Long-poll up to this many seconds (capped at MAX_CHECK_WAIT_SECS). */
    waitSecs?: number;
    now?: () => number;
}
export interface SessionMailQueueInput {
    statePath: string;
    now?: () => number;
}
export interface SessionMailQueue {
    enqueue(input: EnqueueMailInput): Promise<SessionMailEntry>;
    /**
     * Unread (queued) mail for the session; marks handed-over entries
     * `delivered`. Long-polls up to `waitSecs` when the inbox is empty.
     */
    checkInbox(input: CheckInboxInput): Promise<SessionMailEntry[]>;
    /** Session ack: entries it has really seen become `read`. */
    ackRead(sessionKey: string, ids: string[]): Promise<SessionMailReceipt[]>;
    /** Mark one entry delivered (the push adapters call this on success). */
    markDelivered(id: string): Promise<SessionMailReceipt | null>;
    /** Content-free receipts for the given ids (all statuses, any session). */
    status(ids: string[]): Promise<SessionMailReceipt[]>;
    /** Pending (queued) count per session key — the unread-notice helper. */
    pendingCount(sessionKey: string): Promise<number>;
}
export declare function createSessionMailQueue(input: SessionMailQueueInput): SessionMailQueue;
