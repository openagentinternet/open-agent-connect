// Dream orchestration, ported from IDBots src/main/services/dreamService.ts.
// The write pipeline (diary, dream-memory batch replace, forward-only
// self-identity, impression/knowledge hooks) lives here in the CLI core; the
// LLM transport is injected, so the DSH plugin can drive the same pipeline
// across the process boundary with `ctx.llm` (plan → LLM → commit), while
// standalone hosts use runDream with a local completion function.
import { loadChatPersona } from '../chat/chatPersonaLoader';
import type { MetabotPaths } from '../state/paths';
import {
  chunkDreamActivity,
  estimateDreamActivityTokens,
  summariesToActivity,
  type DreamFragmentSummary,
} from './dreamFragments';
import {
  buildDreamFragmentPrompt,
  buildDreamPrompt,
  computeDueDreamDates,
  DREAM_VERSION,
  dreamStaggerSeedForSlug,
  getDayBoundsMs,
  parseDreamOutput,
  validateSelfIdentity,
  type DreamDueResult,
  type DreamImpressionPromptSubject,
  type DreamKnowledgeExisting,
  type DreamOutput,
} from './dreamPrompt';
import { createDreamStore, hashDreamFragmentContent, type DreamRun, type DreamStore } from './dreamStore';
import { createExperienceStore, type ExperienceStore } from './experienceStore';
import { createImpressionStore, type ImpressionStore } from './impressionStore';
import { applyDreamImpressionUpdates, buildDreamImpressionSubjects } from './impressionService';
import { createKnowledgeStore, type KnowledgeStore } from './knowledgeStore';
import { createMemoryStore, type MemoryStore } from './memoryStore';
import path from 'node:path';

/** Model limits used to size the dream prompts; injectable per LLM. */
export interface DreamModelLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

const DEFAULT_MODEL_LIMITS: DreamModelLimits = { contextWindow: 128_000, maxOutputTokens: 8192 };
const DREAM_LLM_TARGET_MAX_TOKENS = 32_768;
const DREAM_CONTEXT_RESERVE_TOKENS = 8_000;
const DREAM_FAST_PATH_MAX_TOKENS = 96_000;
const DREAM_CHUNK_MAX_TOKENS = 64_000;
const DREAM_FRAGMENT_MAX_TOKENS = 4_096;
/** A run left `running` longer than this is treated as crashed and reset. */
const STALE_RUNNING_RESET_MS = 30 * 60 * 1000;

const EVALUATION_LABELS: Record<string, string> = {
  warming: '升温',
  stable: '持平',
  cooling: '降温',
};

export interface DreamBudgets {
  maxOutputTokens: number;
  fastPathInputTokens: number;
  fragmentInputTokens: number;
  fragmentOutputTokens: number;
}

export function resolveDreamBudgets(limits?: Partial<DreamModelLimits>): DreamBudgets {
  const contextWindow = Math.max(16_000, Math.floor(limits?.contextWindow ?? DEFAULT_MODEL_LIMITS.contextWindow));
  const configuredOutput = Math.max(1, Math.floor(limits?.maxOutputTokens ?? DEFAULT_MODEL_LIMITS.maxOutputTokens));
  const maxOutputTokens = Math.max(1, Math.min(DREAM_LLM_TARGET_MAX_TOKENS, configuredOutput));
  const usableInputTokens = Math.max(16_000, contextWindow - maxOutputTokens - DREAM_CONTEXT_RESERVE_TOKENS);
  return {
    maxOutputTokens,
    fastPathInputTokens: Math.min(DREAM_FAST_PATH_MAX_TOKENS, Math.floor(usableInputTokens * 0.5)),
    fragmentInputTokens: Math.min(DREAM_CHUNK_MAX_TOKENS, Math.floor(usableInputTokens * 0.35)),
    fragmentOutputTokens: Math.min(DREAM_FRAGMENT_MAX_TOKENS, maxOutputTokens),
  };
}

export interface DreamChatCompletionInput {
  system: string;
  user: string;
  maxOutputTokens: number;
}
export type DreamChatCompletion = (input: DreamChatCompletionInput) => Promise<string>;

export interface DreamPersona {
  botName: string;
  role?: string | null;
  soul?: string | null;
  globalMetaId?: string | null;
}

async function loadDreamPersona(paths: MetabotPaths): Promise<DreamPersona> {
  const persona = await loadChatPersona(paths);
  const slug = path.basename(paths.profileRoot);
  return {
    botName: persona.identity?.name || slug,
    role: persona.role || null,
    soul: persona.soul || null,
    globalMetaId: persona.identity?.globalMetaId || null,
  };
}

export type DreamPlanResult =
  | { kind: 'empty'; date: string }
  | { kind: 'prompt'; date: string; mode: 'fast'; system: string; user: string; maxOutputTokens: number }
  | {
    kind: 'fragments';
    date: string;
    mode: 'fragments';
    /** Fragments still needing an LLM pass (cached ones are skipped). */
    fragments: Array<{
      fragmentKey: string;
      system: string;
      user: string;
      maxOutputTokens: number;
      contentHash: string;
      sourceMessageCount: number;
      sourceCharCount: number;
      estimatedInputTokens: number;
      sessionId: string;
      chunkIndex: number;
    }>;
    /** Fragments already cached from a previous (interrupted) run. */
    cachedFragmentKeys: string[];
  };

export interface DreamCommitResult {
  ok: boolean;
  error?: string;
  date?: string;
  selfIdentityValid?: boolean;
  selfIdentityChars?: number;
  /** When set, the caller should re-run the LLM once with this hint appended
   * to the user prompt and commit again (commit is idempotent per date). */
  identityRetryHint?: string;
  written?: {
    summary: boolean;
    importantMemories: number;
    valueLessons: number;
    workReviews: number;
    identityUpdated: boolean;
    identitySkippedOlder: boolean;
  };
}

export interface DreamServiceDeps {
  dreamStore?: DreamStore;
  memoryStore?: MemoryStore;
  experienceStore?: ExperienceStore;
  impressionStore?: ImpressionStore;
  knowledgeStore?: KnowledgeStore;
}

interface ResolvedDreamStores {
  dreamStore: DreamStore;
  memoryStore: MemoryStore;
  experienceStore: ExperienceStore;
  impressionStore: ImpressionStore;
  knowledgeStore: KnowledgeStore;
}

function resolveDreamStores(paths: MetabotPaths, deps: DreamServiceDeps): ResolvedDreamStores {
  const experienceStore = deps.experienceStore ?? createExperienceStore(paths);
  return {
    dreamStore: deps.dreamStore ?? createDreamStore(paths),
    memoryStore: deps.memoryStore ?? createMemoryStore(paths),
    experienceStore,
    impressionStore: deps.impressionStore ?? createImpressionStore(paths, { experienceStore }),
    knowledgeStore: deps.knowledgeStore ?? createKnowledgeStore(paths),
  };
}

/**
 * Reset a run left `running` by a crashed attempt so the date becomes
 * plannable again (the due-date algorithm skips `running` dates).
 */
async function resetStaleRunningRun(store: DreamStore, date: string): Promise<void> {
  const run = await store.getRun(date);
  if (run?.status === 'running' && Date.now() - run.startedAt > STALE_RUNNING_RESET_MS) {
    await store.finishRun(date, 'failed', 'stale running run reset');
  }
}

/** Which past dates still need dream attention for this bot. */
export async function dueDreamDates(
  paths: MetabotPaths,
  input: { now?: Date } = {},
  deps: DreamServiceDeps = {},
): Promise<DreamDueResult> {
  const dreamStore = deps.dreamStore ?? createDreamStore(paths);
  const runStates = await dreamStore.getRunStates();
  const slug = path.basename(paths.profileRoot);
  return computeDueDreamDates({
    now: input.now ?? new Date(),
    staggerSeed: dreamStaggerSeedForSlug(slug),
    runStates,
    dreamVersion: DREAM_VERSION,
  });
}

/**
 * Gather the day, decide fast vs fragmented, begin the run, and return the
 * prompt(s) the caller must run through an LLM. Empty days record a completed
 * run without any LLM call.
 */
export async function planDream(
  paths: MetabotPaths,
  input: { date: string; llm?: string | null; limits?: Partial<DreamModelLimits> },
  deps: DreamServiceDeps = {},
): Promise<DreamPlanResult> {
  const stores = resolveDreamStores(paths, deps);
  const { dreamStore } = stores;
  const date = input.date;
  const llm = input.llm ?? null;
  await resetStaleRunningRun(dreamStore, date);

  const { startMs, endMs } = getDayBoundsMs(date);
  const activity = await dreamStore.gatherActivity({ startMs, endMs });
  const persona = await loadDreamPersona(paths);
  const budgets = resolveDreamBudgets(input.limits);
  const impressionSubjects = persona.globalMetaId
    ? await buildDreamImpressionSubjects({
      experienceStore: stores.experienceStore,
      impressionStore: stores.impressionStore,
      observerGlobalMetaId: persona.globalMetaId,
      fromTime: startMs,
      toTime: endMs,
    })
    : [];
  const existingKnowledge: DreamKnowledgeExisting[] = await stores.knowledgeStore.listKnowledgeForDream(60);

  if (
    activity.sessions.length === 0
    && activity.taskRuns.length === 0
    && activity.groupTasks.length === 0
    && (activity.groupChats?.length ?? 0) === 0
    && impressionSubjects.length === 0
  ) {
    // Nothing happened that day — no LLM call, no summary, still recorded.
    await dreamStore.beginRun(date, llm, DREAM_VERSION);
    await dreamStore.finishRun(date, 'completed');
    return { kind: 'empty', date };
  }

  await dreamStore.beginRun(date, llm, DREAM_VERSION);

  const estimatedTokens = estimateDreamActivityTokens(activity);
  if (estimatedTokens <= budgets.fastPathInputTokens) {
    const prompt = buildDreamPrompt({
      botName: persona.botName,
      role: persona.role,
      soul: persona.soul,
      date,
      activity,
      activityTokenBudget: budgets.fastPathInputTokens,
      impressionSubjects,
      existingKnowledge,
    });
    return { kind: 'prompt', date, mode: 'fast', ...prompt, maxOutputTokens: budgets.maxOutputTokens };
  }

  const chunks = chunkDreamActivity(activity, budgets.fragmentInputTokens);
  if (chunks.length === 0) {
    const prompt = buildDreamPrompt({
      botName: persona.botName,
      role: persona.role,
      soul: persona.soul,
      date,
      activity,
      activityTokenBudget: budgets.fastPathInputTokens,
      impressionSubjects,
      existingKnowledge,
    });
    return { kind: 'prompt', date, mode: 'fast', ...prompt, maxOutputTokens: budgets.maxOutputTokens };
  }

  const needed: NonNullable<Extract<DreamPlanResult, { kind: 'fragments' }>['fragments']> = [];
  const cachedFragmentKeys: string[] = [];
  for (const chunk of chunks) {
    const contentHash = hashDreamFragmentContent(chunk);
    const existing = await dreamStore.getFragment(date, chunk.fragmentKey);
    if (
      existing?.status === 'completed'
      && existing.contentHash === contentHash
      && existing.dreamVersion === DREAM_VERSION
      && existing.llm === llm
      && existing.summaryJson
    ) {
      cachedFragmentKeys.push(chunk.fragmentKey);
      continue;
    }
    const prompt = buildDreamFragmentPrompt({
      botName: persona.botName,
      role: persona.role,
      soul: persona.soul,
      date,
      chunk,
    });
    needed.push({
      fragmentKey: chunk.fragmentKey,
      system: prompt.system,
      user: prompt.user,
      maxOutputTokens: budgets.fragmentOutputTokens,
      contentHash,
      sourceMessageCount: chunk.sourceMessageCount,
      sourceCharCount: chunk.sourceCharCount,
      estimatedInputTokens: chunk.estimatedInputTokens,
      sessionId: chunk.sessionId,
      chunkIndex: chunk.chunkIndex,
    });
  }

  return {
    kind: 'fragments',
    date,
    mode: 'fragments',
    fragments: needed,
    cachedFragmentKeys,
  };
}

/**
 * Fold raw fragment LLM outputs into the synthesis prompt. Fragment outputs
 * are parsed tolerantly and cached by content hash; previously cached
 * fragments are reused so an interrupted run resumes cheaply.
 */
export async function synthesizeDream(
  paths: MetabotPaths,
  input: {
    date: string;
    llm?: string | null;
    limits?: Partial<DreamModelLimits>;
    /** Raw LLM text keyed by fragmentKey for the fragments planDream returned. */
    fragmentOutputs: Record<string, string>;
  },
  deps: DreamServiceDeps = {},
): Promise<Extract<DreamPlanResult, { kind: 'prompt' }>> {
  const stores = resolveDreamStores(paths, deps);
  const dreamStore = stores.dreamStore;
  const date = input.date;
  const llm = input.llm ?? null;
  const budgets = resolveDreamBudgets(input.limits);

  for (const [fragmentKey, raw] of Object.entries(input.fragmentOutputs)) {
    const parsed = parseDreamOutput(raw);
    const existing = await dreamStore.getFragment(date, fragmentKey);
    await dreamStore.upsertFragment({
      dreamDate: date,
      fragmentKey,
      sessionId: existing?.sessionId ?? '',
      chunkIndex: existing?.chunkIndex ?? 0,
      contentHash: existing?.contentHash ?? '',
      sourceMessageCount: existing?.sourceMessageCount ?? 0,
      sourceCharCount: existing?.sourceCharCount ?? 0,
      estimatedInputTokens: existing?.estimatedInputTokens ?? 0,
      status: parsed.ok ? 'completed' : 'failed',
      summaryJson: parsed.ok ? JSON.stringify(parsed.output) : null,
      llm,
      dreamVersion: DREAM_VERSION,
      error: parsed.ok ? null : parsed.error,
      attemptCount: (existing?.attemptCount ?? 0) + 1,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
  }

  // Rebuild the chunk list to collect every fragment (cached + fresh).
  const { startMs, endMs } = getDayBoundsMs(date);
  const activity = await dreamStore.gatherActivity({ startMs, endMs });
  const chunks = chunkDreamActivity(activity, budgets.fragmentInputTokens);
  const summaries: DreamFragmentSummary[] = [];
  const missing: string[] = [];
  for (const chunk of chunks) {
    const fragment = await dreamStore.getFragment(date, chunk.fragmentKey);
    if (fragment?.status !== 'completed' || !fragment.summaryJson) {
      missing.push(chunk.fragmentKey);
      continue;
    }
    let output: unknown = null;
    try {
      output = JSON.parse(fragment.summaryJson);
    } catch {
      const parsed = parseDreamOutput(fragment.summaryJson);
      output = parsed.ok ? parsed.output : null;
    }
    if (!output) {
      missing.push(chunk.fragmentKey);
      continue;
    }
    summaries.push({
      fragmentKey: chunk.fragmentKey,
      sessionId: chunk.sessionId,
      title: chunk.title,
      chunkIndex: chunk.chunkIndex,
      output,
    });
  }
  if (missing.length > 0) {
    throw new Error(`dream fragments missing or unparseable: ${missing.join(', ')}`);
  }

  const persona = await loadDreamPersona(paths);
  const synthesisActivity = summariesToActivity(
    summaries,
    activity.taskRuns,
    activity.orderCount,
    activity.groupTasks,
  );
  const impressionSubjects: DreamImpressionPromptSubject[] = persona.globalMetaId
    ? await buildDreamImpressionSubjects({
      experienceStore: stores.experienceStore,
      impressionStore: stores.impressionStore,
      observerGlobalMetaId: persona.globalMetaId,
      fromTime: startMs,
      toTime: endMs,
    })
    : [];
  const existingKnowledge: DreamKnowledgeExisting[] = await stores.knowledgeStore.listKnowledgeForDream(60);
  const prompt = buildDreamPrompt({
    botName: persona.botName,
    role: persona.role,
    soul: persona.soul,
    date,
    activity: synthesisActivity,
    activityTokenBudget: budgets.fastPathInputTokens,
    sourceMode: 'fragment_summaries',
    impressionSubjects,
    existingKnowledge,
  });
  return { kind: 'prompt', date, mode: 'fast', ...prompt, maxOutputTokens: budgets.maxOutputTokens };
}

/** Parse + validate + write one dream output. Idempotent per date. */
export async function commitDream(
  paths: MetabotPaths,
  input: {
    date: string;
    outputText: string;
    llm?: string | null;
    isRepair?: boolean;
  },
  deps: DreamServiceDeps = {},
): Promise<DreamCommitResult> {
  const stores = resolveDreamStores(paths, deps);
  const dreamStore = stores.dreamStore;
  const memoryStore = stores.memoryStore;
  const date = input.date;
  const isRepair = input.isRepair === true;

  const parsed = parseDreamOutput(input.outputText);
  if (!parsed.ok) {
    await dreamStore.finishRun(date, 'failed', parsed.error);
    return { ok: false, error: parsed.error };
  }
  const output = parsed.output;

  const { startMs, endMs } = getDayBoundsMs(date);
  const activity = await dreamStore.gatherActivity({ startMs, endMs });
  const persona = await loadDreamPersona(paths);
  const llm = input.llm ?? null;

  await dreamStore.upsertDailySummary({
    summaryDate: date,
    summaryText: output.dailySummary,
    sections: output.sections,
    stats: {
      sessionCount: activity.sessions.length,
      orderSessionCount: activity.sessions.filter((session) => session.isOrder).length,
      orderCount: activity.orderCount,
      taskRunCount: activity.taskRuns.length,
      groupTaskEvaluationCount: activity.groupTasks.filter((task) => task.phase !== 'active').length,
      groupTaskActiveCount: activity.groupTasks.filter((task) => task.phase === 'active').length,
      groupChatCount: activity.groupChats?.length ?? 0,
      groupChatMessageCount: (activity.groupChats ?? []).reduce((sum, chat) => sum + chat.messages.length, 0),
      messageCount: activity.sessions.reduce((sum, session) => sum + session.messages.length, 0),
      activityCharCount: activity.sessions.reduce(
        (sum, session) => sum + session.messages.reduce((sessionSum, message) => sessionSum + message.content.length, 0),
        0,
      ),
      estimatedActivityTokens: estimateDreamActivityTokens(activity),
    },
    sessionRefs: activity.sessions.map((session) => ({
      sessionId: session.sessionId,
      title: session.title,
      sessionType: session.sessionType,
      isOrder: session.isOrder,
    })),
    llm,
  });

  // Idempotent per-date batch: replace the day's dream memories wholesale so
  // retries and version repairs never pile duplicates into the store.
  await memoryStore.softDeleteDreamMemoriesForDate(date);

  let importantWritten = 0;
  for (const text of new Set(output.importantMemories)) {
    await memoryStore.create({
      text,
      scopeKind: 'owner',
      scopeKey: 'owner:self',
      usageClass: 'profile_fact',
      origin: 'dream',
      isExplicit: true,
      forceNew: true,
      source: { sourceType: 'dream', sourceChannel: 'dream', dreamDate: date },
    });
    importantWritten += 1;
  }

  let lessonsWritten = 0;
  const seenLessons = new Set<string>();
  for (const lesson of output.valueLessons) {
    const text = lesson.source ? `${lesson.rule}(源自:${lesson.source})` : lesson.rule;
    if (seenLessons.has(text)) continue;
    seenLessons.add(text);
    await memoryStore.create({
      text,
      scopeKind: 'owner',
      scopeKey: 'owner:self',
      usageClass: 'value_boundary',
      origin: 'dream',
      isExplicit: true,
      forceNew: true,
      source: { sourceType: 'dream', sourceChannel: 'dream', dreamDate: date },
    });
    lessonsWritten += 1;
  }

  let reviewsWritten = 0;
  const seenReviews = new Set<string>();
  for (const review of output.workReviews) {
    const text = [
      `工作:${review.subject}`,
      `对象:${review.counterparty || '未知'}`,
      `评价:${EVALUATION_LABELS[review.evaluation] ?? EVALUATION_LABELS.stable}`,
      review.note ? `依据:${review.note}` : '',
    ].filter(Boolean).join(';');
    if (seenReviews.has(text)) continue;
    seenReviews.add(text);
    await memoryStore.create({
      text,
      scopeKind: 'owner',
      scopeKey: 'owner:self',
      usageClass: 'work_review',
      origin: 'dream',
      isExplicit: true,
      forceNew: true,
      source: { sourceType: 'dream', sourceChannel: 'dream', dreamDate: date },
    });
    reviewsWritten += 1;
  }

  // Self-identity only moves forward in time: version repairs never touch
  // it, and a normal run for a date older than the identity's current source
  // date must not regress it either.
  let identityUpdated = false;
  let identitySkippedOlder = false;
  if (output.selfIdentity && !isRepair) {
    const identityEntries = await memoryStore.list({
      scopeKind: 'owner',
      scopeKey: 'owner:self',
      usageClass: 'self_identity',
      status: 'all',
      includeDeleted: false,
      limit: 1,
    });
    const existing = identityEntries[0] ?? null;
    let latestIdentityDate: string | null = null;
    if (existing) {
      for (const source of existing.sources) {
        if (source.dreamDate && (!latestIdentityDate || source.dreamDate > latestIdentityDate)) {
          latestIdentityDate = source.dreamDate;
        }
      }
    }
    if (latestIdentityDate && date < latestIdentityDate) {
      identitySkippedOlder = true;
    } else if (existing) {
      await memoryStore.update({
        id: existing.id,
        scopeKind: 'owner',
        scopeKey: 'owner:self',
        text: output.selfIdentity,
        usageClass: 'self_identity',
        allowProtected: true,
        source: { sourceType: 'dream', sourceChannel: 'dream', dreamDate: date },
      });
      identityUpdated = true;
    } else {
      await memoryStore.create({
        text: output.selfIdentity,
        scopeKind: 'owner',
        scopeKey: 'owner:self',
        usageClass: 'self_identity',
        origin: 'dream',
        isExplicit: true,
        confidence: 0.9,
        forceNew: true,
        source: { sourceType: 'dream', sourceChannel: 'dream', dreamDate: date },
      });
      identityUpdated = true;
    }
    if (identityUpdated) {
      await dreamStore.writeSelfIdentityMarkdown(output.selfIdentity);
    }
  }

  // Impression + knowledge consolidation — best effort, never fails the run.
  if (persona.globalMetaId && output.impressionUpdates.length > 0) {
    try {
      const subjects = await buildDreamImpressionSubjects({
        experienceStore: stores.experienceStore,
        impressionStore: stores.impressionStore,
        observerGlobalMetaId: persona.globalMetaId,
        fromTime: startMs,
        toTime: endMs,
      });
      await applyDreamImpressionUpdates({
        impressionStore: stores.impressionStore,
        observerGlobalMetaId: persona.globalMetaId,
        dreamDate: date,
        dreamVersion: DREAM_VERSION,
        modelId: llm,
        subjects,
        updates: output.impressionUpdates,
      });
    } catch {
      // impression consolidation failure keeps the dream result intact
    }
  }
  if (output.knowledgeUpdates.length > 0) {
    for (const update of output.knowledgeUpdates) {
      try {
        await stores.knowledgeStore.upsertKnowledge({
          topic: update.topic,
          summary: update.summary,
          kind: update.kind,
          category: update.category ?? null,
          origin: 'dream',
          sourceDreamDate: date,
          sources: [
            ...(update.episodeIds ?? []).map((episodeId) => ({ episodeId, sourceChannel: 'experience' })),
            ...(update.evidenceIds ?? []).map((evidenceId) => ({ evidenceId, sourceChannel: 'experience' })),
          ],
        });
      } catch {
        // A single bad entry never aborts the rest of the batch.
      }
    }
  }

  await dreamStore.finishRun(date, 'completed');

  const identityValidation = validateSelfIdentity(output.selfIdentity);
  return {
    ok: true,
    date,
    selfIdentityValid: identityValidation.valid,
    selfIdentityChars: identityValidation.charCount,
    ...(!isRepair && !identityValidation.valid
      ? {
        identityRetryHint: `(上一次的 self_identity ${output.selfIdentity ? `只有 ${identityValidation.charCount} 个非空白字符` : '缺失'}。请重新输出完整 JSON,其中 self_identity 不少于 200 个非空白字符,认真写一段「我是谁」。)`,
      }
      : {}),
    written: {
      summary: true,
      importantMemories: importantWritten,
      valueLessons: lessonsWritten,
      workReviews: reviewsWritten,
      identityUpdated,
      identitySkippedOlder,
    },
  };
}

export interface DreamRunResult {
  date: string;
  kind: 'empty' | 'completed' | 'failed';
  error?: string;
  commit?: DreamCommitResult;
}

/**
 * Full in-process dream loop for one date: plan → LLM (fragments when the
 * day is long) → parse retry → self-identity expansion retry → commit.
 */
export async function runDream(
  paths: MetabotPaths,
  input: {
    date: string;
    llm?: string | null;
    limits?: Partial<DreamModelLimits>;
    isRepair?: boolean;
  },
  complete: DreamChatCompletion,
  deps: DreamServiceDeps = {},
): Promise<DreamRunResult> {
  const date = input.date;
  const llm = input.llm ?? null;
  try {
    const plan = await planDream(paths, { date, llm, limits: input.limits }, deps);
    if (plan.kind === 'empty') {
      return { date, kind: 'empty' };
    }

    let prompt: { system: string; user: string; maxOutputTokens: number };
    if (plan.kind === 'fragments') {
      const fragmentOutputs: Record<string, string> = {};
      for (const fragment of plan.fragments) {
        fragmentOutputs[fragment.fragmentKey] = await complete({
          system: fragment.system,
          user: fragment.user,
          maxOutputTokens: fragment.maxOutputTokens,
        });
      }
      const synthesis = await synthesizeDream(paths, {
        date,
        llm,
        limits: input.limits,
        fragmentOutputs,
      }, deps);
      prompt = synthesis;
    } else {
      prompt = plan;
    }

    const generateAndParse = async (user: string): Promise<{ output: DreamOutput; raw: string }> => {
      const firstRaw = await complete({
        system: prompt.system,
        user,
        maxOutputTokens: prompt.maxOutputTokens,
      });
      const first = parseDreamOutput(firstRaw);
      if (first.ok) return { output: first.output, raw: firstRaw };
      const retryRaw = await complete({
        system: prompt.system,
        user: `${user}\n\n(上一次输出无法解析:${first.error}。请严格只输出一个 JSON 对象,不要输出任何其他文字。)`,
        maxOutputTokens: prompt.maxOutputTokens,
      });
      const retry = parseDreamOutput(retryRaw);
      if (retry.ok) return { output: retry.output, raw: retryRaw };
      throw new Error(`dream output unparseable after retry: ${retry.error}`);
    };

    let { output } = await generateAndParse(prompt.user);

    // One expansion retry when self_identity is missing or under the minimum.
    if (!input.isRepair && !validateSelfIdentity(output.selfIdentity).valid) {
      const charCount = countChars(output.selfIdentity);
      const retryRaw = await complete({
        system: prompt.system,
        user: `${prompt.user}\n\n(上一次的 self_identity ${output.selfIdentity ? `只有 ${charCount} 个非空白字符` : '缺失'}。请重新输出完整 JSON,其中 self_identity 不少于 200 个非空白字符,认真写一段「我是谁」。)`,
        maxOutputTokens: prompt.maxOutputTokens,
      });
      const retry = parseDreamOutput(retryRaw);
      if (retry.ok && validateSelfIdentity(retry.output.selfIdentity).valid) {
        output = retry.output;
      } else if (retry.ok && !output.selfIdentity) {
        output = retry.output;
      }
    }

    const commit = await commitDream(paths, {
      date,
      outputText: JSON.stringify(outputToJson(output)),
      llm,
      isRepair: input.isRepair,
    }, deps);
    return { date, kind: commit.ok ? 'completed' : 'failed', error: commit.error, commit };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const dreamStore = deps.dreamStore ?? createDreamStore(paths);
    await dreamStore.finishRun(date, 'failed', message).catch(() => undefined);
    return { date, kind: 'failed', error: message };
  }
}

function countChars(text: string | null | undefined): number {
  return [...String(text ?? '')].filter((char) => !/\s/.test(char)).length;
}

/** Serialize a parsed DreamOutput back to the wire field names for commit. */
function outputToJson(output: DreamOutput): Record<string, unknown> {
  return {
    daily_summary: output.dailySummary,
    sections: output.sections,
    work_reviews: output.workReviews,
    important_memories: output.importantMemories,
    value_lessons: output.valueLessons,
    self_identity: output.selfIdentity,
    impression_updates: output.impressionUpdates,
    knowledge_points: output.knowledgeUpdates,
  };
}

/** Status snapshot for the UI Dream tab. */
export async function dreamStatus(
  paths: MetabotPaths,
  deps: DreamServiceDeps = {},
): Promise<{
  runs: DreamRun[];
  summaryCount: number;
  latestSummaryDate: string | null;
  hasSelfIdentity: boolean;
}> {
  const dreamStore = deps.dreamStore ?? createDreamStore(paths);
  const memoryStore = deps.memoryStore ?? createMemoryStore(paths);
  const runStates = await dreamStore.getRunStates();
  const summaries = await dreamStore.listDailySummaries({ limit: 90 });
  const identityEntries = await memoryStore.list({
    usageClass: 'self_identity',
    status: 'created',
    limit: 1,
  });
  return {
    runs: [...runStates.values()].sort((left, right) => right.dreamDate.localeCompare(left.dreamDate)),
    summaryCount: summaries.length,
    latestSummaryDate: summaries[0]?.summaryDate ?? null,
    hasSelfIdentity: identityEntries.length > 0,
  };
}
