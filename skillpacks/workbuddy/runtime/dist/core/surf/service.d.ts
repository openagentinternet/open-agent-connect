import { type MetawebSurfRunRecord, type MetawebSurfRunStats, type MetawebSurfSeenAction, type MetawebSurfStore, type MetawebSurfTrigger } from './store.js';
import { type SurfBriefing, type SurfInboxItem, type SurfProtocolRadarFetchResult } from './briefing.js';
import { type SurfProtocolDescriptor } from './protocols.js';
import type { MetawebSurfSettingsStore } from './settings.js';
/** A finished surf younger than this makes the pre-dream surf redundant. */
export declare const PRE_DREAM_SURF_RECENCY_MS: number;
export interface SurfStatusEvent {
    botSlug: string;
    runId: string;
    trigger: MetawebSurfTrigger;
    status: 'running' | 'done' | 'failed';
    error?: string | null;
}
export interface SurfSessionContext {
    runId: string;
    botSlug: string;
    botName: string;
    trigger: MetawebSurfTrigger;
    briefing: SurfBriefing;
    /**
     * Set by the daemon session wiring: false runs the DEGRADED prompt variant
     * (no KB/memory tools exist in that session) — manual triggers are allowed
     * with memory off. Absent → full prompt.
     */
    memoryEnabled?: boolean;
    /**
     * The "notes for next surf" the bot wrote in its last DONE run's report,
     * read back out of reportJson. Absent/null → no notes section in the prompt.
     */
    previousNotes?: string | null;
}
export interface SurfSessionResult {
    stats?: Partial<MetawebSurfRunStats>;
    reportMarkdown?: string | null;
    reportJson?: string | null;
    /** Per-pin actions reported by the session, folded into the seen ledger. */
    seenActions?: Array<{
        pinId: string;
        action: MetawebSurfSeenAction;
    }>;
}
export interface SurfServiceDeps {
    botSlug: string;
    botName: string;
    store: MetawebSurfStore;
    settings: MetawebSurfSettingsStore;
    broadcast: (payload: SurfStatusEvent) => void;
    /** The unattended LLM session; absent → digest-only run (still useful: report + watermarks). */
    runSurfSession?: (context: SurfSessionContext) => Promise<SurfSessionResult>;
    /**
     * Memory policy (same source the study service reads). Only the PRE-DREAM
     * path is gated: the nightly unattended run learns into the KB, so with
     * memory off it is skipped. Manual triggers deliberately run DEGRADED with
     * memory off — the session gets no KB/memory tools and the prompt says so.
     * Absent → gate off (tests). May return a promise (file backed stores).
     */
    isMemoryEnabled?: () => boolean | Promise<boolean>;
    /**
     * Local chain-writes ledger read for the pre-briefing reconciliation:
     * receipts lost to a crash/kill mid-run are re-derived before every run so
     * the duplicate-interaction guard never works off a stale ledger. Absent →
     * reconciliation skipped.
     */
    listChainWritesForSurf?: () => Promise<Array<{
        pinId: string;
        path: string | null;
        contentText: string | null;
    }>>;
    registry?: SurfProtocolDescriptor[];
    nowMs?: () => number;
    /**
     * Bot identity for the deterministic inbox (R3): the interactions API
     * accepts an address, metaId or globalMetaId as owner. Absent → no inbox
     * section (the prompt degrades to one line). May return a promise (file
     * backed identity stores).
     */
    getBotIdentity?: () => {
        address?: string | null;
        globalMetaId?: string | null;
    } | null | Promise<{
        address?: string | null;
        globalMetaId?: string | null;
    } | null>;
    /**
     * Deterministic inbox fetcher (R3): likes/comments on the bot's pins plus
     * answers to its questions since `sinceTs` (the previous run's START — an
     * interaction arriving mid-run must surface next run, so the baseline is
     * the run row's createdAt, NOT finishedAt).
     */
    fetchSurfInbox?: (input: {
        owner: string;
        sinceTs: number;
    }) => Promise<SurfInboxItem[]>;
    /** Protocol radar fetcher (R6): newest registered /protocols/* declarations. */
    fetchProtocolRadar?: () => Promise<SurfProtocolRadarFetchResult>;
}
export declare class SurfService {
    private readonly botSlug;
    private readonly botName;
    private readonly store;
    private readonly settings;
    private readonly broadcast;
    private readonly runSurfSession?;
    private readonly isMemoryEnabled?;
    private readonly listChainWritesForSurf?;
    private readonly registry;
    private readonly nowMs;
    private readonly getBotIdentity?;
    private readonly fetchSurfInbox?;
    private readonly fetchProtocolRadar?;
    private runningRunId;
    constructor(deps: SurfServiceDeps);
    /** Crash recovery at daemon startup: runs orphaned by a killed process become failed. */
    recoverAfterRestart(excludeRunId?: string): Promise<number>;
    isRunning(): boolean;
    /** The run this process is executing right now; null when idle. Orphan
     *  sweeps exclude it when failing `running` rows a dead process left. */
    currentRunId(): string | null;
    /**
     * The notes the bot wrote to itself in its last DONE run: read back out of
     * reportJson so the next surf inherits its hard-won lessons. Best-effort —
     * a missing/malformed note must never block a run.
     */
    private latestSurfNotes;
    /**
     * Backfill the seen ledger from the local chain-writes ledger: every own
     * write is a 'posted' receipt and every extractable interaction payload
     * yields its target receipt. Strongest-wins batching makes this a no-op
     * when the ledger is already current. Best-effort — a sick writes ledger
     * must not block a surf run.
     */
    private reconcileSeenLedger;
    /**
     * Pre-dream gate: the bot's surf-before-dream toggle is explicitly enabled
     * (default OFF — opt-in, since every surf spends LLM tokens and gas) and it
     * has not finished a surf within the recency window (a manual evening surf
     * makes the nightly one redundant).
     */
    shouldPreDreamSurf(): Promise<boolean>;
    /**
     * Start a surf run in the background; returns the created run row.
     * Throws when a run is already in flight.
     */
    startSurf(trigger: MetawebSurfTrigger): Promise<MetawebSurfRunRecord>;
    /** Awaitable variant for the pre-dream pipeline. */
    runSurfAndWait(trigger: MetawebSurfTrigger): Promise<MetawebSurfRunRecord>;
    private beginRun;
    private executeRun;
}
