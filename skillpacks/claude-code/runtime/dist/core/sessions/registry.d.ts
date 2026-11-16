/**
 * Local session registry (local session adapters P1).
 *
 * Machine-wide directory of local agent sessions, persisted at
 * `<systemHome>/.metabot/sessions/local-sessions.json` (0600, atomic
 * write-then-rename; sessions are machine facts, not per-profile state).
 *
 * Discipline borrowed from reason-network:
 * - names stay with their conversation key (`<agent>:<session-id>`): a
 *   re-registered session keeps its name, a new session never takes a
 *   kept name (it gets `-2`/`-3`);
 * - sessions read as alive while seen within 10 minutes and lapse 24 hours
 *   after their last observation, together with their name (claim-sourced
 *   entries are permanent mailboxes and do not lapse);
 * - passive-discovery entries are presence-only (deliverable=false) until
 *   a registration path (MCP/hooks/claim, P2+) marks them deliverable.
 */
import type { DiscoveredSession, LocalSessionRecord, LocalSessionView, SessionRegistrationSource, SessionActivityStatus } from './types';
/** A session reads as alive while observed within this window. */
export declare const SESSION_LIVE_WINDOW_MS: number;
/** A session (and its name) lapses this long after its last observation. */
export declare const SESSION_LAPSE_TTL_MS: number;
export interface RegisterSessionInput {
    agent: string;
    sessionId?: string;
    pid?: number;
    /** Requested directory name (honored when free; suffixed when taken). */
    name?: string;
    cwd?: string;
    status?: SessionActivityStatus;
    doing?: string;
    startedAt?: number;
    inboxSocketPath?: string;
    source: SessionRegistrationSource;
    deliverable: boolean;
}
export interface LocalSessionRegistryInput {
    /** Absolute path of the registry JSON (resolveMetabotSessionPaths). */
    statePath: string;
    now?: () => number;
    probeRepo?: (cwd: string) => Promise<{
        repo: string;
        branch: string;
    }>;
}
export interface LocalSessionRegistry {
    /**
     * Registry rows. Default: alive sessions only. `all`: every non-lapsed
     * record, offline included. Lapsed records are pruned on read.
     */
    list(options?: {
        all?: boolean;
    }): Promise<LocalSessionView[]>;
    /** Register or refresh a session (P2+ callers; P1 uses applyDiscovery). */
    registerSession(input: RegisterSessionInput): Promise<LocalSessionRecord>;
    /** Merge a discovery scan's presence into the registry (idempotent). */
    applyDiscovery(entries: DiscoveredSession[]): Promise<void>;
    /** Bind a private-chat conversation to a session (by name or key; P2b). */
    bindConversation(input: {
        sessionRef: string;
        conversationId: string;
        profileSlug?: string;
        /** Observed peer enrichment (the router records it on each routed mail). */
        peerGlobalMetaId?: string;
    }): Promise<LocalSessionRecord>;
    /** Drop a conversation binding (by conversation id). */
    unbindConversation(conversationId: string): Promise<LocalSessionRecord | null>;
    /**
     * Resolve the session a conversation is bound to (deliverable or not —
     * the caller decides what offline means for its tier).
     */
    findByConversation(conversationId: string): Promise<LocalSessionRecord | null>;
    /** Resolve a session by name or key (bind/send surfaces). */
    findByRef(sessionRef: string): Promise<LocalSessionRecord | null>;
}
export declare function createLocalSessionRegistry(input: LocalSessionRegistryInput): LocalSessionRegistry;
