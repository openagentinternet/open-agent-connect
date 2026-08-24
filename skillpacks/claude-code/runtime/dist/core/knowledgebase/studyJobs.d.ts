/**
 * Autonomous study jobs (IDBots M4 parity, scoped to OAC's plain-LLM engine):
 * owner-assigned MetaWeb topics drained nightly into the bot's knowledge
 * base. Queue state only — the learned content lives in the KBs. The drain
 * itself runs through the study prompt the daemon hands its LLM runner with
 * the tool allowlist applied by the caller (no skill turns on OAC).
 */
import type { MetabotPaths } from '../state/paths';
export declare const DEFAULT_STUDY_PIN_BUDGET_PER_NIGHT = 20;
export declare const MAX_STUDY_RUNS_PER_JOB = 10;
export declare const MAX_STUDY_CONSECUTIVE_FAILURES = 3;
/** Nightly drain window, local hours [0, 6). */
export declare const STUDY_WINDOW: {
    readonly startHour: 0;
    readonly endHour: 6;
};
export declare const STUDY_TICK_INTERVAL_MINUTES = 30;
export type StudyJobStatus = 'pending' | 'running' | 'done' | 'failed';
export interface StudyJobRecord {
    id: string;
    metabotSlug: string;
    topic: string;
    topicFingerprint: string;
    status: StudyJobStatus;
    budgetPins: number;
    processedPinIds: string[];
    runCount: number;
    consecutiveFailures: number;
    lastRunAt: number | null;
    summary: string | null;
    error: string | null;
    createdAt: number;
    updatedAt: number;
}
export interface EnqueueStudyJobInput {
    metabotSlug: string;
    topic: string;
    budgetPins?: number;
}
export declare class StudyJobStoreError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function studyTopicFingerprint(topic: string): string;
export interface StudyJobStore {
    enqueueStudyJob(input: EnqueueStudyJobInput): Promise<{
        job: StudyJobRecord;
        created: boolean;
    }>;
    listStudyJobs(metabotSlug?: string): Promise<StudyJobRecord[]>;
    listPending(): Promise<StudyJobRecord[]>;
    getStudyJob(id: string): Promise<StudyJobRecord | null>;
    markRunning(id: string): Promise<StudyJobRecord | null>;
    completeRun(input: {
        id: string;
        processedPinIds: string[];
        summary: string;
        learnedSomethingNew: boolean;
    }): Promise<StudyJobRecord | null>;
    failRun(id: string, error: string): Promise<StudyJobRecord | null>;
    resetRunningToPending(now: number, excludeId?: string): Promise<number>;
}
export declare function createStudyJobStore(paths: MetabotPaths): StudyJobStore;
/** True inside the nightly drain window (local hours 0-6). */
export declare function inStudyWindow(now: Date): boolean;
/** The unattended study prompt (IDBots parity, tool-allowlist note included). */
export declare function buildStudySessionPrompt(input: {
    topic: string;
    budgetPins: number;
}): string;
/**
 * Parse the study run report: the LAST json fence wins; a prose-only reply
 * throws (the job fails rather than guessing).
 */
export declare function parseStudyRunReport(reply: string): {
    processedPinIds: string[];
    summary: string;
};
export interface StudyDrainDeps {
    /** Runs one unattended study turn: prompt in, final report out. */
    runStudyTurn(input: {
        slug: string;
        prompt: string;
        budgetPins: number;
    }): Promise<string>;
    now?: () => number;
    log?: (message: string) => void;
}
/**
 * One study tick: inside the nightly window, drain the oldest pending job.
 * Crash recovery re-arms stale `running` rows first; a run either completes
 * (report parsed, KB writes happened through the tools during the turn) or
 * fails the job. Returns the id of the job attempted, or null.
 */
export declare function runStudyTick(store: StudyJobStore, deps: StudyDrainDeps): Promise<string | null>;
export interface StudyToolSet {
    searchMetaweb(args: {
        query: string;
    }): Promise<string>;
    readMetawebPin(args: {
        pinId: string;
    }): Promise<string>;
    addDocument(args: {
        title: string;
        content: string;
        pinId?: string;
    }): Promise<string>;
    learnKnowledgeBase(): Promise<string>;
}
export interface StudyLoopDeps {
    /** One LLM completion over the conversation so far; returns model text. */
    runLlm(history: Array<{
        role: 'user' | 'assistant';
        content: string;
    }>): Promise<string>;
    tools: StudyToolSet;
    maxSteps?: number;
    /** Max chars of a tool result fed back into the conversation. */
    maxResultChars?: number;
}
/**
 * The study turn as a bounded tool loop with a HARD executor-side allowlist:
 * the model proposes one json tool call per step, the executor runs it (or
 * rejects it), and only allowlisted operations ever execute. Pin budget is
 * enforced by a counting wrapper around addDocument — prompt guidance alone
 * is not a budget. Returns the final report text.
 */
export declare function runStudyTurnWithTools(prompt: string, deps: StudyLoopDeps): Promise<string>;
