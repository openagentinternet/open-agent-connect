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
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Which pipeline stage died:
 * - 'bootstrap': loading the dist modules / resolving profile state before the briefing.
 * - 'reconcile': seen-ledger reconciliation against the local chain-writes ledger.
 * - 'briefing': stage-0 deterministic digest (protocol fetches, inbox, radar).
 * - 'session': the unattended LLM tool-loop turn, including LLM resolution.
 * - 'commit': seen-ledger / watermark commits after a successful session.
 * - 'lifecycle': host lifecycle events (stale running sweep, restart recovery).
 */
export type SurfFailureStage =
  | 'bootstrap'
  | 'reconcile'
  | 'briefing'
  | 'session'
  | 'commit'
  | 'lifecycle';

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
export type SurfFailureCode =
  | 'MODULE_NOT_FOUND'
  | 'MODULE_LOAD_DENIED'
  | 'BUILD_IN_PROGRESS'
  | 'PROFILE_UNRESOLVED'
  | 'LLM_RUNTIME_UNAVAILABLE'
  | 'LLM_TURN_FAILED'
  | 'WATCHDOG_TIMEOUT'
  | 'BRIEFING_FAILED'
  | 'SESSION_FAILED'
  | 'COMMIT_FAILED'
  | 'STALE_RUNNING_SWEPT'
  | 'UNKNOWN';

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

const SURF_FAILURE_STAGES: ReadonlySet<string> = new Set([
  'bootstrap',
  'reconcile',
  'briefing',
  'session',
  'commit',
  'lifecycle',
]);

const MAX_FAILURE_STACK_CHARS = 4_000;

export const trimSurfFailureStack = (stack: string): string =>
  stack.length > MAX_FAILURE_STACK_CHARS ? `${stack.slice(0, MAX_FAILURE_STACK_CHARS)}\n…(truncated)` : stack;

/** Defensive read of a persisted failure object (old records have none). */
export function normalizeSurfRunFailure(value: unknown): SurfRunFailure | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const message = typeof record.message === 'string' && record.message ? record.message : '';
  if (!message) return null;
  const stage = typeof record.stage === 'string' && SURF_FAILURE_STAGES.has(record.stage)
    ? record.stage as SurfFailureStage
    : 'lifecycle';
  const code = typeof record.code === 'string' && record.code ? record.code : 'UNKNOWN';
  const stack = typeof record.stack === 'string' && record.stack ? record.stack : undefined;
  const context = record.context && typeof record.context === 'object' && !Array.isArray(record.context)
    ? record.context as Record<string, unknown>
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
export function classifySurfLlmFailureCode(message: string): SurfFailureCode {
  if (/No healthy LLM runtime is available/u.test(message)) return 'LLM_RUNTIME_UNAVAILABLE';
  return 'LLM_TURN_FAILED';
}

/** Generic message/stage → code classification used when no richer tag was attached. */
export function classifySurfFailureCode(message: string, stage: SurfFailureStage): SurfFailureCode {
  if (/No healthy LLM runtime is available/u.test(message)) return 'LLM_RUNTIME_UNAVAILABLE';
  if (/^LLM runtime /u.test(message)) return 'LLM_TURN_FAILED';
  if (/wall-clock budget exhausted/u.test(message)) return 'WATCHDOG_TIMEOUT';
  if (/could not resolve the profile home/u.test(message)) return 'PROFILE_UNRESOLVED';
  if (stage === 'briefing') return 'BRIEFING_FAILED';
  if (stage === 'commit') return 'COMMIT_FAILED';
  if (stage === 'session') return 'SESSION_FAILED';
  return 'UNKNOWN';
}

/** Build the persisted failure object for an error that carries no richer tag. */
export function toSurfRunFailure(
  error: unknown,
  stage: SurfFailureStage,
  context?: Record<string, unknown>,
): SurfRunFailure {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message || String(error);
  return {
    stage,
    code: classifySurfFailureCode(message, stage),
    message,
    ...(typeof err.stack === 'string' && err.stack ? { stack: trimSurfFailureStack(err.stack) } : {}),
    ...(context ? { context } : {}),
  };
}

/** Read the richer tag an inner layer attached (the surf session executor), if any. */
export function attachedSurfFailure(error: unknown): SurfRunFailure | null {
  const attached = (error as { surfFailure?: unknown } | null)?.surfFailure;
  return normalizeSurfRunFailure(attached);
}

// ---------------- bootstrap module-load classification ----------------

/**
 * Marker the atomic build writes into the LIVE dist while a replacement is
 * being compiled (scripts/build-atomic.mjs keeps the same name — scripts
 * cannot import from src). A marker younger than the max age means a build
 * is in flight right now; an older one is a crashed build's leftover.
 */
export const SURF_BUILD_MARKER_FILE = '.build-in-progress';
export const SURF_BUILD_STAMP_FILE = '.build-stamp.json';
export const SURF_BUILD_MARKER_MAX_AGE_MS = 30 * 60_000;

export type SurfBootstrapFailureCode =
  | 'MODULE_NOT_FOUND'
  | 'MODULE_LOAD_DENIED'
  | 'BUILD_IN_PROGRESS'
  | 'UNKNOWN';

/** Distinguish missing / denied / build-in-progress for a failed dynamic import. */
export function classifySurfBootstrapError(
  error: unknown,
  input: { buildInProgress: boolean },
): SurfBootstrapFailureCode {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'EPERM' || code === 'EACCES') {
    return input.buildInProgress ? 'BUILD_IN_PROGRESS' : 'MODULE_LOAD_DENIED';
  }
  if (code === 'ENOENT' || code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
    return input.buildInProgress ? 'BUILD_IN_PROGRESS' : 'MODULE_NOT_FOUND';
  }
  return 'UNKNOWN';
}

interface SurfBuildMarkerState {
  active: boolean;
  stale: boolean;
  startedAt: string | null;
  stampBuiltAt: string | null;
}

async function readBuildMarkerState(distDir: string, nowMs: number): Promise<SurfBuildMarkerState> {
  const state: SurfBuildMarkerState = { active: false, stale: false, startedAt: null, stampBuiltAt: null };
  try {
    const markerStat = await fs.stat(path.join(distDir, SURF_BUILD_MARKER_FILE));
    const ageMs = nowMs - markerStat.mtimeMs;
    if (ageMs <= SURF_BUILD_MARKER_MAX_AGE_MS) {
      state.active = true;
      try {
        const raw = JSON.parse(await fs.readFile(path.join(distDir, SURF_BUILD_MARKER_FILE), 'utf8')) as { startedAt?: unknown };
        state.startedAt = typeof raw.startedAt === 'string' ? raw.startedAt : null;
      } catch {
        // A marker without readable content still means a build is in flight.
      }
    } else {
      state.stale = true;
    }
  } catch {
    // No marker — no build in flight.
  }
  try {
    const stamp = JSON.parse(await fs.readFile(path.join(distDir, SURF_BUILD_STAMP_FILE), 'utf8')) as { builtAt?: unknown };
    state.stampBuiltAt = typeof stamp.builtAt === 'string' ? stamp.builtAt : null;
  } catch {
    // No stamp (pre-atomic-build tree) — nothing to report.
  }
  return state;
}

/** Extract the module path a failed dynamic import names in its message. */
function extractModuleTarget(message: string): string | null {
  const match = /'([^']+)'/u.exec(message) ?? /"([^"]+)"/u.exec(message);
  return match?.[1] ?? null;
}

/**
 * Tag a bootstrap dynamic-import failure with a diagnostic message and a
 * structured surfFailure (stage 'bootstrap'), distinguishing a missing file,
 * an OS-level denial, and a build currently replacing dist.
 */
export async function tagSurfBootstrapError(
  error: unknown,
  input: { distDir: string; nowMs?: number },
): Promise<Error> {
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
  const err = new Error(
    `Surf bootstrap failed while loading ${target ?? 'a dist module'}: ${hint}. Original error: ${original.message}`,
  );
  if (original.stack) err.stack = original.stack;
  let distExists = false;
  try {
    await fs.access(input.distDir);
    distExists = true;
  } catch {
    distExists = false;
  }
  (err as Error & { surfFailure?: SurfRunFailure }).surfFailure = {
    stage: 'bootstrap',
    code,
    message: err.message,
    ...(err.stack ? { stack: trimSurfFailureStack(err.stack) } : {}),
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
export const SURF_FAILURE_BACKOFF_BASE_MS = 30 * 60_000;
export const SURF_FAILURE_BACKOFF_MAX_MS = 6 * 60 * 60_000;
/** Same-code failures in a row that open the circuit. */
export const SURF_FAILURE_CIRCUIT_OPEN_THRESHOLD = 5;
/** How long an open circuit pauses pre-dream attempts (the environment gets a day to heal). */
export const SURF_FAILURE_CIRCUIT_OPEN_COOLDOWN_MS = 24 * 60 * 60_000;
/** Run rows the breaker looks back over (must cover the open threshold). */
export const SURF_CIRCUIT_HISTORY_LIMIT = 24;

/** Exponential backoff per consecutive SAME-CODE failure: 30m, 1h, 2h, 4h, capped at 6h. */
export function computeSurfFailureBackoffMs(consecutiveSameCodeFailures: number): number {
  const n = Math.max(1, Math.floor(consecutiveSameCodeFailures));
  return Math.min(SURF_FAILURE_BACKOFF_BASE_MS * 2 ** (n - 1), SURF_FAILURE_BACKOFF_MAX_MS);
}

export interface SurfCircuitRunRow {
  status: string;
  finishedAt: string | null;
  failure?: { code?: string } | null;
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

const OK_CIRCUIT: SurfCircuitState = {
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
export function computeSurfCircuitState(
  runs: readonly SurfCircuitRunRow[],
  nowMs: number,
): SurfCircuitState {
  let consecutiveFailures = 0;
  let sameCodeFailures = 0;
  let lastFailureCode: string | null = null;
  let lastFailureMs = 0;
  for (const run of runs) {
    if (run.status === 'done') break;
    if (run.status !== 'failed') continue;
    const code = typeof run.failure?.code === 'string' && run.failure.code ? run.failure.code : 'UNKNOWN';
    const finishedMs = run.finishedAt ? Date.parse(run.finishedAt) : NaN;
    if (consecutiveFailures === 0) {
      lastFailureCode = code;
      sameCodeFailures = 1;
      lastFailureMs = Number.isFinite(finishedMs) ? finishedMs : 0;
    } else if (code === lastFailureCode) {
      sameCodeFailures += 1;
      if (Number.isFinite(finishedMs) && finishedMs > lastFailureMs) lastFailureMs = finishedMs;
    }
    consecutiveFailures += 1;
  }
  if (consecutiveFailures === 0 || !lastFailureCode || !lastFailureMs) return { ...OK_CIRCUIT };
  const open = sameCodeFailures >= SURF_FAILURE_CIRCUIT_OPEN_THRESHOLD;
  const delayMs = open
    ? SURF_FAILURE_CIRCUIT_OPEN_COOLDOWN_MS
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

export interface SurfPreDreamDeferral {
  reason: 'backoff' | 'open';
  consecutiveFailures: number;
  code: string | null;
  nextAttemptAt: string | null;
}

/** Status-payload form of an active breaker; null when pre-dream surf is free to run. */
export function surfPreDreamDeferral(circuit: SurfCircuitState | null): SurfPreDreamDeferral | null {
  if (!circuit || circuit.reason === 'ok') return null;
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
export function formatSurfCircuitNotice(circuit: SurfCircuitState | null): string | null {
  const deferral = surfPreDreamDeferral(circuit);
  if (!deferral) return null;
  const when = deferral.nextAttemptAt ?? 'unknown time';
  return deferral.reason === 'open'
    ? `Pre-dream surf is PAUSED by the failure circuit breaker: ${deferral.consecutiveFailures} consecutive failures (${deferral.code ?? 'UNKNOWN'}). Next automatic attempt after ${when}, or run a manual surf to retry now.`
    : `Pre-dream surf is backing off after ${deferral.consecutiveFailures} consecutive failure(s) (${deferral.code ?? 'UNKNOWN'}). Next automatic attempt after ${when}, or run a manual surf to retry now.`;
}
