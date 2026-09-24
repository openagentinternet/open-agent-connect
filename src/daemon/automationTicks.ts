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

import { getActiveHostLlmExecutorBridge } from '../core/llm/hostLlmExecutorBridge';

/** DSH-first stand-down: true while a host executor lease is live. */
export function isDshHostExecutorConnected(): boolean {
  return (getActiveHostLlmExecutorBridge()?.connectedExecutors() ?? 0) > 0;
}

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
    due: (input: { from?: string }) => Promise<AutomationCommandResult<{ dueDates?: unknown; repairDates?: unknown }>>;
    run: (input: {
      from?: string;
      date?: string;
      wait?: boolean;
      isRepair?: boolean;
    }) => Promise<AutomationCommandResult<{ date?: string; status?: string; kind?: string; error?: string }>>;
  };
  /** The daemon memory handler group (`handlers.memory`) — hygiene tail only. */
  memory: {
    hygieneDue: (input: { from?: string }) => Promise<AutomationCommandResult<{ due?: unknown; reason?: string }>>;
    hygieneRun: (input: { from?: string }) => Promise<AutomationCommandResult<Record<string, unknown>>>;
  };
  /** The daemon surf handler group (`handlers.surf`) — pre-dream gate only. */
  surf: {
    status: (input: { from?: string }) => Promise<AutomationCommandResult<{ preDreamDue?: unknown }>>;
    run: (input: {
      from?: string;
      trigger?: 'manual-chat' | 'manual-ui' | 'pre-dream';
      wait?: boolean;
    }) => Promise<AutomationCommandResult<{ status?: string; error?: string }>>;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readDateList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

/**
 * One dream-tick pass over every Bot, mirroring the plugin scheduler:
 * availability toggle-off skips everything → per-Bot config switch → per-Bot
 * `dreamEnabled` policy → `dream due` → (when anything is due) pre-dream surf
 * gate → one run per due date + at most one repair date → hygiene tail for
 * every Bot that was not fully skipped. The due-date algorithm owns
 * catch-up; this pass stays dumb.
 */
export async function runDreamAutomationTick(deps: DreamTickDeps): Promise<DreamTickBotOutcome[]> {
  const outcomes: DreamTickBotOutcome[] = [];
  if (deps.isHostExecutorConnected()) {
    // Stand-down: DSH owns the dream while its host executor is connected.
    return outcomes;
  }
  // Toggle-off Bots (Settings availability switch) and config-off Bots run
  // neither dreams nor memory hygiene — fully hands-off for this pass.
  const handsOffSlugs = new Set<string>();
  let profiles: AutomationBotRef[];
  try {
    profiles = await deps.listBots();
  } catch (error) {
    deps.log?.(`[DreamTick] bot list failed: ${errorMessage(error)}`);
    return outcomes;
  }
  for (const profile of profiles) {
    const slug = typeof profile.slug === 'string' ? profile.slug : '';
    if (!slug) continue;
    const outcome: DreamTickBotOutcome = { slug, dreamed: [] };
    outcomes.push(outcome);
    try {
      if (profile.isAvailable === false) {
        handsOffSlugs.add(slug);
        outcome.skipped = 'bot unavailable (availability toggle off)';
        continue;
      }
      if (!await deps.isTickEnabled(profile.homeDir)) {
        handsOffSlugs.add(slug);
        outcome.skipped = 'automation.dreamTickEnabled=false';
        continue;
      }
      if (!await deps.isDreamPolicyEnabled(profile.homeDir)) {
        outcome.skipped = 'dream disabled by memory policy';
        continue;
      }
      const due = await deps.handlers.dream.due({ from: slug });
      if (!due.ok) {
        outcome.error = due.message ?? due.code ?? 'dream due failed';
        continue;
      }
      const dueDates = readDateList(due.data?.dueDates);
      const repairDates = readDateList(due.data?.repairDates);
      // At most one version-repair per pass (IDBots nightly cap).
      const repairDate = repairDates[0];
      if (dueDates.length === 0 && !repairDate) {
        outcome.skipped = 'no due dates';
        continue;
      }
      // Pre-dream surf gate: one unattended surf BEFORE the dream when
      // `surf status` reports preDreamDue (per-Bot opt-in + recency + memory
      // gates live daemon-side). A surf failure never fails the dream.
      try {
        const surfStatus = await deps.handlers.surf.status({ from: slug });
        if (surfStatus.ok && surfStatus.data?.preDreamDue === true) {
          const surfRun = await deps.handlers.surf.run({ from: slug, trigger: 'pre-dream', wait: true });
          if (surfRun.ok) {
            outcome.surfRan = true;
            if (surfRun.data?.status === 'failed') {
              outcome.surfError = surfRun.data.error ?? 'pre-dream surf run failed';
            }
          } else {
            outcome.surfError = surfRun.message ?? surfRun.code ?? 'pre-dream surf failed';
          }
        } else {
          outcome.surfSkipped = 'not due (off / recent / memory off / running)';
        }
      } catch (error) {
        outcome.surfError = errorMessage(error);
      }
      for (const date of dueDates) {
        const result = await deps.handlers.dream.run({ from: slug, date, wait: true });
        if (result.ok && result.data?.kind !== 'failed' && result.data?.status !== 'failed') {
          outcome.dreamed.push(date);
        } else {
          outcome.error = result.message ?? result.code ?? `dream run failed for ${date}`;
        }
      }
      if (repairDate) {
        const result = await deps.handlers.dream.run({ from: slug, date: repairDate, wait: true, isRepair: true });
        if (result.ok && result.data?.kind !== 'failed' && result.data?.status !== 'failed') {
          outcome.dreamed.push(repairDate);
        } else {
          outcome.error = result.message ?? result.code ?? `dream repair run failed for ${repairDate}`;
        }
      }
    } catch (error) {
      outcome.error = errorMessage(error);
    }
  }
  // Hygiene tail: after the dream pass, each Bot's due memory-hygiene pass
  // (eligible once per local date, all-day catch-up; the CLI decides). Runs
  // even for Bots with no due dream dates — policy-off dreams do not gate
  // hygiene, exactly like the plugin scheduler.
  for (const outcome of outcomes) {
    if (handsOffSlugs.has(outcome.slug)) continue;
    try {
      const due = await deps.handlers.memory.hygieneDue({ from: outcome.slug });
      if (!due.ok) {
        outcome.hygieneError = due.message ?? due.code ?? 'memory hygiene due failed';
        continue;
      }
      if (due.data?.due !== true) {
        outcome.hygieneSkipped = typeof due.data?.reason === 'string' ? `not due (${due.data.reason})` : 'not due';
        continue;
      }
      const run = await deps.handlers.memory.hygieneRun({ from: outcome.slug });
      if (run.ok) {
        outcome.hygieneRan = true;
      } else {
        outcome.hygieneError = run.message ?? run.code ?? 'memory hygiene run failed';
      }
    } catch (error) {
      outcome.hygieneError = errorMessage(error);
    }
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// Chain-history summary drain
// ---------------------------------------------------------------------------

export const CHAIN_HISTORY_SUMMARY_DEFAULT_PER_TICK = 10;
export const CHAIN_HISTORY_SUMMARY_DEFAULT_DAILY_CAP = 40;
/** Summaries are short; a 60s budget is generous even for a slow runtime. */
export const CHAIN_HISTORY_SUMMARY_LLM_TIMEOUT_MS = 60_000;
/** Stored summaries are capped so a chatty model cannot bloat the ledger. */
export const CHAIN_HISTORY_SUMMARY_MAX_CHARS = 500;

export interface ChainHistorySummaryItemInput {
  kind: 'write' | 'read';
  /** Read records carry the pin title; write records pass null. */
  title: string | null;
  path: string | null;
  /** Truncated stored text: contentText for writes, contentExcerpt for reads. */
  content: string;
}

/** Port of the plugin prompt builder (`dsh-plugin/src/chain-history-summary.ts`). */
export function buildChainHistorySummaryPrompt(input: ChainHistorySummaryItemInput): { system: string; user: string } {
  const system = [
    'You write compact memory notes for a MetaBot about its own on-chain activity.',
    'Summarize the central idea in 2-4 sentences, in the SAME language as the content.',
    'Output only the summary text: no commentary, no evaluation, no prefix like "Summary:".',
  ].join('\n');
  const context = [
    input.title ? `title: ${input.title}` : null,
    input.path ? `path: ${input.path}` : null,
  ].filter(Boolean).join(', ');
  const lead = input.kind === 'write'
    ? `You published the following content on-chain${context ? ` (${context})` : ''}:`
    : `You read the following on-chain content${context ? ` (${context})` : ''}:`;
  const closing = input.kind === 'write'
    ? 'Summarize what you published.'
    : 'Summarize the central idea of what you read.';
  const user = `${lead}\n\n<content>\n${input.content}\n</content>\n\n${closing}`;
  return { system, user };
}

/** Store seam over `createChainHistoryStore` (per-profile instance). */
export interface ChainHistoryTickStore {
  listPendingSummaries(kind: 'write' | 'read', limit?: number): Promise<Array<{
    record: object;
  }>>;
  applySummaryOutcome(
    kind: 'write' | 'read',
    pinId: string,
    outcome: { status: 'done'; summary: string } | { status: 'failed' },
  ): Promise<boolean>;
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
  summarize: (input: ChainHistorySummaryItemInput & { slug: string; homeDir: string }) => Promise<string>;
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

interface PendingSummaryItem {
  kind: 'write' | 'read';
  pinId: string;
  title: string | null;
  path: string | null;
  contentText: string | null;
}

function parsePendingItem(kind: 'write' | 'read', record: object): PendingSummaryItem | null {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const raw = record as Record<string, unknown>;
  const pinId = typeof raw.pinId === 'string' ? raw.pinId.trim() : '';
  if (!pinId) return null;
  return {
    kind,
    pinId,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : null,
    path: typeof raw.path === 'string' && raw.path.trim() ? raw.path : null,
    contentText: typeof raw.contentText === 'string'
      ? raw.contentText
      : typeof raw.contentExcerpt === 'string'
        ? raw.contentExcerpt
        : null,
  };
}

/**
 * One drain pass over every Bot: fetch pending candidates (writes first, then
 * reads, oldest first — `chainhistory summary pending` parity), then
 * summarize + apply serially until the global per-tick budget or the Bot's
 * remaining daily budget runs out. One item's failure is recorded on that
 * record (outcome failed) and never interrupts the batch.
 */
export async function runChainHistorySummaryTick(
  deps: ChainHistorySummaryTickDeps,
): Promise<ChainHistorySummaryBotOutcome[]> {
  const outcomes: ChainHistorySummaryBotOutcome[] = [];
  if (deps.isHostExecutorConnected()) {
    // Stand-down: DSH owns the summary drain while its host executor is connected.
    return outcomes;
  }
  const perTick = Math.max(1, Math.floor(deps.perTick ?? CHAIN_HISTORY_SUMMARY_DEFAULT_PER_TICK));
  const dailyCap = Math.max(1, Math.floor(deps.dailyCap ?? CHAIN_HISTORY_SUMMARY_DEFAULT_DAILY_CAP));
  const now = deps.now ?? (() => new Date());
  let profiles: AutomationBotRef[];
  try {
    profiles = await deps.listBots();
  } catch (error) {
    deps.log?.(`[ChainHistorySummary] bot list failed: ${errorMessage(error)}`);
    return outcomes;
  }
  let tickRemaining = perTick;
  for (const profile of profiles) {
    const slug = typeof profile.slug === 'string' ? profile.slug.trim() : '';
    if (!slug) continue;
    const outcome: ChainHistorySummaryBotOutcome = { slug, done: 0, failed: 0 };
    outcomes.push(outcome);
    try {
      // Toggle-off Bots are hands-off for every daemon tick, matching the
      // schedule/study/dream ticks (the plugin drain predates that rule).
      if (profile.isAvailable === false) {
        outcome.skipped = 'bot unavailable (availability toggle off)';
        continue;
      }
      if (!await deps.isTickEnabled(profile.homeDir)) {
        outcome.skipped = 'automation.chainHistorySummaryEnabled=false';
        continue;
      }
      if (tickRemaining <= 0) {
        outcome.skipped = 'per-tick summary budget exhausted';
        continue;
      }
      const store = deps.storeFor(profile.homeDir);
      const [writeEntries, readEntries] = await Promise.all([
        store.listPendingSummaries('write', perTick),
        store.listPendingSummaries('read', perTick),
      ]);
      const items: PendingSummaryItem[] = [];
      for (const entry of writeEntries) {
        const item = parsePendingItem('write', entry.record);
        if (item) items.push(item);
      }
      for (const entry of readEntries) {
        const item = parsePendingItem('read', entry.record);
        if (item) items.push(item);
      }
      if (items.length === 0) {
        outcome.skipped = 'no pending summaries';
        continue;
      }
      const current = now();
      const localMidnightMs = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
      const summarizedToday = await store.countSummariesSince(null, localMidnightMs);
      let dailyRemaining = Math.max(0, dailyCap - summarizedToday);
      if (dailyRemaining <= 0) {
        outcome.skipped = 'daily summary cap reached';
        continue;
      }
      for (const item of items) {
        if (tickRemaining <= 0 || dailyRemaining <= 0) break;
        const content = (item.contentText ?? '').trim();
        if (!content) {
          // Pending records always carry content by construction; a blank one
          // is a store anomaly — leave it alone rather than burning an attempt.
          continue;
        }
        try {
          const summary = await deps.summarize({
            slug,
            homeDir: profile.homeDir,
            kind: item.kind,
            title: item.title,
            path: item.path,
            content,
          });
          const trimmed = summary.trim().slice(0, CHAIN_HISTORY_SUMMARY_MAX_CHARS);
          if (!trimmed) throw new Error('LLM returned an empty summary');
          if (await store.applySummaryOutcome(item.kind, item.pinId, { status: 'done', summary: trimmed })) {
            outcome.done += 1;
            // Only completed summaries count against the daily cap (the store
            // counts records with summarizedAtMs set, i.e. done only).
            dailyRemaining -= 1;
          } else {
            // The summary was generated but not persisted; the record stays
            // pending for a later tick, so do not burn a summary attempt.
            outcome.failed += 1;
          }
        } catch {
          await store.applySummaryOutcome(item.kind, item.pinId, { status: 'failed' }).catch(() => false);
          outcome.failed += 1;
        }
        tickRemaining -= 1;
      }
    } catch (error) {
      outcome.error = errorMessage(error);
    }
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// Serial loop lifecycle (schedule-tick pattern)
// ---------------------------------------------------------------------------

/** Surface one dream-tick pass on the log (silent when nothing happened). */
export function reportDreamTickOutcomes(outcomes: DreamTickBotOutcome[], log: (message: string) => void): void {
  for (const outcome of outcomes) {
    if (outcome.error) {
      log(`[DreamTick] ${outcome.slug}: ${outcome.error}`);
    } else if (outcome.skipped) {
      log(`[DreamTick] ${outcome.slug} skipped: ${outcome.skipped}`);
    } else if (outcome.dreamed.length > 0) {
      log(`[DreamTick] ${outcome.slug} dreamed ${outcome.dreamed.join(', ')}`);
    }
    if (outcome.surfRan) {
      log(`[DreamTick] ${outcome.slug} pre-dream surf ran`);
    } else if (outcome.surfError) {
      log(`[DreamTick] ${outcome.slug} pre-dream surf: ${outcome.surfError} (dream proceeds)`);
    }
    if (outcome.hygieneRan) {
      log(`[DreamTick] ${outcome.slug} hygiene ran`);
    } else if (outcome.hygieneError) {
      log(`[DreamTick] ${outcome.slug} hygiene: ${outcome.hygieneError}`);
    }
  }
}

/** Surface one chain-history drain pass on the log (silent when idle). */
export function reportChainHistorySummaryTickOutcomes(
  outcomes: ChainHistorySummaryBotOutcome[],
  log: (message: string) => void,
): void {
  for (const outcome of outcomes) {
    if (outcome.error) {
      log(`[ChainHistorySummary] ${outcome.slug}: ${outcome.error}`);
    } else if (outcome.skipped) {
      log(`[ChainHistorySummary] ${outcome.slug} skipped: ${outcome.skipped}`);
    } else if (outcome.done > 0 || outcome.failed > 0) {
      log(`[ChainHistorySummary] ${outcome.slug} summarized ${outcome.done}, failed ${outcome.failed}`);
    }
  }
}

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
export function startAutomationTickLoop(
  pass: () => Promise<unknown>,
  options: AutomationTickLoopOptions,
): AutomationTickLoop {
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  let running = false;
  let stopped = false;

  const fire = (): void => {
    if (stopped || running) return;
    running = true;
    void pass()
      .catch((error) => {
        options.log?.(`[automation tick] pass failed: ${errorMessage(error)}`);
      })
      .finally(() => {
        running = false;
      });
  };

  const interval = setIntervalFn(fire, options.tickMs);
  interval.unref?.();
  const boot = setTimeoutFn(fire, options.bootDelayMs);
  boot.unref?.();

  return {
    tick: fire,
    stop() {
      stopped = true;
      clearIntervalFn(interval);
      clearTimeoutFn(boot);
    },
    get running() {
      return running;
    },
  };
}
