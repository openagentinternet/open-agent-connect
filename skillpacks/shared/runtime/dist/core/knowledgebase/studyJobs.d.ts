/**
 * Autonomous study jobs (IDBots M4 parity, scoped to OAC's plain-LLM engine):
 * owner-assigned MetaWeb topics drained nightly into the bot's knowledge
 * base. Queue state only — the learned content lives in the KBs. The drain
 * itself runs through the study prompt the daemon hands its LLM runner with
 * the tool allowlist applied by the caller (no skill turns on OAC).
 */
import type { MetabotPaths } from '../state/paths';
export declare const DEFAULT_STUDY_PIN_BUDGET_PER_NIGHT = 50;
export declare const MAX_STUDY_RUNS_PER_JOB = 10;
export declare const MAX_STUDY_CONSECUTIVE_FAILURES = 3;
/**
 * Tool-step cap for one nightly study turn (topic jobs). Hitting the cap does
 * not fail the run: the loop takes one final no-tools report turn and marks
 * the result partial (same graceful degradation as the surf loop).
 */
export declare const STUDY_TURN_MAX_TOOL_STEPS = 12;
/** Tool-step cap for one nightly Q&A-surf turn (surf sessions page feeds and answer questions). */
export declare const QA_SURF_TURN_MAX_TOOL_STEPS = 24;
/**
 * Wall-clock watchdog for one study turn (#13): the step caps alone bound a
 * turn at steps × per-call LLM timeout (up to 6-12 h worst case), so one slow
 * runtime could hold the nightly tick — and with it every other Bot's drain —
 * for the whole window. A turn exceeding this budget breaks out to the same
 * no-tools final-report turn as the step ceiling (marked partial). IDBots
 * bounds its study sessions at 30 minutes; 35 gives the loop one extra
 * margin, mirroring the surf watchdog's ballpark.
 */
export declare const STUDY_TURN_WALL_CLOCK_MS: number;
/**
 * Wall-clock budget for one nightly study tick (#13): the per-profile loop
 * stops after this long and the remaining profiles rotate to the head of the
 * next tick (see rotateForTick), so a slow first Bot can never systematically
 * starve the tail of the list. Bounds one tick at ~3 study turns.
 */
export declare const STUDY_TICK_BUDGET_MS: number;
/** Nightly drain window, local hours [0, 6). */
export declare const STUDY_WINDOW: {
    readonly startHour: 0;
    readonly endHour: 6;
};
export declare const STUDY_TICK_INTERVAL_MINUTES = 30;
/** Default nightly budget for a recurring Q&A-surf job (pins handled: answered or saved). */
export declare const DEFAULT_QA_SURF_BUDGET_PER_NIGHT = 10;
export type StudyJobStatus = 'pending' | 'running' | 'done' | 'failed';
export type StudyJobKind = 'topic' | 'qa-surf';
export interface StudyJobRecord {
    id: string;
    metabotSlug: string;
    /** 'topic' = owner-assigned study topic (spans nights, completes); 'qa-surf' = recurring nightly Q&A surfing. */
    kind: StudyJobKind;
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
    enqueueQaSurfJob(input: {
        metabotSlug: string;
        budgetPins?: number;
    }): Promise<{
        job: StudyJobRecord;
        created: boolean;
    }>;
    disableQaSurfJob(metabotSlug: string, summary?: string): Promise<boolean>;
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
    /**
     * Requeue one FAILED job (owner/tool-initiated retry): back to pending with
     * the failure counters cleared, so the next nightly window drains it again.
     * `retried: false` when the job exists but is not failed.
     */
    retryStudyJob(id: string): Promise<{
        job: StudyJobRecord;
        retried: boolean;
    } | null>;
    /**
     * Requeue stale `running` rows (crash recovery). Rows whose id is in
     * `excludeIds` (runs currently executing in this process) stay untouched;
     * everything else goes back to pending. Returns the number of rows changed.
     */
    resetRunningToPending(now: number, options?: {
        excludeIds?: string[];
    }): Promise<number>;
}
export declare function createStudyJobStore(paths: MetabotPaths): StudyJobStore;
/** True inside the nightly drain window (local hours 0-6). */
export declare function inStudyWindow(now: Date): boolean;
/**
 * Retire a bot's active qa-surf jobs when MetaWeb surf is enabled for it
 * (IDBots 0.9.1 migration semantics): Q&A browsing now happens inside the
 * nightly surf run, so the legacy recurring job is marked done instead of
 * double-spending the night. Idempotent — done/failed jobs stay untouched.
 */
export declare function retireQaSurfJobsForSurf(store: StudyJobStore, metabotSlug: string): Promise<boolean>;
/** The unattended study prompt (IDBots parity, tool-allowlist note included). */
export declare function buildStudySessionPrompt(input: {
    topic: string;
    budgetPins: number;
}): string;
/**
 * The unattended nightly Q&A surfing prompt (job kind 'qa-surf', IDBots
 * feat/metaweb-qa parity, rebuilt for OAC's json-fence tool loop): browse the
 * on-chain Q&A, answer what fits the bot's persona, save what its role should
 * keep, react honestly. Same final-report contract as topic study.
 */
export declare function buildQaSurfSessionPrompt(job: Pick<StudyJobRecord, 'processedPinIds' | 'budgetPins'>): string;
/**
 * Parse the study run report: the LAST json fence wins; a prose-only reply
 * throws (the job fails rather than guessing). The executor loop hands back
 * the normalized report as bare JSON while the model's raw reply carries a
 * fence, so both shapes are accepted.
 */
export declare function parseStudyRunReport(reply: string): {
    processedPinIds: string[];
    summary: string;
};
export interface StudyDrainDeps {
    /** Runs one unattended study turn: prompt in, final report out. */
    runStudyTurn(input: {
        slug: string;
        kind?: StudyJobKind;
        prompt: string;
        budgetPins: number;
    }): Promise<string>;
    now?: () => number;
    log?: (message: string) => void;
}
/**
 * One study tick: drain the oldest pending job inside the nightly window.
 * Crash recovery re-arms stale `running` rows FIRST — before the window
 * gate, so a run a daemon restart killed mid-flight never sits in `running`
 * until the next night (~18h of wrong status); only rows not executing in
 * this process are swept. Returns the id of the job attempted, or null.
 */
export declare function runStudyTick(store: StudyJobStore, deps: StudyDrainDeps): Promise<string | null>;
export declare class StudyRunError extends Error {
    readonly code: 'study_job_not_found' | 'study_job_already_running' | 'no_pending_study_job';
    constructor(code: 'study_job_not_found' | 'study_job_already_running' | 'no_pending_study_job', message: string);
}
/**
 * Resolve the job a manual run should execute, NOW, regardless of the
 * nightly window (the daylight-testing surface behind `metabot
 * knowledge-base study run` and the `metaweb_study_run` tool). Selection:
 * an explicit jobId wins (any status except running); else the first job
 * whose topic contains `topic` (case-insensitive substring, like retry),
 * preferring pending over failed over done; else the oldest pending job.
 * A FAILED job is requeued first (a manual run implies retry); a DONE job
 * re-runs honestly. Crash recovery sweeps stale `running` rows (excluding
 * runs executing in this process) before selection. Throws StudyRunError
 * when nothing is runnable.
 */
export declare function resolveStudyJobForRun(store: StudyJobStore, selector?: {
    metabotSlug?: string;
    jobId?: string;
    topic?: string;
}): Promise<StudyJobRecord>;
/**
 * Claim and execute one resolved job; resolves when the run settles (safe
 * to `void` for fire-and-forget manual runs — the job row is the state).
 */
export declare function startStudyJobRun(store: StudyJobStore, deps: StudyDrainDeps, job: StudyJobRecord): Promise<StudyJobRecord>;
/** Convenience: resolve + run to completion (tests, CLI --wait flows). */
export declare function runStudyJobNow(store: StudyJobStore, deps: StudyDrainDeps, selector?: {
    metabotSlug?: string;
    jobId?: string;
    topic?: string;
}): Promise<StudyJobRecord>;
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
    listKnowledgeBases(): Promise<string>;
    queryKnowledgeBases(args: {
        query: string;
        knowledgeBaseId?: string;
    }): Promise<string>;
    saveProcedure(args: {
        title: string;
        steps: string[];
        pitfalls?: string[];
        triggerText?: string;
        sourcePinIds?: string[];
    }): Promise<string>;
    recallProcedures(args: {
        query: string;
    }): Promise<string>;
    upsertKnowledge(args: {
        topic: string;
        summary: string;
        kind?: string;
    }): Promise<string>;
    recallKnowledge(args: {
        query?: string;
        kind?: string;
    }): Promise<string>;
    /** Q&A recall + write seam for qa-surf jobs (optional: topic jobs never call these). */
    searchQa?(args: {
        query: string;
        tags?: string[];
        answered?: boolean;
        sort?: string;
        size?: number;
        cursor?: string;
    }): Promise<string>;
    listLatestQuestions?(args: {
        tags?: string[];
        minAnswers?: number;
        maxAnswers?: number;
        sort?: string;
        size?: number;
        cursor?: string;
    }): Promise<string>;
    getQuestionAnswers?(args: {
        questionPinId: string;
        publisher?: string;
        size?: number;
        cursor?: string;
    }): Promise<string>;
    postSimpleAnswer?(args: {
        answerTo: string;
        content: string;
        tags?: string[];
    }): Promise<string>;
    likePin?(args: {
        pinId: string;
        isLike: number;
    }): Promise<string>;
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
    /** 'qa-surf' selects the Q&A surfing allowlist (default: the topic set). */
    kind?: StudyJobKind;
    /**
     * Wall-clock watchdog for the whole turn (#13). When the budget is spent
     * the loop stops starting new steps and takes the no-tools final-report
     * path (marked partial). Default STUDY_TURN_WALL_CLOCK_MS.
     */
    wallClockMs?: number;
}
/**
 * The study turn as a bounded tool loop with a HARD executor-side allowlist:
 * the model proposes one json tool call per step, the executor runs it (or
 * rejects it), and only allowlisted operations ever execute. Pin budget is
 * enforced by a counting wrapper around addDocument — prompt guidance alone
 * is not a budget. Returns the final report text; hitting the step cap OR the
 * wall-clock watchdog takes one final no-tools report turn (marked partial)
 * instead of failing the run.
 */
export declare function runStudyTurnWithTools(prompt: string, deps: StudyLoopDeps): Promise<string>;
/**
 * Rotate the profile list so a tick starts at `startIndex` and wraps around
 * (#13): with a tick budget cutting the loop short, the profiles that missed
 * out begin the NEXT tick instead of always sitting at the tail of the list.
 */
export declare function rotateForTick<T>(items: T[], startIndex: number): T[];
/**
 * Conservative pre-flight gate for the nightly study drain (#13): skip a
 * profile only when it has NO usable LLM at all — no DSH pair (and no host
 * executor connected to serve it) AND no local runtime row that is not
 * marked unavailable. Uncertain cases run and rely on the turn watchdog /
 * per-call timeouts, so the gate can never silently disable a Bot that would
 * have studied fine. Without the gate such a Bot burns its per-call timeout
 * at the front of the queue every night until 3-strikes parks the job.
 */
export declare function profileHasStudyLlm(input: {
    dshPairConfigured: boolean;
    connectedExecutors: number;
    runtimes: Array<{
        health?: string;
    }>;
}): boolean;
