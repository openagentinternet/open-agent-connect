/**
 * Daemon-side automation ticks (Codex↔DSH parity Phase 3): the nightly dream
 * tick and the chain-history summary drain for non-DSH installs.
 *
 * Both ports mirror the DSH plugin schedulers (`dsh-plugin/src/dream-scheduler.ts`,
 * `dsh-plugin/src/chain-history-summary.ts`) with one mandatory DSH-first
 * difference: while the DSH host-executor bridge is connected
 * (`isDshHostExecutorConnected()`), every tick is a complete no-op — the
 * plugin owns dreaming/summarization on DSH-open machines and the daemon must
 * never double-run. Crash safety relies on the existing stale-running sweeps
 * (dream store / surf store); no new locks are introduced here.
 *
 * Everything is serial per process and every Bot is isolated: one Bot's
 * failure is recorded on its outcome and never interrupts the pass.
 */
/** DSH-first stand-down: true while a host executor lease is live. */
export declare function isDshHostExecutorConnected(): boolean;
export interface AutomationBotRef {
    slug: string;
    homeDir: string;
    isAvailable?: boolean;
}
/** Minimal command-envelope seam so tests can fake handler groups. */
export interface AutomationCommandResult<T> {
    ok: boolean;
    data?: T;
    code?: string;
    message?: string;
}
export interface DreamTickHandlerSeams {
    /** The daemon dream handler group (`handlers.dream`). */
    dream: {
        due: (input: {
            from?: string;
        }) => Promise<AutomationCommandResult<{
            dueDates?: unknown;
            repairDates?: unknown;
        }>>;
        run: (input: {
            from?: string;
            date?: string;
            wait?: boolean;
            isRepair?: boolean;
        }) => Promise<AutomationCommandResult<{
            date?: string;
            status?: string;
            kind?: string;
            error?: string;
        }>>;
    };
    /** The daemon memory handler group (`handlers.memory`) — hygiene tail only. */
    memory: {
        hygieneDue: (input: {
            from?: string;
        }) => Promise<AutomationCommandResult<{
            due?: unknown;
            reason?: string;
        }>>;
        hygieneRun: (input: {
            from?: string;
        }) => Promise<AutomationCommandResult<Record<string, unknown>>>;
    };
    /** The daemon surf handler group (`handlers.surf`) — pre-dream gate only. */
    surf: {
        status: (input: {
            from?: string;
        }) => Promise<AutomationCommandResult<{
            preDreamDue?: unknown;
        }>>;
        run: (input: {
            from?: string;
            trigger?: 'manual-chat' | 'manual-ui' | 'pre-dream';
            wait?: boolean;
        }) => Promise<AutomationCommandResult<{
            status?: string;
            error?: string;
        }>>;
    };
}
export interface DreamTickDeps {
    listBots: () => Promise<AutomationBotRef[]>;
    /** DSH-first stand-down; while true the whole pass is a no-op. */
    isHostExecutorConnected: () => boolean;
    /** Per-profile switch `automation.dreamTickEnabled` (default true). */
    isTickEnabled: (homeDir: string) => Promise<boolean>;
    /** Per-Bot memory policy `dreamEnabled` (default enabled). */
    isDreamPolicyEnabled: (homeDir: string) => Promise<boolean>;
    handlers: DreamTickHandlerSeams;
    log?: (message: string) => void;
}
export interface DreamTickBotOutcome {
    slug: string;
    dreamed: string[];
    /** Set when the Bot was passed over without attempting a dream. */
    skipped?: string;
    error?: string;
    surfRan?: boolean;
    surfError?: string;
    surfSkipped?: string;
    hygieneRan?: boolean;
    hygieneError?: string;
    hygieneSkipped?: string;
}
/**
 * One dream-tick pass over every Bot, mirroring the plugin scheduler:
 * availability toggle-off skips everything → per-Bot config switch → per-Bot
 * `dreamEnabled` policy → `dream due` → (when anything is due) pre-dream surf
 * gate → one run per due date + at most one repair date → hygiene tail for
 * every Bot that was not fully skipped. The due-date algorithm owns
 * catch-up; this pass stays dumb.
 */
export declare function runDreamAutomationTick(deps: DreamTickDeps): Promise<DreamTickBotOutcome[]>;
export declare const CHAIN_HISTORY_SUMMARY_DEFAULT_PER_TICK = 10;
export declare const CHAIN_HISTORY_SUMMARY_DEFAULT_DAILY_CAP = 40;
/** Summaries are short; a 60s budget is generous even for a slow runtime. */
export declare const CHAIN_HISTORY_SUMMARY_LLM_TIMEOUT_MS = 60000;
/** Stored summaries are capped so a chatty model cannot bloat the ledger. */
export declare const CHAIN_HISTORY_SUMMARY_MAX_CHARS = 500;
export interface ChainHistorySummaryItemInput {
    kind: 'write' | 'read';
    /** Read records carry the pin title; write records pass null. */
    title: string | null;
    path: string | null;
    /** Truncated stored text: contentText for writes, contentExcerpt for reads. */
    content: string;
}
/** Port of the plugin prompt builder (`dsh-plugin/src/chain-history-summary.ts`). */
export declare function buildChainHistorySummaryPrompt(input: ChainHistorySummaryItemInput): {
    system: string;
    user: string;
};
/** Store seam over `createChainHistoryStore` (per-profile instance). */
export interface ChainHistoryTickStore {
    listPendingSummaries(kind: 'write' | 'read', limit?: number): Promise<Array<{
        record: object;
    }>>;
    applySummaryOutcome(kind: 'write' | 'read', pinId: string, outcome: {
        status: 'done';
        summary: string;
    } | {
        status: 'failed';
    }): Promise<boolean>;
    countSummariesSince(kind: 'write' | 'read' | null, sinceMs: number): Promise<number>;
}
export interface ChainHistorySummaryTickDeps {
    listBots: () => Promise<AutomationBotRef[]>;
    /** DSH-first stand-down; while true the whole pass is a no-op. */
    isHostExecutorConnected: () => boolean;
    /** Per-profile switch `automation.chainHistorySummaryEnabled` (default true). */
    isTickEnabled: (homeDir: string) => Promise<boolean>;
    /** LLM summarization through the unified passive chain (DSH pair first via
     *  the host-executor bridge, then the local runtime fallback). Implementations
     *  resolve with the trimmed summary; throwing marks the attempt failed. */
    summarize: (input: ChainHistorySummaryItemInput & {
        slug: string;
        homeDir: string;
    }) => Promise<string>;
    storeFor: (homeDir: string) => ChainHistoryTickStore;
    /** Global per-tick summary budget across all Bots (default 10). */
    perTick?: number;
    /** Per-Bot daily summary budget, both kinds combined (default 40). */
    dailyCap?: number;
    log?: (message: string) => void;
    now?: () => Date;
}
export interface ChainHistorySummaryBotOutcome {
    slug: string;
    done: number;
    failed: number;
    /** Set when the Bot was passed over without attempting a summary. */
    skipped?: string;
    error?: string;
}
/**
 * One drain pass over every Bot: fetch pending candidates (writes first, then
 * reads, oldest first — `chainhistory summary pending` parity), then
 * summarize + apply serially until the global per-tick budget or the Bot's
 * remaining daily budget runs out. One item's failure is recorded on that
 * record (outcome failed) and never interrupts the batch.
 */
export declare function runChainHistorySummaryTick(deps: ChainHistorySummaryTickDeps): Promise<ChainHistorySummaryBotOutcome[]>;
/** Surface one dream-tick pass on the log (silent when nothing happened). */
export declare function reportDreamTickOutcomes(outcomes: DreamTickBotOutcome[], log: (message: string) => void): void;
/** Surface one chain-history drain pass on the log (silent when idle). */
export declare function reportChainHistorySummaryTickOutcomes(outcomes: ChainHistorySummaryBotOutcome[], log: (message: string) => void): void;
export interface AutomationTickLoop {
    /** Fire one pass; a no-op while a previous pass is still running. */
    tick(): void;
    /** Clear the interval and the pending boot pass. */
    stop(): void;
    /** True while a pass is in flight (re-entry guard state). */
    readonly running: boolean;
}
export interface AutomationTickLoopOptions {
    tickMs: number;
    /** One pass shortly after start so catch-up/deferred work runs immediately. */
    bootDelayMs: number;
    log?: (message: string) => void;
    /** Timer seams for tests; default to the real globals. */
    setIntervalFn?: typeof setInterval;
    setTimeoutFn?: typeof setTimeout;
    clearIntervalFn?: typeof clearInterval;
    clearTimeoutFn?: typeof clearTimeout;
}
/**
 * Interval + boot-pass lifecycle shared by the automation ticks: serial per
 * process (a tick already running is skipped), unref'd so the timers never
 * keep the daemon process alive, and failures land on the log, never throw.
 */
export declare function startAutomationTickLoop(pass: () => Promise<unknown>, options: AutomationTickLoopOptions): AutomationTickLoop;
