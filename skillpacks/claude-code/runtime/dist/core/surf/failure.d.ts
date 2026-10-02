/**
 * Which pipeline stage died:
 * - 'bootstrap': loading the dist modules / resolving profile state before the briefing.
 * - 'reconcile': seen-ledger reconciliation against the local chain-writes ledger.
 * - 'briefing': stage-0 deterministic digest (protocol fetches, inbox, radar).
 * - 'session': the unattended LLM tool-loop turn, including LLM resolution.
 * - 'commit': seen-ledger / watermark commits after a successful session.
 * - 'lifecycle': host lifecycle events (stale running sweep, restart recovery).
 */
export type SurfFailureStage = 'bootstrap' | 'reconcile' | 'briefing' | 'session' | 'commit' | 'lifecycle';
/**
 * Stable machine-readable failure classification:
 * - 'MODULE_NOT_FOUND': a dist module is missing (deleted or half-built tree).
 * - 'MODULE_LOAD_DENIED': EPERM/EACCES opening a dist module.
 * - 'BUILD_IN_PROGRESS': a module load raced an in-flight build (fresh build marker present).
 * - 'PROFILE_UNRESOLVED': the bot profile home could not be resolved.
 * - 'LLM_RUNTIME_UNAVAILABLE': no healthy runtime on the local CLI chain (and the host path produced nothing).
 * - 'LLM_TURN_FAILED': a resolved LLM runtime errored, timed out, or returned empty output.
 * - 'WATCHDOG_TIMEOUT': the surf wall-clock watchdog fired.
 * - 'BRIEFING_FAILED': the deterministic stage-0 digest could not complete.
 * - 'SESSION_FAILED': the session turn failed for a reason that is not LLM resolution.
 * - 'COMMIT_FAILED': post-session store commits failed.
 * - 'STALE_RUNNING_SWEPT': an orphaned 'running' row was failed by restart recovery.
 * - 'UNKNOWN': anything else.
 */
export type SurfFailureCode = 'MODULE_NOT_FOUND' | 'MODULE_LOAD_DENIED' | 'BUILD_IN_PROGRESS' | 'PROFILE_UNRESOLVED' | 'LLM_RUNTIME_UNAVAILABLE' | 'LLM_TURN_FAILED' | 'WATCHDOG_TIMEOUT' | 'BRIEFING_FAILED' | 'SESSION_FAILED' | 'COMMIT_FAILED' | 'STALE_RUNNING_SWEPT' | 'UNKNOWN';
export interface SurfRunFailure {
    stage: SurfFailureStage;
    /** Stable machine-readable classification (SurfFailureCode; string for forward compat). */
    code: string;
    message: string;
    /** Trimmed stack trace when the failure came from an Error. */
    stack?: string;
    /** Small JSON-safe diagnostics (dist state, LLM health snapshot, ...). */
    context?: Record<string, unknown>;
}
export declare const trimSurfFailureStack: (stack: string) => string;
/** Defensive read of a persisted failure object (old records have none). */
export declare function normalizeSurfRunFailure(value: unknown): SurfRunFailure | null;
/** Classify an LLM-chain error message coming out of runLlmPromptWithRuntimeFallback. */
export declare function classifySurfLlmFailureCode(message: string): SurfFailureCode;
/** Generic message/stage → code classification used when no richer tag was attached. */
export declare function classifySurfFailureCode(message: string, stage: SurfFailureStage): SurfFailureCode;
/** Build the persisted failure object for an error that carries no richer tag. */
export declare function toSurfRunFailure(error: unknown, stage: SurfFailureStage, context?: Record<string, unknown>): SurfRunFailure;
/** Read the richer tag an inner layer attached (the surf session executor), if any. */
export declare function attachedSurfFailure(error: unknown): SurfRunFailure | null;
/**
 * Marker the atomic build writes into the LIVE dist while a replacement is
 * being compiled (scripts/build-atomic.mjs keeps the same name — scripts
 * cannot import from src). A marker younger than the max age means a build
 * is in flight right now; an older one is a crashed build's leftover.
 */
export declare const SURF_BUILD_MARKER_FILE = ".build-in-progress";
export declare const SURF_BUILD_STAMP_FILE = ".build-stamp.json";
export declare const SURF_BUILD_MARKER_MAX_AGE_MS: number;
export type SurfBootstrapFailureCode = 'MODULE_NOT_FOUND' | 'MODULE_LOAD_DENIED' | 'BUILD_IN_PROGRESS' | 'UNKNOWN';
/** Distinguish missing / denied / build-in-progress for a failed dynamic import. */
export declare function classifySurfBootstrapError(error: unknown, input: {
    buildInProgress: boolean;
}): SurfBootstrapFailureCode;
/**
 * Tag a bootstrap dynamic-import failure with a diagnostic message and a
 * structured surfFailure (stage 'bootstrap'), distinguishing a missing file,
 * an OS-level denial, and a build currently replacing dist.
 */
export declare function tagSurfBootstrapError(error: unknown, input: {
    distDir: string;
    nowMs?: number;
}): Promise<Error>;
/** Base delay after the first consecutive failure (mirrors the dream retry policy). */
export declare const SURF_FAILURE_BACKOFF_BASE_MS: number;
export declare const SURF_FAILURE_BACKOFF_MAX_MS: number;
/** Same-code failures in a row that open the circuit. */
export declare const SURF_FAILURE_CIRCUIT_OPEN_THRESHOLD = 5;
/** How long an open circuit pauses pre-dream attempts (the environment gets a day to heal). */
export declare const SURF_FAILURE_CIRCUIT_OPEN_COOLDOWN_MS: number;
/** Run rows the breaker looks back over (must cover the open threshold). */
export declare const SURF_CIRCUIT_HISTORY_LIMIT = 24;
/** Exponential backoff per consecutive SAME-CODE failure: 30m, 1h, 2h, 4h, capped at 6h. */
export declare function computeSurfFailureBackoffMs(consecutiveSameCodeFailures: number): number;
export interface SurfCircuitRunRow {
    status: string;
    finishedAt: string | null;
    failure?: {
        code?: string;
    } | null;
}
export interface SurfCircuitState {
    /** 'ok' = pre-dream may run; 'backoff' = waiting out the delay; 'open' = circuit tripped (24h pause). */
    reason: 'ok' | 'backoff' | 'open';
    /** Trailing failed runs since the last done run. */
    consecutiveFailures: number;
    /** How many of those trailing failures share the newest failure's code. */
    sameCodeFailures: number;
    lastFailureCode: string | null;
    lastFailureAt: string | null;
    /** Epoch ms when the next pre-dream attempt is allowed; null when idle. */
    backoffUntilMs: number | null;
}
/**
 * Compute the breaker from run history (newest first). A `done` run resets
 * the streak; `running` rows neither count nor break it. The per-class rule
 * counts only the trailing failures that share the NEWEST failure's code, so
 * each failure class trips its own breaker.
 */
export declare function computeSurfCircuitState(runs: readonly SurfCircuitRunRow[], nowMs: number): SurfCircuitState;
export interface SurfPreDreamDeferral {
    reason: 'backoff' | 'open';
    consecutiveFailures: number;
    code: string | null;
    nextAttemptAt: string | null;
}
/** Status-payload form of an active breaker; null when pre-dream surf is free to run. */
export declare function surfPreDreamDeferral(circuit: SurfCircuitState | null): SurfPreDreamDeferral | null;
/**
 * Owner-facing notice for the formatted/chat surfaces: why the nightly surf
 * is paused and what to do (a manual surf always runs).
 */
export declare function formatSurfCircuitNotice(circuit: SurfCircuitState | null): string | null;
