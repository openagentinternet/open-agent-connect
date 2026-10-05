/**
 * Chain → projection pipeline for the MetaTask read path (M4 — OAC port of
 * the IDBots refresher): collect the ten pools → cache events → replay the
 * DIRTY task roots → persist projections → board. The chain is the source of
 * truth; everything in the store is a rebuildable projection. A failed network
 * sweep keeps the last good projections and records the error for the
 * freshness line.
 *
 * Scale hardening (ported as-is):
 *  - a root whose replay-relevant event set is unchanged (and whose persisted
 *    projection has no pending time-driven deadline) is not replayed and its
 *    file is not rewritten;
 *  - ordinary callers are coalesced to at most one sweep per minIntervalMs
 *    (tick callers bypass it — their own cadence already spaces them out).
 */
import { type CollectMetaTaskEventsOptions } from './collector';
import type { MetaTaskBoard, MetaTaskChainEvent, MetaTaskTaskProjection } from './engine/types';
import type { MetaTaskStore } from './store';
export interface MetaTaskRefreshResult {
    ok: boolean;
    board: MetaTaskBoard | null;
    error: string | null;
}
export interface MetaTaskRefreshOptions {
    /**
     * Start even when the minimum-interval window has not elapsed. The daemon
     * tick uses this: its own cadence already spaces it out, and it must never
     * be deferred by a burst of tool-triggered requests.
     */
    bypassMinInterval?: boolean;
}
export interface MetaTaskRefresherOptions {
    store: () => MetaTaskStore;
    rosterMetaIds?: () => string[];
    collectOptions?: CollectMetaTaskEventsOptions;
    /**
     * Minimum spacing between sweeps STARTED by ordinary callers (tools, HTTP).
     * Requests inside the window do not run immediately: exactly one trailing
     * sweep is scheduled for when the window elapses. 0 disables coalescing.
     */
    minIntervalMs?: number;
    /** Clock seam (default Date.now). */
    now?: () => number;
}
export declare class MetaTaskRefresher {
    private readonly options;
    private readonly minIntervalMs;
    private readonly now;
    private inFlight;
    /** Start instant of the last sweep that actually began (ms). */
    private lastStartedAtMs;
    private trailing;
    constructor(options: MetaTaskRefresherOptions);
    board(): Promise<MetaTaskBoard>;
    detail(rootPinId: string): Promise<MetaTaskTaskProjection | null>;
    /** All cached chain events — engine input for guards and replays. */
    loadEvents(): Promise<MetaTaskChainEvent[]>;
    private roster;
    /**
     * Sweep the chain. Concurrent callers share the in-flight sweep; callers
     * inside the minimum-interval window share exactly one trailing sweep.
     */
    refreshOnce(reason: string, options?: MetaTaskRefreshOptions): Promise<MetaTaskRefreshResult>;
    /** Cancel a pending coalesced sweep (daemon shutdown). */
    dispose(): void;
    private start;
    private scheduleTrailing;
    /**
     * A skipped replay is only safe while no time-driven clock has crossed since
     * the last one (claim TTL / review window / challenge TTL — see deadlines).
     * Challenge candidates come from the scoped event set, because the projection
     * exposes only the `disputed` flag, not challenge timestamps.
     */
    private deadlinePending;
    private runRefresh;
}
