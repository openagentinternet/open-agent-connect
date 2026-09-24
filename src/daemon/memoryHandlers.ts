/**
 * Daemon-side memory handler group: the /api/memory/* verbs a standalone
 * memory UI needs. Every verb is a port of the matching `metabot memory *`
 * CLI dependency handler against src/core/memory stores — same inputs, same
 * envelope payloads. Actor resolution mirrors the surf/dream groups (explicit
 * slug, else the machine Twin).
 *
 * Deliberately not exposed here (agent-side surfaces, still reachable via the
 * CLI): blocks/extract (per-turn injection hooks), transcript append/read,
 * chats, scopes, stats.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { commandFailed, commandSuccess } from '../core/contracts/commandResult';
import { loadChatPersona } from '../core/chat/chatPersonaLoader';
import { createHostFirstCompletion } from '../core/llm/hostLlmExecutorBridge';
import type { LlmExecutor } from '../core/llm/executor';
import { createLlmBindingStore } from '../core/llm/llmBindingStore';
import { createLlmRuntimeResolver } from '../core/llm/llmRuntimeResolver';
import { createLlmRuntimeStore } from '../core/llm/llmRuntimeStore';
import { runLlmPromptWithRuntimeFallback } from '../core/llm/llmRuntimeExecution';
import { resolveContactNames } from '../core/memory/contactNames';
import {
  formatExperienceRecallResults,
  formatExperienceTimelineFallback,
  resolveExperienceRecallQuery,
} from '../core/memory/experiencePromptBlocks';
import { createDreamStore } from '../core/memory/dreamStore';
import { getDayBoundsMs } from '../core/memory/dreamPrompt';
import { createExperienceStore } from '../core/memory/experienceStore';
import { createHygieneStore } from '../core/memory/hygieneStore';
import { createImpressionStore } from '../core/memory/impressionStore';
import { createKnowledgeStore } from '../core/memory/knowledgeStore';
import { formatKnowledgeUpsertResult } from '../core/memory/knowledgePromptBlocks';
import {
  memoryHygieneDue,
  runMemoryHygiene,
  type MemoryHygieneLlmCompletion,
} from '../core/memory/memoryHygieneService';
import { createMemoryPolicyStore } from '../core/memory/memoryPolicy';
import { createMemoryStore } from '../core/memory/memoryStore';
import type { MemoryCreateInput, MemoryUpdateInput } from '../core/memory/memoryTypes';
import { searchConversations } from '../core/memory/transcriptStore';
import { resolveMetabotPaths, type MetabotPaths } from '../core/state/paths';
import type { DreamBotRef } from './dreamHandlers';
import type { MetabotDaemonHttpHandlers } from './routes/types';

export interface MemoryDaemonHandlersInput {
  /** Resolve the acting bot (explicit slug, else the machine Twin). */
  resolveBot: (from?: string) => Promise<DreamBotRef | { failure: ReturnType<typeof commandFailed> }>;
  /**
   * The daemon's shared LLM executor for the deep-consolidation call inside
   * hygiene runs. Absent/unbound → deep consolidation is skipped (null), never
   * a failure — exactly the pre-wiring CLI behavior.
   */
  llmExecutor?: Pick<LlmExecutor, 'execute' | 'getSession'> | null;
}

const HYGIENE_LLM_TIMEOUT_MS = 180_000;

export function createMemoryDaemonHandlers(
  input: MemoryDaemonHandlersInput,
): NonNullable<MetabotDaemonHttpHandlers['memory']> {
  async function readPreferredLlmRuntimeId(paths: MetabotPaths): Promise<string | null> {
    try {
      const raw = await fs.readFile(paths.preferredLlmRuntimePath, 'utf8');
      const data = JSON.parse(raw) as { runtimeId?: string | null };
      return typeof data.runtimeId === 'string' ? data.runtimeId : null;
    } catch {
      return null;
    }
  }

  return {
    list: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createMemoryStore(resolveMetabotPaths(bot.homeDir));
      const entries = await store.list({
        ...(rawInput?.scopeKind ? { scopeKind: rawInput.scopeKind as never } : {}),
        ...(rawInput?.scopeKey ? { scopeKey: rawInput.scopeKey } : {}),
        ...(rawInput?.usageClass ? { usageClass: rawInput.usageClass as never } : {}),
        ...(rawInput?.status ? { status: rawInput.status as never } : {}),
        ...(rawInput?.origin ? { origin: rawInput.origin as never } : {}),
        ...(rawInput?.query ? { query: rawInput.query } : {}),
        ...(rawInput?.limit !== undefined ? { limit: rawInput.limit } : {}),
        ...(rawInput?.includeDeleted ? { includeDeleted: true } : {}),
        ...(rawInput?.includeArchived ? { includeArchived: true } : {}),
      });
      return commandSuccess({ entries });
    },

    add: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createMemoryStore(resolveMetabotPaths(bot.homeDir));
      const payload = rawInput?.payload ?? {};
      const memory = await store.create({
        text: String(payload.text ?? ''),
        ...(typeof payload.scopeKind === 'string' ? { scopeKind: payload.scopeKind as never } : {}),
        ...(typeof payload.scopeKey === 'string' ? { scopeKey: payload.scopeKey } : {}),
        ...(typeof payload.usageClass === 'string' ? { usageClass: payload.usageClass as never } : {}),
        ...(typeof payload.visibility === 'string' ? { visibility: payload.visibility as never } : {}),
        ...(typeof payload.confidence === 'number' ? { confidence: payload.confidence } : {}),
        ...(typeof payload.isExplicit === 'boolean' ? { isExplicit: payload.isExplicit } : {}),
        ...(typeof payload.origin === 'string' ? { origin: payload.origin as never } : {}),
        ...(payload.source && typeof payload.source === 'object' && !Array.isArray(payload.source)
          ? { source: payload.source as MemoryCreateInput['source'] }
          : {}),
      });
      return commandSuccess({ memory });
    },

    update: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createMemoryStore(resolveMetabotPaths(bot.homeDir));
      const payload = rawInput?.payload ?? {};
      const memory = await store.update({
        id: String(payload.id ?? ''),
        ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
        ...(typeof payload.scopeKind === 'string' ? { scopeKind: payload.scopeKind as never } : {}),
        ...(typeof payload.scopeKey === 'string' ? { scopeKey: payload.scopeKey } : {}),
        ...(typeof payload.usageClass === 'string' ? { usageClass: payload.usageClass as never } : {}),
        ...(typeof payload.visibility === 'string' ? { visibility: payload.visibility as never } : {}),
        ...(typeof payload.confidence === 'number' ? { confidence: payload.confidence } : {}),
        ...(typeof payload.isExplicit === 'boolean' ? { isExplicit: payload.isExplicit } : {}),
        ...(typeof payload.status === 'string' ? { status: payload.status as MemoryUpdateInput['status'] } : {}),
      });
      if (!memory) {
        return commandFailed('not_found', 'Memory entry not found in the resolved scope (or it is protected).');
      }
      return commandSuccess({ memory });
    },

    delete: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createMemoryStore(resolveMetabotPaths(bot.homeDir));
      const payload = rawInput?.payload ?? {};
      const deleted = await store.remove({
        id: String(payload.id ?? ''),
        ...(typeof payload.scopeKind === 'string' ? { scopeKind: payload.scopeKind as never } : {}),
        ...(typeof payload.scopeKey === 'string' ? { scopeKey: payload.scopeKey } : {}),
      });
      if (!deleted) {
        return commandFailed('not_found', 'Memory entry not found in the resolved scope (or it is protected).');
      }
      return commandSuccess({ deleted: true });
    },

    unarchive: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createMemoryStore(resolveMetabotPaths(bot.homeDir));
      const restored = await store.unarchiveMemories([String(rawInput?.payload?.id ?? '')]);
      if (restored === 0) {
        return commandFailed('not_found', 'No archived memory entry with that id.');
      }
      return commandSuccess({ restored });
    },

    search: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const payload = rawInput?.payload ?? {};
      const records = await searchConversations(resolveMetabotPaths(bot.homeDir), {
        query: String(payload.query ?? ''),
        ...(typeof payload.maxResults === 'number' ? { maxResults: payload.maxResults } : {}),
        ...(typeof payload.before === 'number' ? { before: payload.before } : {}),
        ...(typeof payload.after === 'number' ? { after: payload.after } : {}),
      });
      return commandSuccess({ records });
    },

    recall: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const paths = resolveMetabotPaths(bot.homeDir);
      const payload = rawInput?.payload ?? {};
      const dreamStore = createDreamStore(paths);
      const query = resolveExperienceRecallQuery({
        query: typeof payload.query === 'string' ? payload.query : undefined,
        date_from: typeof payload.dateFrom === 'string' ? payload.dateFrom : undefined,
        date_to: typeof payload.dateTo === 'string' ? payload.dateTo : undefined,
        granularity: typeof payload.granularity === 'string'
          ? payload.granularity as 'day' | 'week' | 'month'
          : undefined,
        ...(typeof payload.limit === 'number' ? { limit: payload.limit } : {}),
      });
      const summaries = await dreamStore.searchDailySummaries({
        query: query.query,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        limit: query.limit,
      });
      let text: string;
      if (summaries.length > 0) {
        text = formatExperienceRecallResults(summaries.map((summary) => ({
          summaryDate: summary.summaryDate,
          summaryText: summary.summaryText,
          sessionRefs: summary.sessionRefs,
        })), query.granularity);
      } else {
        // Raw-episode timeline fallback so un-dreamed days are never blind.
        const experienceStore = createExperienceStore(paths);
        const fromTime = query.dateFrom ? getDayBoundsMs(query.dateFrom).startMs : undefined;
        const toTime = query.dateTo ? getDayBoundsMs(query.dateTo).endMs : undefined;
        const episodes = await experienceStore.listEpisodes({
          ...(fromTime !== undefined ? { fromTime } : {}),
          ...(toTime !== undefined ? { toTime } : {}),
          limit: 30,
        });
        text = formatExperienceTimelineFallback({
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          episodes: episodes.map((episode) => ({
            startedAt: episode.startedAt,
            sourceChannel: episode.sourceChannel,
            episodeType: episode.episodeType,
            title: typeof episode.metadata.title === 'string' ? episode.metadata.title : null,
          })),
        });
      }
      return commandSuccess({ text, summaries, query });
    },

    knowledgeList: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createKnowledgeStore(resolveMetabotPaths(bot.homeDir));
      const entries = await store.listKnowledge({
        ...(rawInput?.kind ? { kind: rawInput.kind as never } : {}),
        ...(rawInput?.category ? { category: rawInput.category } : {}),
        ...(rawInput?.status ? { status: rawInput.status as never } : {}),
        ...(rawInput?.query ? { query: rawInput.query } : {}),
        ...(rawInput?.limit !== undefined ? { limit: rawInput.limit } : {}),
      });
      return commandSuccess({ entries });
    },

    knowledgeUpsert: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createKnowledgeStore(resolveMetabotPaths(bot.homeDir));
      const payload = rawInput?.payload ?? {};
      const result = await store.upsertKnowledge({
        topic: String(payload.topic ?? ''),
        summary: String(payload.summary ?? ''),
        ...(typeof payload.kind === 'string' ? { kind: payload.kind as never } : {}),
        ...(typeof payload.category === 'string' ? { category: payload.category } : {}),
        ...(Array.isArray(payload.tags)
          ? { tags: payload.tags.filter((tag): tag is string => typeof tag === 'string') }
          : {}),
        ...(typeof payload.origin === 'string' ? { origin: payload.origin as never } : {}),
        ...(Array.isArray(payload.sources)
          ? { sources: payload.sources as never }
          : {}),
      });
      return commandSuccess({
        entry: result.entry,
        created: result.created,
        revised: result.revised,
        text: formatKnowledgeUpsertResult({
          topic: result.entry.topic,
          created: result.created,
          revised: result.revised,
          version: result.entry.version,
          kind: result.entry.kind,
        }),
      });
    },

    knowledgeUpdate: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createKnowledgeStore(resolveMetabotPaths(bot.homeDir));
      const payload = rawInput?.payload ?? {};
      const entry = await store.updateKnowledge({
        id: String(payload.id ?? ''),
        ...(typeof payload.topic === 'string' ? { topic: payload.topic } : {}),
        ...(typeof payload.summary === 'string' ? { summary: payload.summary } : {}),
        ...(typeof payload.kind === 'string' ? { kind: payload.kind as never } : {}),
      });
      if (!entry) return commandFailed('not_found', 'Knowledge entry not found.');
      return commandSuccess({ entry });
    },

    knowledgeArchive: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createKnowledgeStore(resolveMetabotPaths(bot.homeDir));
      const entry = await store.archiveKnowledge(String(rawInput?.payload?.id ?? ''));
      if (!entry) return commandFailed('not_found', 'Knowledge entry not found.');
      return commandSuccess({ entry });
    },

    knowledgeDelete: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createKnowledgeStore(resolveMetabotPaths(bot.homeDir));
      const deleted = await store.deleteKnowledge(String(rawInput?.payload?.id ?? ''));
      if (!deleted) return commandFailed('not_found', 'Knowledge entry not found.');
      return commandSuccess({ deleted: true });
    },

    impressionsList: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const paths = resolveMetabotPaths(bot.homeDir);
      const persona = await loadChatPersona(paths);
      const observerGlobalMetaId = persona.identity?.globalMetaId ?? '';
      if (!observerGlobalMetaId) {
        return commandFailed('identity_missing', 'No local MetaBot identity is loaded for this profile.');
      }
      const store = createImpressionStore(paths);
      const snapshots = await store.listSnapshots(observerGlobalMetaId);
      const names = await resolveContactNames(paths, snapshots.map((s) => s.subjectGlobalMetaId));
      const rows = snapshots.map((s) => ({
        ...s,
        subjectName: names.get(s.subjectGlobalMetaId) ?? null,
      }));
      return commandSuccess({ observerGlobalMetaId, snapshots: rows });
    },

    impressionsShow: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const paths = resolveMetabotPaths(bot.homeDir);
      const persona = await loadChatPersona(paths);
      const observerGlobalMetaId = persona.identity?.globalMetaId ?? '';
      if (!observerGlobalMetaId) {
        return commandFailed('identity_missing', 'No local MetaBot identity is loaded for this profile.');
      }
      const store = createImpressionStore(paths);
      const snapshot = await store.getSnapshot(observerGlobalMetaId, rawInput?.subject ?? '');
      const observations = await store.listObservations({
        observerGlobalMetaId,
        subjectGlobalMetaId: rawInput?.subject ?? '',
        includeSuperseded: true,
      });
      const names = await resolveContactNames(paths, [rawInput?.subject ?? '']);
      const namedSnapshot = snapshot
        ? { ...snapshot, subjectName: names.get(rawInput?.subject ?? '') ?? null }
        : snapshot;
      return commandSuccess({
        observerGlobalMetaId,
        subject: rawInput?.subject ?? '',
        snapshot: namedSnapshot,
        observations,
      });
    },

    policyGet: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createMemoryPolicyStore(resolveMetabotPaths(bot.homeDir));
      return commandSuccess({
        effective: await store.effectivePolicy(),
        override: await store.readOverride(),
      });
    },

    policySet: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createMemoryPolicyStore(resolveMetabotPaths(bot.homeDir));
      const allowed = [
        'memoryEnabled',
        'memoryImplicitUpdateEnabled',
        'memoryLlmJudgeEnabled',
        'memoryGuardLevel',
        'memoryUserMemoriesMaxItems',
        'memoryPromptMaxChars',
        'dreamEnabled',
        'hygieneEnabled',
        'hygiene',
      ] as const;
      const updates: Record<string, unknown> = {};
      for (const key of allowed) {
        if (rawInput?.payload?.[key] !== undefined) updates[key] = rawInput.payload[key];
      }
      const policy = await store.setOverride(updates);
      return commandSuccess({ policy });
    },

    policyDelete: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createMemoryPolicyStore(resolveMetabotPaths(bot.homeDir));
      return commandSuccess({ deleted: await store.deleteOverride() });
    },

    hygieneStatus: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const paths = resolveMetabotPaths(bot.homeDir);
      const policyStore = createMemoryPolicyStore(paths);
      const hygieneStore = createHygieneStore(paths);
      const [config, ledger, due] = await Promise.all([
        policyStore.getHygieneConfig(),
        hygieneStore.getLedger(),
        memoryHygieneDue(paths),
      ]);
      return commandSuccess({
        config,
        lastRun: ledger.lastRun,
        deepConsolidationLastRunAt: ledger.deepConsolidationLastRunAt,
        due,
      });
    },

    hygieneDue: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      return commandSuccess(await memoryHygieneDue(resolveMetabotPaths(bot.homeDir)));
    },

    hygieneRun: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const paths = resolveMetabotPaths(bot.homeDir);
      const slug = path.basename(paths.profileRoot);
      const llmExecutor = input.llmExecutor ?? null;
      const runtimeResolver = createLlmRuntimeResolver({
        runtimeStore: createLlmRuntimeStore(paths),
        bindingStore: createLlmBindingStore(paths),
        getPreferredRuntimeId: () => readPreferredLlmRuntimeId(paths),
      });
      // The deep-consolidation call: DSH pair first, then the local chain.
      // No healthy runtime binding = skip (null), never fail; a started run
      // that errors mid-call lands in the run's error list via a throw.
      const complete: MemoryHygieneLlmCompletion = async (request) => {
        const hostText = await createHostFirstCompletion({
          dshLlmPath: paths.dshLlmPath,
          timeoutMs: HYGIENE_LLM_TIMEOUT_MS,
        })({ botSlug: slug, system: request.system, user: request.user });
        if (hostText !== null) return hostText;
        if (!llmExecutor) return null;
        const outcome = await runLlmPromptWithRuntimeFallback({
          runtimeResolver,
          llmExecutor,
          metaBotSlug: slug,
          prompt: request.user,
          systemPrompt: request.system,
          timeoutMs: HYGIENE_LLM_TIMEOUT_MS,
          pollIntervalMs: 5_000,
        });
        if (outcome.status !== 'completed') {
          throw new Error(outcome.error || `Deep consolidation ended with status ${outcome.status}.`);
        }
        return outcome.output;
      };
      try {
        const stats = await runMemoryHygiene(paths, {
          trigger: 'manual',
          deep: rawInput?.noDeep ? false : undefined,
          complete,
        });
        return commandSuccess(stats as unknown as Record<string, unknown>);
      } catch (error) {
        return commandFailed('hygiene_run_failed', error instanceof Error ? error.message : String(error));
      }
    },

    hygieneConfigGet: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createMemoryPolicyStore(resolveMetabotPaths(bot.homeDir));
      return commandSuccess({ config: await store.getHygieneConfig() });
    },

    hygieneConfigSet: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createMemoryPolicyStore(resolveMetabotPaths(bot.homeDir));
      const config = await store.setHygieneConfig(rawInput?.payload ?? {});
      return commandSuccess({ config });
    },
  };
}
