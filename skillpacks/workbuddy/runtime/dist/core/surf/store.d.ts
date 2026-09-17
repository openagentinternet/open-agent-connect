import type { MetabotPaths } from '../state/paths.js';
export type MetawebSurfTrigger = 'manual-chat' | 'manual-ui' | 'pre-dream';
export type MetawebSurfRunStatus = 'running' | 'done' | 'failed';
/**
 * Strongest action the bot has taken on a seen pin, ranked: briefing-only
 * actions first, then read/save, then chain-writing interactions. A later
 * markSeen with a lower rank must not downgrade the recorded action.
 */
export type MetawebSurfSeenAction = 'presented' | 'skipped' | 'read' | 'saved' | 'liked' | 'commented' | 'answered' | 'posted' | 'challenged';
/** Exported for the surf interaction guard (duplicate-interaction checks rank actions). */
export declare const SEEN_ACTION_RANK: Record<MetawebSurfSeenAction, number>;
export declare const SURF_SEEN_RETENTION_DAYS = 90;
export declare const SURF_SEEN_MAX_ROWS_PER_BOT = 5000;
export interface MetawebSurfRunStats {
    fetched: number;
    deepRead: number;
    savedToKb: number;
    knowledgePoints: number;
    liked: number;
    commented: number;
    answered: number;
    posted: number;
    challenged: number;
    inboxHandled: number;
    discoveredProtocols: number;
    /** Scheduled tasks created (surf→work handoff); ground truth from the session marker. */
    tasksScheduled: number;
}
export declare const emptySurfRunStats: () => MetawebSurfRunStats;
export interface MetawebSurfRunRecord {
    id: string;
    trigger: MetawebSurfTrigger;
    status: MetawebSurfRunStatus;
    stats: MetawebSurfRunStats;
    reportMarkdown: string | null;
    reportJson: string | null;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface MetawebSurfProtocolState {
    protocolKey: string;
    /** Unix seconds of the newest chain item seen last run; null = never surfed. */
    lastSeenTs: number | null;
    lastPinId: string | null;
    /**
     * Opaque surf-reads R1 cursor of the unscanned backlog remainder (the
     * window's first page reported hasMore, or a backlog page still in
     * progress). null = no registered debt. Stored and forwarded verbatim,
     * never parsed client-side.
     */
    backlogCursor: string | null;
    updatedAt: string;
}
declare function isoNow(nowMs: number): string;
export interface MetawebSurfStore {
    createRun(input: {
        id: string;
        trigger: MetawebSurfTrigger;
        nowIso: string;
    }): Promise<MetawebSurfRunRecord>;
    finishRun(id: string, outcome: {
        status: Exclude<MetawebSurfRunStatus, 'running'>;
        stats: MetawebSurfRunStats;
        reportMarkdown?: string | null;
        reportJson?: string | null;
        error?: string | null;
        finishedAtIso: string;
    }): Promise<boolean>;
    getRun(id: string): Promise<MetawebSurfRunRecord | null>;
    /** Newest first, for the UI report list. */
    listRuns(limit?: number): Promise<MetawebSurfRunRecord[]>;
    /** Latest finished run regardless of trigger — the "surfed within 20h" check. */
    getLatestFinishedRun(): Promise<MetawebSurfRunRecord | null>;
    /** True when any run is currently in the running state. */
    hasRunningRun(): Promise<boolean>;
    /**
     * Crash recovery: runs left 'running' by a killed process become failed —
     * a surf run has no queue to rejoin, the next trigger starts a fresh one.
     */
    failStaleRunningRuns(input: {
        error: string;
        nowIso: string;
        excludeId?: string;
    }): Promise<number>;
    getProtocolState(protocolKey: string): Promise<MetawebSurfProtocolState | null>;
    listProtocolStates(): Promise<MetawebSurfProtocolState[]>;
    /**
     * Advance the watermark after a successful run; never rewinds.
     *
     * `lastSeenTs: null` leaves the watermark untouched (backlog pages never
     * advance it — their items are older than the watermark).
     *
     * `backlogCursor`: undefined leaves the stored cursor untouched, null
     * CLEARS it (backlog debt drained), a string STORES it verbatim (opaque
     * server token — the store never parses or validates it).
     */
    advanceProtocolState(protocolKey: string, input: {
        lastSeenTs: number | null;
        lastPinId?: string | null;
        nowIso: string;
        backlogCursor?: string | null;
    }): Promise<void>;
    getSeenAction(pinId: string): Promise<MetawebSurfSeenAction | null>;
    /** Record that the bot saw a pin, upgrading to the strongest action so far. */
    markSeen(pinId: string, action: MetawebSurfSeenAction, nowIso: string): Promise<void>;
    /** Batch variant of markSeen: one queued read-modify-write for a whole run's ledger writes. */
    markSeenBatch(entries: Array<{
        pinId: string;
        action: MetawebSurfSeenAction;
    }>, nowIso: string): Promise<void>;
    /** Return the subset of candidate pin ids the bot has never seen. */
    filterUnseen(pinIds: string[]): Promise<string[]>;
    /** Bound ledger growth: drop entries older than the retention window, then (if still oversized) the oldest entries beyond the cap. */
    pruneSeenPins(nowIso: string): Promise<void>;
}
/** Create the per-bot surf store bound to `paths.surf*` (`.runtime/surf/`). */
export declare function createMetawebSurfStore(paths: MetabotPaths): MetawebSurfStore;
export { isoNow };
