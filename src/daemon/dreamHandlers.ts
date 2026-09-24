/**
 * Daemon-side dream handler group: the /api/dream/* verbs. The read verbs
 * (status/due/summaries/self-identity/capabilities) are pure core-store calls;
 * `run` ports the `metabot dream run` in-process loop (plan → LLM → commit)
 * with the unified passive-LLM chain (DSH pair first, then the local runtime
 * fallback through the injected daemon llmExecutor).
 *
 * Long-running contract mirrors /api/surf/run: `wait: true` holds the request
 * until the run settles; the default starts the run inside the daemon process
 * and returns `{ date, status: 'running' }` immediately. Run state lives in
 * the dream store, so `status`/`due` observe it (their stale-running sweep is
 * the crash-recovery path when the daemon dies mid-run).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { commandFailed, commandSuccess } from '../core/contracts/commandResult';
import { createCapabilityStore } from '../core/memory/capabilityStore';
import { createDreamStore } from '../core/memory/dreamStore';
import {
  dreamStatus,
  dueDreamDates,
  runDream,
  type DreamModelLimits,
} from '../core/memory/dreamService';
import { formatLocalDate } from '../core/memory/experiencePromptBlocks';
import { createMemoryStore } from '../core/memory/memoryStore';
import { createHostFirstCompletion } from '../core/llm/hostLlmExecutorBridge';
import { createLlmBindingStore } from '../core/llm/llmBindingStore';
import { createLlmRuntimeResolver } from '../core/llm/llmRuntimeResolver';
import { createLlmRuntimeStore } from '../core/llm/llmRuntimeStore';
import type { LlmExecutor } from '../core/llm/executor';
import { runLlmPromptWithRuntimeFallback } from '../core/llm/llmRuntimeExecution';
import { resolveMetabotPaths, type MetabotPaths } from '../core/state/paths';
import type { MetabotDaemonHttpHandlers } from './routes/types';

export interface DreamBotRef {
  slug: string;
  name: string;
  homeDir: string;
}

export interface DreamDaemonHandlersInput {
  /** Resolve the acting bot (explicit slug, else the machine Twin). */
  resolveBot: (from?: string) => Promise<DreamBotRef | { failure: ReturnType<typeof commandFailed> }>;
  /**
   * The daemon's shared LLM executor (local-runtime chain). Absent → dream
   * runs fail with a clear error whenever an LLM call is actually needed
   * (empty days still complete without one).
   */
  llmExecutor?: Pick<LlmExecutor, 'execute' | 'getSession'> | null;
  /** Structured log sink (daemon engine log). */
  log?: (message: string) => void;
}

const DREAM_LLM_TIMEOUT_MS = 180_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function readPreferredLlmRuntimeId(paths: MetabotPaths): Promise<string | null> {
  try {
    const raw = await fs.readFile(paths.preferredLlmRuntimePath, 'utf8');
    const data = JSON.parse(raw) as { runtimeId?: string | null };
    return typeof data.runtimeId === 'string' ? data.runtimeId : null;
  } catch {
    return null;
  }
}

/** Same shape as the CLI `parseDreamLimits` (limits object or bare fields). */
function parseDreamLimits(payload: Record<string, unknown> | undefined): Partial<DreamModelLimits> | undefined {
  const source = payload?.limits && typeof payload.limits === 'object' && !Array.isArray(payload.limits)
    ? payload.limits as Record<string, unknown>
    : payload;
  if (!source) return undefined;
  const contextWindow = typeof source.contextWindow === 'number' && Number.isFinite(source.contextWindow)
    ? source.contextWindow
    : undefined;
  const maxOutputTokens = typeof source.maxOutputTokens === 'number' && Number.isFinite(source.maxOutputTokens)
    ? source.maxOutputTokens
    : undefined;
  if (contextWindow === undefined && maxOutputTokens === undefined) return undefined;
  return {
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
  };
}

function defaultDreamDate(): string {
  const now = new Date();
  return formatLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
}

export function createDreamDaemonHandlers(
  input: DreamDaemonHandlersInput,
): NonNullable<MetabotDaemonHttpHandlers['dream']> {
  const log = input.log ?? (() => undefined);
  // One in-flight background run per profile+date, surf `startSurf` parity.
  const inFlight = new Set<string>();

  function completeFor(paths: MetabotPaths, slug: string) {
    const llmExecutor = input.llmExecutor ?? null;
    const runtimeResolver = createLlmRuntimeResolver({
      runtimeStore: createLlmRuntimeStore(paths),
      bindingStore: createLlmBindingStore(paths),
      getPreferredRuntimeId: () => readPreferredLlmRuntimeId(paths),
    });
    return async (request: { system: string; user: string; maxOutputTokens: number }): Promise<string> => {
      if (!llmExecutor) {
        throw new Error('No LLM executor is configured on this daemon for dream runs.');
      }
      // Unified passive-LLM priority: the Bot's DSH pair first, then the
      // local runtime chain below.
      const hostText = await createHostFirstCompletion({
        dshLlmPath: paths.dshLlmPath,
        timeoutMs: DREAM_LLM_TIMEOUT_MS,
      })({
        botSlug: slug,
        system: request.system,
        user: request.user,
        ...(Number.isFinite(request.maxOutputTokens) && request.maxOutputTokens > 0
          ? { maxTokens: request.maxOutputTokens }
          : {}),
      });
      if (hostText !== null) return hostText;
      const outcome = await runLlmPromptWithRuntimeFallback({
        runtimeResolver,
        llmExecutor,
        metaBotSlug: slug,
        prompt: request.user,
        systemPrompt: request.system,
        timeoutMs: DREAM_LLM_TIMEOUT_MS,
        pollIntervalMs: 5_000,
      });
      if (outcome.status !== 'completed') {
        throw new Error(outcome.error || `Dream generation ended with status ${outcome.status}.`);
      }
      return outcome.output;
    };
  }

  return {
    due: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const due = await dueDreamDates(resolveMetabotPaths(bot.homeDir));
      return commandSuccess(due as unknown as Record<string, unknown>);
    },

    status: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const status = await dreamStatus(resolveMetabotPaths(bot.homeDir));
      return commandSuccess(status as unknown as Record<string, unknown>);
    },

    summaries: async (rawInput: { from?: string; limit?: number | string; before?: string }) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const rawLimit = rawInput?.limit;
      const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? Math.max(1, Math.floor(rawLimit))
        : typeof rawLimit === 'string' && rawLimit.trim() !== '' && Number.isFinite(Number(rawLimit))
          ? Math.max(1, Math.floor(Number(rawLimit)))
          : undefined;
      const dreamStore = createDreamStore(resolveMetabotPaths(bot.homeDir));
      const summaries = await dreamStore.listDailySummaries({
        ...(limit !== undefined ? { limit } : {}),
        ...(rawInput?.before ? { before: rawInput.before } : {}),
      });
      return commandSuccess({ summaries });
    },

    selfIdentity: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const memoryStore = createMemoryStore(resolveMetabotPaths(bot.homeDir));
      const entries = await memoryStore.list({
        usageClass: 'self_identity',
        status: 'created',
        limit: 1,
      });
      return commandSuccess({
        text: entries[0]?.text ?? '',
        updatedAt: entries[0]?.updatedAt ?? null,
      });
    },

    capabilities: async (rawInput: { from?: string; limit?: number | string }) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const rawLimit = rawInput?.limit;
      const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? Math.max(1, Math.floor(rawLimit))
        : typeof rawLimit === 'string' && rawLimit.trim() !== '' && Number.isFinite(Number(rawLimit))
          ? Math.max(1, Math.floor(Number(rawLimit)))
          : undefined;
      const drafts = await createCapabilityStore(resolveMetabotPaths(bot.homeDir)).listDrafts({
        ...(limit !== undefined ? { limit } : {}),
      });
      return commandSuccess({ drafts });
    },

    run: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const date = typeof rawInput?.date === 'string' && rawInput.date.trim()
        ? rawInput.date.trim()
        : defaultDreamDate();
      if (!DATE_RE.test(date)) {
        return commandFailed('invalid_flag', '--date must be YYYY-MM-DD.');
      }
      const paths = resolveMetabotPaths(bot.homeDir);
      const slug = path.basename(paths.profileRoot);
      const key = `${paths.profileRoot}:${date}`;
      if (inFlight.has(key)) {
        return commandFailed('dream_already_running', `Dream run already in progress for ${date}.`);
      }
      const runInput = {
        date,
        llm: typeof rawInput?.llm === 'string' ? rawInput.llm : null,
        limits: parseDreamLimits(rawInput?.limits),
        isRepair: rawInput?.isRepair === true,
      };
      const complete = completeFor(paths, slug);

      if (rawInput?.wait === true) {
        const result = await runDream(paths, runInput, complete);
        if (result.kind === 'failed') {
          return commandFailed('dream_run_failed', result.error ?? 'dream run failed');
        }
        return commandSuccess(result as unknown as Record<string, unknown>);
      }

      inFlight.add(key);
      void (async () => {
        try {
          const result = await runDream(paths, runInput, complete);
          log(`[Dream] ${slug} ${date} → ${result.kind}${result.error ? ` (${result.error})` : ''}`);
        } catch (error) {
          log(`[Dream] ${slug} ${date} failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          inFlight.delete(key);
        }
      })();
      return commandSuccess({ date, status: 'running', wait: false });
    },
  };
}
