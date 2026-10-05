/**
 * MetaTask projection store (M3 — JSON redesign of the IDBots SQLite store).
 *
 * Everything here is a REBUILDABLE cache of the chain replay — the chain is
 * the only source of truth. Deleting this directory costs exactly one full
 * re-collect; nothing here is authoritative.
 *
 * Layout (system-level, shared across profiles — chain truth is global):
 *   ~/.metabot/runtime/metatask/version.json         { "version": 3 }
 *   ~/.metabot/runtime/metatask/events/<segment>.jsonl  raw chain events, one
 *     JSON per line, append-only; load-time dedupe by pinId (last row wins)
 *   ~/.metabot/runtime/metatask/projections/<rootPinId>.json  one file per
 *     task root: { dirtyKey, savedAtMs, projection } (atomic rename per write)
 *   ~/.metabot/runtime/metatask/refresh-state.json   last/ok/error/boundary/
 *     refreshing/seq
 *   ~/.metabot/runtime/metatask/watch-state.json     per (root,node) statuses
 *   ~/.metabot/runtime/metatask/alerts.json          display-only alerts
 *   ~/.metabot/runtime/metatask/identities.json      metaId → display identity
 *
 * Semantics ported from the IDBots SQLite store one-for-one:
 *  - no-degrade upsert: an event whose body failed to parse ({}) never
 *    overwrites a cached good body, while every other field still refreshes;
 *  - projection writes are batched in memory first — a mid-batch failure
 *    leaves no partial files on disk;
 *  - the projection format version salts the dirty key (see engine), so a
 *    format upgrade invalidates every cached projection exactly once.
 */
import type { MetaTaskAlert, MetaTaskBoard, MetaTaskChainEvent, MetaTaskIdentity, MetaTaskTaskProjection } from './engine/types';
/** Resolves display identities for metaIds (local roster now; MetaSo later). */
export type MetaTaskIdentityResolver = (metaIds: string[]) => Promise<Record<string, MetaTaskIdentity>>;
export interface MetaTaskStore {
    /** Absolute metatask store root (…/.metabot/runtime/metatask). */
    readonly root: string;
    /** Idempotent, anti-downgrade upsert of raw chain events. Returns rows appended. */
    upsertEvents(events: MetaTaskChainEvent[]): Promise<number>;
    loadEvents(): Promise<MetaTaskChainEvent[]>;
    /** Persist a sweep's projections; roots outside liveRootIds are pruned. */
    saveProjections(projections: MetaTaskTaskProjection[], options?: {
        liveRootIds?: string[];
        dirtyKeys?: Record<string, string>;
    }): Promise<void>;
    /** Read-only sweep state per persisted root (dirty key + parsed projection). */
    projectionSweepState(): Promise<{
        rootPinId: string;
        dirtyKey: string;
        projection: MetaTaskTaskProjection;
    }[]>;
    getProjection(rootPinId: string): Promise<MetaTaskTaskProjection | null>;
    /** Resolve + stamp display identities onto the projections, then persist rows. */
    enrichIdentities(projections: MetaTaskTaskProjection[]): Promise<void>;
    board(localRosterMetaIds: string[]): Promise<MetaTaskBoard>;
    getWatchStatuses(): Promise<{
        root: string;
        node: string;
        status: string;
    }[]>;
    setWatchStatuses(entries: {
        root: string;
        node: string;
        status: string;
    }[]): Promise<void>;
    appendAlerts(alerts: MetaTaskAlert[]): Promise<void>;
    pruneAlerts(olderThanMs: number, nowMs: number): Promise<void>;
    listAlerts(limit?: number): Promise<MetaTaskAlert[]>;
    refreshInfo(): Promise<MetaTaskBoard['refresh']>;
    setRefreshing(refreshing: boolean): Promise<void>;
    markRefreshDone(ok: boolean, error: string | null, boundaryBlock: number): Promise<void>;
    bumpSeq(): Promise<number>;
}
export declare function createMetaTaskStore(root: string, options?: {
    resolveIdentities?: MetaTaskIdentityResolver;
}): MetaTaskStore;
