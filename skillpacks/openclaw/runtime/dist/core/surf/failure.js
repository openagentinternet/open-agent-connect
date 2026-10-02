"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SURF_CIRCUIT_HISTORY_LIMIT = exports.SURF_FAILURE_CIRCUIT_OPEN_COOLDOWN_MS = exports.SURF_FAILURE_CIRCUIT_OPEN_THRESHOLD = exports.SURF_FAILURE_BACKOFF_MAX_MS = exports.SURF_FAILURE_BACKOFF_BASE_MS = exports.SURF_BUILD_MARKER_MAX_AGE_MS = exports.SURF_BUILD_STAMP_FILE = exports.SURF_BUILD_MARKER_FILE = exports.trimSurfFailureStack = void 0;
exports.normalizeSurfRunFailure = normalizeSurfRunFailure;
exports.classifySurfLlmFailureCode = classifySurfLlmFailureCode;
exports.classifySurfFailureCode = classifySurfFailureCode;
exports.toSurfRunFailure = toSurfRunFailure;
exports.attachedSurfFailure = attachedSurfFailure;
exports.classifySurfBootstrapError = classifySurfBootstrapError;
exports.tagSurfBootstrapError = tagSurfBootstrapError;
exports.computeSurfFailureBackoffMs = computeSurfFailureBackoffMs;
exports.computeSurfCircuitState = computeSurfCircuitState;
exports.surfPreDreamDeferral = surfPreDreamDeferral;
exports.formatSurfCircuitNotice = formatSurfCircuitNotice;
/**
 * Surf run failure taxonomy + pre-dream retry policy.
 *
 * A failed run record carries a structured `failure` object (stage / code /
 * stack / context) instead of only a bare error string, so a problem
 * explains itself without reverse-engineering run durations:
 *
 * - stage: which pipeline stage died (bootstrap module load, deterministic
 *   briefing, the LLM session, the post-session commits, or host lifecycle).
 * - code: a stable machine-readable classification (module missing vs denied
 *   vs a build in flight, LLM runtime unavailable, watchdog, ...).
 * - context: small JSON-safe diagnostics (dist state for bootstrap failures,
 *   LLM host-path/local-runtime health for session failures).
 *
 * The retry policy (exponential backoff + a per-class circuit breaker) is
 * COMPUTED from the run history — no extra persistence: the pre-dream gate
 * consults it so a deterministic environment failure (no healthy LLM, a dist
 * being rebuilt) backs off instead of re-colliding every dream tick, and a
 * streak of same-code failures opens the circuit for a day. Manual triggers
 * always run — owner intent overrides the breaker.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const SURF_FAILURE_STAGES = new Set([
    'bootstrap',
    'reconcile',
    'briefing',
    'session',
    'commit',
    'lifecycle',
]);
const MAX_FAILURE_STACK_CHARS = 4_000;
const trimSurfFailureStack = (stack) => stack.length > MAX_FAILURE_STACK_CHARS ? `${stack.slice(0, MAX_FAILURE_STACK_CHARS)}\n…(truncated)` : stack;
exports.trimSurfFailureStack = trimSurfFailureStack;
/** Defensive read of a persisted failure object (old records have none). */
function normalizeSurfRunFailure(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const message = typeof record.message === 'string' && record.message ? record.message : '';
    if (!message)
        return null;
    const stage = typeof record.stage === 'string' && SURF_FAILURE_STAGES.has(record.stage)
        ? record.stage
        : 'lifecycle';
    const code = typeof record.code === 'string' && record.code ? record.code : 'UNKNOWN';
    const stack = typeof record.stack === 'string' && record.stack ? record.stack : undefined;
    const context = record.context && typeof record.context === 'object' && !Array.isArray(record.context)
        ? record.context
        : undefined;
    return {
        stage,
        code,
        message,
        ...(stack ? { stack } : {}),
        ...(context ? { context } : {}),
    };
}
/** Classify an LLM-chain error message coming out of runLlmPromptWithRuntimeFallback. */
function classifySurfLlmFailureCode(message) {
    if (/No healthy LLM runtime is available/u.test(message))
        return 'LLM_RUNTIME_UNAVAILABLE';
    return 'LLM_TURN_FAILED';
}
/** Generic message/stage → code classification used when no richer tag was attached. */
function classifySurfFailureCode(message, stage) {
    if (/No healthy LLM runtime is available/u.test(message))
        return 'LLM_RUNTIME_UNAVAILABLE';
    if (/^LLM runtime /u.test(message))
        return 'LLM_TURN_FAILED';
    if (/wall-clock budget exhausted/u.test(message))
        return 'WATCHDOG_TIMEOUT';
    if (/could not resolve the profile home/u.test(message))
        return 'PROFILE_UNRESOLVED';
    if (stage === 'briefing')
        return 'BRIEFING_FAILED';
    if (stage === 'commit')
        return 'COMMIT_FAILED';
    if (stage === 'session')
        return 'SESSION_FAILED';
    return 'UNKNOWN';
}
/** Build the persisted failure object for an error that carries no richer tag. */
function toSurfRunFailure(error, stage, context) {
    const err = error instanceof Error ? error : new Error(String(error));
    const message = err.message || String(error);
    return {
        stage,
        code: classifySurfFailureCode(message, stage),
        message,
        ...(typeof err.stack === 'string' && err.stack ? { stack: (0, exports.trimSurfFailureStack)(err.stack) } : {}),
        ...(context ? { context } : {}),
    };
}
/** Read the richer tag an inner layer attached (the surf session executor), if any. */
function attachedSurfFailure(error) {
    const attached = error?.surfFailure;
    return normalizeSurfRunFailure(attached);
}
// ---------------- bootstrap module-load classification ----------------
/**
 * Marker the atomic build writes into the LIVE dist while a replacement is
 * being compiled (scripts/build-atomic.mjs keeps the same name — scripts
 * cannot import from src). A marker younger than the max age means a build
 * is in flight right now; an older one is a crashed build's leftover.
 */
exports.SURF_BUILD_MARKER_FILE = '.build-in-progress';
exports.SURF_BUILD_STAMP_FILE = '.build-stamp.json';
exports.SURF_BUILD_MARKER_MAX_AGE_MS = 30 * 60_000;
/** Distinguish missing / denied / build-in-progress for a failed dynamic import. */
function classifySurfBootstrapError(error, input) {
    const code = error?.code;
    if (code === 'EPERM' || code === 'EACCES') {
        return input.buildInProgress ? 'BUILD_IN_PROGRESS' : 'MODULE_LOAD_DENIED';
    }
    if (code === 'ENOENT' || code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
        return input.buildInProgress ? 'BUILD_IN_PROGRESS' : 'MODULE_NOT_FOUND';
    }
    return 'UNKNOWN';
}
async function readBuildMarkerState(distDir, nowMs) {
    const state = { active: false, stale: false, startedAt: null, stampBuiltAt: null };
    try {
        const markerStat = await node_fs_1.promises.stat(node_path_1.default.join(distDir, exports.SURF_BUILD_MARKER_FILE));
        const ageMs = nowMs - markerStat.mtimeMs;
        if (ageMs <= exports.SURF_BUILD_MARKER_MAX_AGE_MS) {
            state.active = true;
            try {
                const raw = JSON.parse(await node_fs_1.promises.readFile(node_path_1.default.join(distDir, exports.SURF_BUILD_MARKER_FILE), 'utf8'));
                state.startedAt = typeof raw.startedAt === 'string' ? raw.startedAt : null;
            }
            catch {
                // A marker without readable content still means a build is in flight.
            }
        }
        else {
            state.stale = true;
        }
    }
    catch {
        // No marker — no build in flight.
    }
    try {
        const stamp = JSON.parse(await node_fs_1.promises.readFile(node_path_1.default.join(distDir, exports.SURF_BUILD_STAMP_FILE), 'utf8'));
        state.stampBuiltAt = typeof stamp.builtAt === 'string' ? stamp.builtAt : null;
    }
    catch {
        // No stamp (pre-atomic-build tree) — nothing to report.
    }
    return state;
}
/** Extract the module path a failed dynamic import names in its message. */
function extractModuleTarget(message) {
    const match = /'([^']+)'/u.exec(message) ?? /"([^"]+)"/u.exec(message);
    return match?.[1] ?? null;
}
/**
 * Tag a bootstrap dynamic-import failure with a diagnostic message and a
 * structured surfFailure (stage 'bootstrap'), distinguishing a missing file,
 * an OS-level denial, and a build currently replacing dist.
 */
async function tagSurfBootstrapError(error, input) {
    const original = error instanceof Error ? error : new Error(String(error));
    const nowMs = input.nowMs ?? Date.now();
    const marker = await readBuildMarkerState(input.distDir, nowMs);
    const code = classifySurfBootstrapError(original, { buildInProgress: marker.active });
    const target = extractModuleTarget(original.message);
    const hint = code === 'BUILD_IN_PROGRESS'
        ? 'a build is currently replacing dist — the run should be retried after the build finishes'
        : code === 'MODULE_LOAD_DENIED'
            ? 'the OS refused to open it (sandbox/TCC context or a concurrent replace)'
            : code === 'MODULE_NOT_FOUND'
                ? 'the file is missing (dist incomplete or deleted)'
                : 'unclassified module-load failure';
    const err = new Error(`Surf bootstrap failed while loading ${target ?? 'a dist module'}: ${hint}. Original error: ${original.message}`);
    if (original.stack)
        err.stack = original.stack;
    let distExists = false;
    try {
        await node_fs_1.promises.access(input.distDir);
        distExists = true;
    }
    catch {
        distExists = false;
    }
    err.surfFailure = {
        stage: 'bootstrap',
        code,
        message: err.message,
        ...(err.stack ? { stack: (0, exports.trimSurfFailureStack)(err.stack) } : {}),
        context: {
            ...(target ? { module: target } : {}),
            originalMessage: original.message,
            dist: {
                dir: input.distDir,
                exists: distExists,
                buildInProgress: marker.active,
                ...(marker.stale ? { staleBuildMarker: true } : {}),
                ...(marker.startedAt ? { buildStartedAt: marker.startedAt } : {}),
                ...(marker.stampBuiltAt ? { lastBuildAt: marker.stampBuiltAt } : {}),
            },
        },
    };
    return err;
}
// ---------------- pre-dream retry policy (backoff + circuit breaker) ----------------
/** Base delay after the first consecutive failure (mirrors the dream retry policy). */
exports.SURF_FAILURE_BACKOFF_BASE_MS = 30 * 60_000;
exports.SURF_FAILURE_BACKOFF_MAX_MS = 6 * 60 * 60_000;
/** Same-code failures in a row that open the circuit. */
exports.SURF_FAILURE_CIRCUIT_OPEN_THRESHOLD = 5;
/** How long an open circuit pauses pre-dream attempts (the environment gets a day to heal). */
exports.SURF_FAILURE_CIRCUIT_OPEN_COOLDOWN_MS = 24 * 60 * 60_000;
/** Run rows the breaker looks back over (must cover the open threshold). */
exports.SURF_CIRCUIT_HISTORY_LIMIT = 24;
/** Exponential backoff per consecutive SAME-CODE failure: 30m, 1h, 2h, 4h, capped at 6h. */
function computeSurfFailureBackoffMs(consecutiveSameCodeFailures) {
    const n = Math.max(1, Math.floor(consecutiveSameCodeFailures));
    return Math.min(exports.SURF_FAILURE_BACKOFF_BASE_MS * 2 ** (n - 1), exports.SURF_FAILURE_BACKOFF_MAX_MS);
}
const OK_CIRCUIT = {
    reason: 'ok',
    consecutiveFailures: 0,
    sameCodeFailures: 0,
    lastFailureCode: null,
    lastFailureAt: null,
    backoffUntilMs: null,
};
/**
 * Compute the breaker from run history (newest first). A `done` run resets
 * the streak; `running` rows neither count nor break it. The per-class rule
 * counts only the trailing failures that share the NEWEST failure's code, so
 * each failure class trips its own breaker.
 */
function computeSurfCircuitState(runs, nowMs) {
    let consecutiveFailures = 0;
    let sameCodeFailures = 0;
    let lastFailureCode = null;
    let lastFailureMs = 0;
    for (const run of runs) {
        if (run.status === 'done')
            break;
        if (run.status !== 'failed')
            continue;
        const code = typeof run.failure?.code === 'string' && run.failure.code ? run.failure.code : 'UNKNOWN';
        const finishedMs = run.finishedAt ? Date.parse(run.finishedAt) : NaN;
        if (consecutiveFailures === 0) {
            lastFailureCode = code;
            sameCodeFailures = 1;
            lastFailureMs = Number.isFinite(finishedMs) ? finishedMs : 0;
        }
        else if (code === lastFailureCode) {
            sameCodeFailures += 1;
            if (Number.isFinite(finishedMs) && finishedMs > lastFailureMs)
                lastFailureMs = finishedMs;
        }
        consecutiveFailures += 1;
    }
    if (consecutiveFailures === 0 || !lastFailureCode || !lastFailureMs)
        return { ...OK_CIRCUIT };
    const open = sameCodeFailures >= exports.SURF_FAILURE_CIRCUIT_OPEN_THRESHOLD;
    const delayMs = open
        ? exports.SURF_FAILURE_CIRCUIT_OPEN_COOLDOWN_MS
        : computeSurfFailureBackoffMs(sameCodeFailures);
    const backoffUntilMs = lastFailureMs + delayMs;
    return {
        reason: nowMs < backoffUntilMs ? (open ? 'open' : 'backoff') : 'ok',
        consecutiveFailures,
        sameCodeFailures,
        lastFailureCode,
        lastFailureAt: new Date(lastFailureMs).toISOString(),
        backoffUntilMs,
    };
}
/** Status-payload form of an active breaker; null when pre-dream surf is free to run. */
function surfPreDreamDeferral(circuit) {
    if (!circuit || circuit.reason === 'ok')
        return null;
    return {
        reason: circuit.reason,
        consecutiveFailures: circuit.consecutiveFailures,
        code: circuit.lastFailureCode,
        nextAttemptAt: circuit.backoffUntilMs ? new Date(circuit.backoffUntilMs).toISOString() : null,
    };
}
/**
 * Owner-facing notice for the formatted/chat surfaces: why the nightly surf
 * is paused and what to do (a manual surf always runs).
 */
function formatSurfCircuitNotice(circuit) {
    const deferral = surfPreDreamDeferral(circuit);
    if (!deferral)
        return null;
    const when = deferral.nextAttemptAt ?? 'unknown time';
    return deferral.reason === 'open'
        ? `Pre-dream surf is PAUSED by the failure circuit breaker: ${deferral.consecutiveFailures} consecutive failures (${deferral.code ?? 'UNKNOWN'}). Next automatic attempt after ${when}, or run a manual surf to retry now.`
        : `Pre-dream surf is backing off after ${deferral.consecutiveFailures} consecutive failure(s) (${deferral.code ?? 'UNKNOWN'}). Next automatic attempt after ${when}, or run a manual surf to retry now.`;
}
