import { type GroupTaskMember, type GroupTaskRecord } from '../grouptask/types';
import type { OpenTeamMembershipRecord } from '../grouptask/openteamStore';
import type { SellerOrderRecord } from '../orders/sellerOrderState';
import type { MetabotPaths } from '../state/paths';
export type DreamRunStatus = 'running' | 'completed' | 'failed';
export type DreamFragmentStatus = 'running' | 'completed' | 'failed';
export interface DreamRun {
    dreamDate: string;
    status: DreamRunStatus;
    attemptCount: number;
    llm: string | null;
    /** Algorithm version the run was made with; 0 = legacy, pre-versioning. */
    dreamVersion: number;
    error: string | null;
    startedAt: number;
    completedAt: number | null;
}
export interface DreamFragment {
    dreamDate: string;
    fragmentKey: string;
    sessionId: string;
    chunkIndex: number;
    contentHash: string;
    sourceMessageCount: number;
    sourceCharCount: number;
    estimatedInputTokens: number;
    status: DreamFragmentStatus;
    summaryJson: string | null;
    llm: string | null;
    dreamVersion: number;
    error: string | null;
    attemptCount: number;
    createdAt: number;
    updatedAt: number;
}
export interface DailySummarySessionRef {
    sessionId: string;
    title: string;
    sessionType: string;
    isOrder: boolean;
}
export interface DailySummary {
    summaryDate: string;
    summaryText: string;
    sections: Record<string, string>;
    stats: Record<string, number>;
    /** Sessions that fed this summary — the index from a recalled day back to
     * the full conversations. */
    sessionRefs: DailySummarySessionRef[];
    llm: string | null;
    createdAt: number;
    updatedAt: number;
}
export interface DreamActivityMessage {
    type: 'user' | 'assistant';
    content: string;
    createdAt: number;
    /** Human's per-message rating (thumbs up/down), when the message was rated. */
    feedbackRating?: 'up' | 'down';
    /** Human's free-text comment attached to the rating, when present. */
    feedbackComment?: string | null;
}
export interface DreamSessionActivity {
    sessionId: string;
    title: string;
    sessionType: string;
    peerName: string | null;
    isOrder: boolean;
    messages: DreamActivityMessage[];
}
export interface DreamTaskRunActivity {
    taskName: string;
    status: string;
    startedAt: number;
    sessionId: string | null;
}
/** accepted = closed/rated that day; active = still open with same-day activity. */
export type DreamGroupTaskPhase = 'accepted' | 'active';
export interface DreamGroupTaskEvaluation {
    taskId: number;
    title: string;
    goal: string;
    memberRole: string;
    rating: number | null;
    ratingComment: string | null;
    status?: string;
    phase?: DreamGroupTaskPhase;
    dayMessageCount?: number;
}
export interface DreamGroupChatMessage {
    senderName: string;
    content: string;
    occurredAt: number;
}
export interface DreamGroupChatActivity {
    taskId: number;
    title: string;
    taskStatus: string;
    memberRole: string;
    messages: DreamGroupChatMessage[];
}
/** A pin the bot itself broadcast to the chain that day (writes ledger). */
export interface DreamChainWriteActivity {
    pinId: string;
    path: string | null;
    operation: string | null;
    occurredAtMs: number;
    /** Async LLM gist when available; the prompt falls back to stored text. */
    summary: string | null;
    contentText: string | null;
    contentType: string | null;
}
/** A chain pin the bot fully read that day (reads ledger). */
export interface DreamChainReadActivity {
    pinId: string;
    path: string | null;
    protocol: string | null;
    title: string | null;
    authorGlobalMetaId: string | null;
    summary: string | null;
    contentExcerpt: string | null;
    savedToKb: boolean;
    readCount: number;
    lastReadAtMs: number;
}
export interface DreamDayActivity {
    sessions: DreamSessionActivity[];
    taskRuns: DreamTaskRunActivity[];
    orderCount: number;
    groupTasks: DreamGroupTaskEvaluation[];
    groupChats?: DreamGroupChatActivity[];
    /** Pins this bot published to the chain that day (chain content history). */
    chainWrites?: DreamChainWriteActivity[];
    /** Chain pins this bot fully read that day (chain content history). */
    chainReads?: DreamChainReadActivity[];
}
/** Render the human-readable diary mirror at `memory/YYYY-MM-DD.md`. */
export declare function renderDreamDiaryMarkdown(summary: DailySummary): string;
/** Per-chat cap on in-day messages handed to the dream pipeline (IDBots caps
 * the same excerpt at 400; the file port stays tighter). */
export declare const DREAM_GROUP_CHAT_MAX_MESSAGES = 200;
/** One in-day group-chat message at full fidelity — the prompt activity shape
 * drops pin/sender ids, but the dream-time experience harvest needs them. */
export interface DreamDayGroupChatSourceMessage {
    index: number;
    pinId: string | null;
    txId: string | null;
    senderName: string | null;
    senderGlobalMetaId: string | null;
    content: string;
    /** Epoch ms (on-disk `chainTimestamp` is epoch seconds, indexer convention). */
    occurredAt: number;
}
/** One group's in-day chat stream joined with its local task or guest membership. */
export interface DreamDayGroupChatSource {
    groupId: string;
    /** Chair-side task row when the group lives in this profile's state.json. */
    task: GroupTaskRecord | null;
    /** OpenTeam membership when this profile joined the group as a guest worker. */
    membership: OpenTeamMembershipRecord | null;
    /** In-day, non-suspect, non-empty messages, chronological. */
    messages: DreamDayGroupChatSourceMessage[];
}
/** Raw day-windowed group-task source rows shared by gatherActivity and the
 * dream-time experience harvest (single implementation of the file reads). */
export interface DreamDayGroupTaskSource {
    tasks: GroupTaskRecord[];
    members: GroupTaskMember[];
    chats: DreamDayGroupChatSource[];
}
/**
 * Best-effort read of the group-task day source: the chair-side state.json,
 * guest OpenTeam memberships, and the decrypted per-group message caches.
 * Read-only and never throws — missing/corrupt files yield empty collections.
 */
export declare function readDreamDayGroupTaskSource(paths: MetabotPaths, input: {
    startMs: number;
    endMs: number;
}): Promise<DreamDayGroupTaskSource>;
/**
 * Best-effort read of the seller orders active inside the day (created or
 * updated in [startMs, endMs)), straight from runtime-state.json. Read-only.
 */
export declare function readDreamDaySellerOrders(paths: MetabotPaths, input: {
    startMs: number;
    endMs: number;
}): Promise<SellerOrderRecord[]>;
export interface DreamStore {
    getRun(dreamDate: string): Promise<DreamRun | null>;
    /** Run states keyed by date, the input the due-date algorithm expects. */
    getRunStates(): Promise<Map<string, DreamRun>>;
    /** Upsert a run as running; resets stale `running` records left by a crash. */
    beginRun(dreamDate: string, llm: string | null, dreamVersion: number): Promise<DreamRun>;
    finishRun(dreamDate: string, status: 'completed' | 'failed', error?: string | null): Promise<void>;
    /**
     * Mark every run left `running` longer than `staleMs` as failed — the
     * crash/restart recovery sweep (IDBots `resetStaleRunningRuns` parity). The
     * due-date algorithm skips `running` dates, so without this sweep a run
     * orphaned by a process restart would stay `running` forever. Returns the
     * number of runs reset.
     */
    resetStaleRunningRuns(options: {
        staleMs: number;
        now?: number;
    }): Promise<number>;
    getFragment(dreamDate: string, fragmentKey: string): Promise<DreamFragment | null>;
    upsertFragment(fragment: DreamFragment): Promise<void>;
    upsertDailySummary(input: {
        summaryDate: string;
        summaryText: string;
        sections: Record<string, string>;
        stats: Record<string, number>;
        sessionRefs: DailySummarySessionRef[];
        llm: string | null;
    }): Promise<DailySummary>;
    listDailySummaries(options?: {
        limit?: number;
        before?: string;
    }): Promise<DailySummary[]>;
    searchDailySummaries(options: {
        query?: string;
        dateFrom?: string;
        dateTo?: string;
        limit?: number;
    }): Promise<DailySummary[]>;
    /** Latest dream date that sourced the current self-identity, if any. */
    getDreamIdentityLatestDate(): Promise<string | null>;
    writeDiaryMarkdown(summary: DailySummary): Promise<void>;
    writeSelfIdentityMarkdown(text: string): Promise<void>;
    /** Gather one local calendar day's activity from transcripts + A2A stores. */
    gatherActivity(input: {
        startMs: number;
        endMs: number;
    }): Promise<DreamDayActivity>;
    /** Hygiene: hard-delete completed/failed runs and every fragment older than
     * the retention horizon — pure history the scheduler never reads again. */
    purgeOldRunsAndFragments(input: {
        cutoffDateKey: string;
    }): Promise<{
        runsDeleted: number;
        fragmentsDeleted: number;
    }>;
}
export declare function createDreamStore(paths: MetabotPaths, deps?: {
    getDreamIdentityLatestDate?: () => Promise<string | null>;
}): DreamStore;
/** sha256 fingerprint of one fragment's source content (resumability anchor). */
export declare function hashDreamFragmentContent(chunk: unknown): string;
