/**
 * App Session (browser.app.session.*) shared types.
 *
 * Implements the docs/09 host contract from
 * https://github.com/openagentinternet/llm-play-chinese-chess
 * (Agent-Game-v2). The daemon is the owner of sessions, grants and leases;
 * this module only defines the data contracts plus the stable bridge error
 * codes used by every browser.app.session.* method.
 */
export declare const AGENT_GAME_PROTOCOL = "agent-game/1";
export declare const APP_SESSION_TYPE = "agent-game";
/** Default protocol paths a session grant may write (docs/09 5.1). */
export declare const DEFAULT_AGENT_GAME_PROTOCOL_PATHS: readonly ["/protocols/simplegroupjoin", "/protocols/simplegroupchat"];
export type AppSessionStatus = 'running' | 'paused' | 'stopped' | 'finished' | 'error';
export type AppSessionErrorCode = 'invalid_params' | 'unsupported_method' | 'consent_denied' | 'session_not_found' | 'session_conflict' | 'adapter_invalid' | 'rules_hash_mismatch' | 'group_not_found' | 'seat_unavailable' | 'adapter_error' | 'llm_unavailable' | 'llm_timeout' | 'rate_limited' | 'bridge_timeout' | 'internal_error' | 'authorization_expired' | 'budget_exhausted' | 'write_failed';
export interface AppSessionError {
    code: AppSessionErrorCode;
    message: string;
    details?: Record<string, unknown>;
}
export interface AppSessionBudget {
    llmCalls: number;
    llmCallsUsed: number;
    writes: number;
    writesUsed: number;
}
/** The public Session object returned by every browser.app.session.* method. */
export interface AppSessionPublic {
    sessionId: string;
    appId: string;
    sessionType: string;
    groupId: string;
    gameId: string;
    manifestUri: string;
    adapterHash: string;
    rulesHash: string;
    seat: string;
    agentId: string;
    status: AppSessionStatus;
    lastIndex: number;
    lastActionSeq: number;
    lastError: AppSessionError | null;
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
    budget: AppSessionBudget;
}
/** browser.app.session.start request (docs/09 4.1). */
export interface AppSessionStartParams {
    appId: string;
    sessionType: string;
    groupId: string;
    gameId: string;
    manifestUri: string;
    rulesHash: string;
    seat: string;
    agentId: string;
    ttlMs?: number;
    budget?: {
        llmCalls?: number;
        writes?: number;
    };
}
export interface AgentGameEnvelope {
    protocol: string;
    gameId: string;
    matchId: string;
    rulesHash: string;
    type: string;
    eventId?: string;
    actionSeq?: number;
    prevStateHash?: string;
    stateHash?: string;
    payload: Record<string, unknown>;
}
/** Normalized group message (index/sender/timestamp are backend authority). */
export interface GroupChatMessage {
    index: number;
    senderMetaId: string;
    timestamp: number;
    content: string;
    encryption?: string;
    protocol?: string;
    pinId?: string;
    groupId?: string;
}
/** Loaded and hash-verified game package (game-manifest.json + adapter.js). */
export interface LoadedGamePackage {
    manifestUri: string;
    manifest: GameManifest;
    adapterCode: string;
    adapterHash: string;
}
export interface GameManifest {
    protocol: string;
    appId?: string;
    gameId: string;
    rulesVersion?: string;
    adapter: string;
    adapterHash: string;
    turnModel?: string;
    informationModel?: string;
    maxPlayers?: number;
}
/** Task-level authorization record (docs/09 5.1). */
export interface AppSessionGrant {
    grantId: string;
    resourceUri: string;
    actorId: string;
    actorGlobalMetaId: string;
    appId: string;
    groupId: string;
    gameId: string;
    rulesHash: string;
    adapterHash: string;
    seat: string;
    protocolPaths: string[];
    ttlMs: number;
    llmBudget: number;
    writeBudget: number;
    createdAt: number;
    expiresAt: number;
    revoked: boolean;
}
/** Pending action write that has not been confirmed on chain yet. */
export interface PendingActionWrite {
    event: AgentGameEnvelope;
    actionSeq: number;
    eventId: string;
    sentAt: number;
    writeCount: number;
    nextRetryAt: number;
}
/** Persisted session record (docs/09 section 3 + internal cursor/state). */
export interface AppSessionRecord {
    sessionId: string;
    appId: string;
    sessionType: string;
    resourceUri: string;
    groupId: string;
    gameId: string;
    manifestUri: string;
    adapterHash: string;
    rulesHash: string;
    seat: string;
    agentId: string;
    actorId: string;
    grantId: string;
    status: AppSessionStatus;
    cursor: number;
    lastActionSeq: number;
    lastError: AppSessionError | null;
    /** Adapter state; JSON-serializable. */
    state: unknown;
    pending: PendingActionWrite | null;
    protocolPaths: string[];
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
    budget: AppSessionBudget;
}
/** Lease record for a (groupId, seat) key; fencing across daemon restarts. */
export interface AppSessionLease {
    key: string;
    sessionId: string;
    leaseId: string;
    ownerId: string;
    expiresAt: number;
    updatedAt: number;
}
export interface AppSessionPersistedState {
    version: 1;
    sessions: AppSessionRecord[];
    grants: AppSessionGrant[];
    leases: AppSessionLease[];
}
export interface AppSessionRuntimeStartReport {
    restored: number;
    running: number;
    paused: number;
    stopped: number;
    conflicts: number;
}
export declare function createAppSessionError(code: AppSessionErrorCode, message: string, details?: Record<string, unknown>): AppSessionError;
export declare function isAppSessionError(value: unknown): value is AppSessionError;
