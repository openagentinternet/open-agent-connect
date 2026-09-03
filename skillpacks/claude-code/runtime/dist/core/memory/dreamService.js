"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDreamBudgets = resolveDreamBudgets;
exports.failDream = failDream;
exports.dueDreamDates = dueDreamDates;
exports.planDream = planDream;
exports.synthesizeDream = synthesizeDream;
exports.commitDream = commitDream;
exports.runDream = runDream;
exports.dreamStatus = dreamStatus;
// Dream orchestration, ported from IDBots src/main/services/dreamService.ts.
// The write pipeline (diary, dream-memory batch replace, forward-only
// self-identity, impression/knowledge hooks) lives here in the CLI core; the
// LLM transport is injected, so the DSH plugin can drive the same pipeline
// across the process boundary with `ctx.llm` (plan → LLM → commit), while
// standalone hosts use runDream with a local completion function.
const chatPersonaLoader_1 = require("../chat/chatPersonaLoader");
const dreamFragments_1 = require("./dreamFragments");
const dreamPrompt_1 = require("./dreamPrompt");
const dreamStore_1 = require("./dreamStore");
const experienceHarvest_1 = require("./experienceHarvest");
const experienceStore_1 = require("./experienceStore");
const impressionStore_1 = require("./impressionStore");
const impressionService_1 = require("./impressionService");
const knowledgeStore_1 = require("./knowledgeStore");
const memoryStore_1 = require("./memoryStore");
const node_path_1 = __importDefault(require("node:path"));
const DEFAULT_MODEL_LIMITS = { contextWindow: 128_000, maxOutputTokens: 8192 };
const DREAM_LLM_TARGET_MAX_TOKENS = 32_768;
const DREAM_CONTEXT_RESERVE_TOKENS = 8_000;
const DREAM_FAST_PATH_MAX_TOKENS = 96_000;
const DREAM_CHUNK_MAX_TOKENS = 64_000;
const DREAM_FRAGMENT_MAX_TOKENS = 4_096;
/** A run left `running` longer than this is treated as crashed and reset. */
const STALE_RUNNING_RESET_MS = 30 * 60 * 1000;
const EVALUATION_LABELS = {
    warming: '升温',
    stable: '持平',
    cooling: '降温',
};
function resolveDreamBudgets(limits) {
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
async function loadDreamPersona(paths) {
    const persona = await (0, chatPersonaLoader_1.loadChatPersona)(paths);
    const slug = node_path_1.default.basename(paths.profileRoot);
    return {
        botName: persona.identity?.name || slug,
        role: persona.role || null,
        soul: persona.soul || null,
        globalMetaId: persona.identity?.globalMetaId || null,
    };
}
function resolveDreamStores(paths, deps) {
    const experienceStore = deps.experienceStore ?? (0, experienceStore_1.createExperienceStore)(paths);
    return {
        dreamStore: deps.dreamStore ?? (0, dreamStore_1.createDreamStore)(paths),
        memoryStore: deps.memoryStore ?? (0, memoryStore_1.createMemoryStore)(paths),
        experienceStore,
        impressionStore: deps.impressionStore ?? (0, impressionStore_1.createImpressionStore)(paths, { experienceStore }),
        knowledgeStore: deps.knowledgeStore ?? (0, knowledgeStore_1.createKnowledgeStore)(paths),
    };
}
/**
 * Reset a run left `running` by a crashed attempt so the date becomes
 * plannable again (the due-date algorithm skips `running` dates).
 */
async function resetStaleRunningRun(store, date) {
    const run = await store.getRun(date);
    if (run?.status === 'running' && Date.now() - run.startedAt > STALE_RUNNING_RESET_MS) {
        await store.finishRun(date, 'failed', 'stale running run reset');
    }
}
/**
 * Mark the live run for one date as failed. The DSH plugin drives dreams
 * across a process boundary (plan/commit in the CLI, LLM in the host), so
 * transport and LLM failures above the store layer would otherwise leave the
 * run `running` forever. No-op unless a run is currently `running` — terminal
 * states are never overwritten.
 */
async function failDream(paths, input, deps = {}) {
    const dreamStore = deps.dreamStore ?? (0, dreamStore_1.createDreamStore)(paths);
    const run = await dreamStore.getRun(input.date);
    if (!run || run.status !== 'running')
        return { failed: false };
    await dreamStore.finishRun(input.date, 'failed', input.error ?? 'dream run failed');
    return { failed: true };
}
/** Which past dates still need dream attention for this bot. */
async function dueDreamDates(paths, input = {}, deps = {}) {
    const dreamStore = deps.dreamStore ?? (0, dreamStore_1.createDreamStore)(paths);
    // Sweep first: the due algorithm skips `running` dates, so runs orphaned by
    // a restart (the plugin process dies mid-dream) must be failed here or they
    // never become due again.
    await dreamStore.resetStaleRunningRuns({ staleMs: STALE_RUNNING_RESET_MS });
    const runStates = await dreamStore.getRunStates();
    const slug = node_path_1.default.basename(paths.profileRoot);
    return (0, dreamPrompt_1.computeDueDreamDates)({
        now: input.now ?? new Date(),
        staggerSeed: (0, dreamPrompt_1.dreamStaggerSeedForSlug)(slug),
        runStates,
        dreamVersion: dreamPrompt_1.DREAM_VERSION,
    });
}
/**
 * Gather the day, decide fast vs fragmented, begin the run, and return the
 * prompt(s) the caller must run through an LLM. Empty days record a completed
 * run without any LLM call.
 */
async function planDream(paths, input, deps = {}) {
    const stores = resolveDreamStores(paths, deps);
    const { dreamStore } = stores;
    const date = input.date;
    const llm = input.llm ?? null;
    await resetStaleRunningRun(dreamStore, date);
    const { startMs, endMs } = (0, dreamPrompt_1.getDayBoundsMs)(date);
    const activity = await dreamStore.gatherActivity({ startMs, endMs });
    const persona = await loadDreamPersona(paths);
    const budgets = resolveDreamBudgets(input.limits);
    // Fold the day's group-task chats / accepted tasks / seller orders into the
    // experience ledger before building impression subjects, so the dream has
    // episodes to consolidate. Best effort: a harvest failure never fails a run.
    if (persona.globalMetaId) {
        try {
            await (0, experienceHarvest_1.harvestDreamDayExperiences)({
                paths,
                experienceStore: stores.experienceStore,
                observerGlobalMetaId: persona.globalMetaId,
                date,
                startMs,
                endMs,
            });
        }
        catch {
            // The dream pipeline continues with whatever the ledger already holds.
        }
    }
    const impressionSubjects = persona.globalMetaId
        ? await (0, impressionService_1.buildDreamImpressionSubjects)({
            experienceStore: stores.experienceStore,
            impressionStore: stores.impressionStore,
            observerGlobalMetaId: persona.globalMetaId,
            fromTime: startMs,
            toTime: endMs,
        })
        : [];
    const existingKnowledge = await stores.knowledgeStore.listKnowledgeForDream(60);
    if (activity.sessions.length === 0
        && activity.taskRuns.length === 0
        && activity.groupTasks.length === 0
        && (activity.groupChats?.length ?? 0) === 0
        && (activity.chainWrites?.length ?? 0) === 0
        && (activity.chainReads?.length ?? 0) === 0
        && impressionSubjects.length === 0) {
        // Nothing happened that day — no LLM call, no summary, still recorded.
        await dreamStore.beginRun(date, llm, dreamPrompt_1.DREAM_VERSION);
        await dreamStore.finishRun(date, 'completed');
        return { kind: 'empty', date };
    }
    await dreamStore.beginRun(date, llm, dreamPrompt_1.DREAM_VERSION);
    const estimatedTokens = (0, dreamFragments_1.estimateDreamActivityTokens)(activity);
    if (estimatedTokens <= budgets.fastPathInputTokens) {
        const prompt = (0, dreamPrompt_1.buildDreamPrompt)({
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
    const chunks = (0, dreamFragments_1.chunkDreamActivity)(activity, budgets.fragmentInputTokens);
    if (chunks.length === 0) {
        const prompt = (0, dreamPrompt_1.buildDreamPrompt)({
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
    const needed = [];
    const cachedFragmentKeys = [];
    for (const chunk of chunks) {
        const contentHash = (0, dreamStore_1.hashDreamFragmentContent)(chunk);
        const existing = await dreamStore.getFragment(date, chunk.fragmentKey);
        if (existing?.status === 'completed'
            && existing.contentHash === contentHash
            && existing.dreamVersion === dreamPrompt_1.DREAM_VERSION
            && existing.llm === llm
            && existing.summaryJson) {
            cachedFragmentKeys.push(chunk.fragmentKey);
            continue;
        }
        const prompt = (0, dreamPrompt_1.buildDreamFragmentPrompt)({
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
async function synthesizeDream(paths, input, deps = {}) {
    const stores = resolveDreamStores(paths, deps);
    const dreamStore = stores.dreamStore;
    const date = input.date;
    const llm = input.llm ?? null;
    const budgets = resolveDreamBudgets(input.limits);
    for (const [fragmentKey, raw] of Object.entries(input.fragmentOutputs)) {
        const parsed = (0, dreamPrompt_1.parseDreamOutput)(raw);
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
            dreamVersion: dreamPrompt_1.DREAM_VERSION,
            error: parsed.ok ? null : parsed.error,
            attemptCount: (existing?.attemptCount ?? 0) + 1,
            createdAt: existing?.createdAt ?? Date.now(),
            updatedAt: Date.now(),
        });
    }
    // Rebuild the chunk list to collect every fragment (cached + fresh).
    const { startMs, endMs } = (0, dreamPrompt_1.getDayBoundsMs)(date);
    const activity = await dreamStore.gatherActivity({ startMs, endMs });
    const chunks = (0, dreamFragments_1.chunkDreamActivity)(activity, budgets.fragmentInputTokens);
    const summaries = [];
    const missing = [];
    for (const chunk of chunks) {
        const fragment = await dreamStore.getFragment(date, chunk.fragmentKey);
        if (fragment?.status !== 'completed' || !fragment.summaryJson) {
            missing.push(chunk.fragmentKey);
            continue;
        }
        let output = null;
        try {
            output = JSON.parse(fragment.summaryJson);
        }
        catch {
            const parsed = (0, dreamPrompt_1.parseDreamOutput)(fragment.summaryJson);
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
    const synthesisActivity = (0, dreamFragments_1.summariesToActivity)(summaries, activity.taskRuns, activity.orderCount, activity.groupTasks);
    const impressionSubjects = persona.globalMetaId
        ? await (0, impressionService_1.buildDreamImpressionSubjects)({
            experienceStore: stores.experienceStore,
            impressionStore: stores.impressionStore,
            observerGlobalMetaId: persona.globalMetaId,
            fromTime: startMs,
            toTime: endMs,
        })
        : [];
    const existingKnowledge = await stores.knowledgeStore.listKnowledgeForDream(60);
    const prompt = (0, dreamPrompt_1.buildDreamPrompt)({
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
async function commitDream(paths, input, deps = {}) {
    const stores = resolveDreamStores(paths, deps);
    const dreamStore = stores.dreamStore;
    const memoryStore = stores.memoryStore;
    const date = input.date;
    const isRepair = input.isRepair === true;
    const parsed = (0, dreamPrompt_1.parseDreamOutput)(input.outputText);
    if (!parsed.ok) {
        await dreamStore.finishRun(date, 'failed', parsed.error);
        return { ok: false, error: parsed.error };
    }
    const output = parsed.output;
    const { startMs, endMs } = (0, dreamPrompt_1.getDayBoundsMs)(date);
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
            chainWriteCount: activity.chainWrites?.length ?? 0,
            chainReadCount: activity.chainReads?.length ?? 0,
            messageCount: activity.sessions.reduce((sum, session) => sum + session.messages.length, 0),
            activityCharCount: activity.sessions.reduce((sum, session) => sum + session.messages.reduce((sessionSum, message) => sessionSum + message.content.length, 0), 0),
            estimatedActivityTokens: (0, dreamFragments_1.estimateDreamActivityTokens)(activity),
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
    const seenLessons = new Set();
    for (const lesson of output.valueLessons) {
        const text = lesson.source ? `${lesson.rule}(源自:${lesson.source})` : lesson.rule;
        if (seenLessons.has(text))
            continue;
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
    const seenReviews = new Set();
    for (const review of output.workReviews) {
        const text = [
            `工作:${review.subject}`,
            `对象:${review.counterparty || '未知'}`,
            `评价:${EVALUATION_LABELS[review.evaluation] ?? EVALUATION_LABELS.stable}`,
            review.note ? `依据:${review.note}` : '',
        ].filter(Boolean).join(';');
        if (seenReviews.has(text))
            continue;
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
        let latestIdentityDate = null;
        if (existing) {
            for (const source of existing.sources) {
                if (source.dreamDate && (!latestIdentityDate || source.dreamDate > latestIdentityDate)) {
                    latestIdentityDate = source.dreamDate;
                }
            }
        }
        if (latestIdentityDate && date < latestIdentityDate) {
            identitySkippedOlder = true;
        }
        else if (existing) {
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
        }
        else {
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
            const subjects = await (0, impressionService_1.buildDreamImpressionSubjects)({
                experienceStore: stores.experienceStore,
                impressionStore: stores.impressionStore,
                observerGlobalMetaId: persona.globalMetaId,
                fromTime: startMs,
                toTime: endMs,
            });
            await (0, impressionService_1.applyDreamImpressionUpdates)({
                impressionStore: stores.impressionStore,
                observerGlobalMetaId: persona.globalMetaId,
                dreamDate: date,
                dreamVersion: dreamPrompt_1.DREAM_VERSION,
                modelId: llm,
                subjects,
                updates: output.impressionUpdates,
            });
        }
        catch {
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
            }
            catch {
                // A single bad entry never aborts the rest of the batch.
            }
        }
    }
    await dreamStore.finishRun(date, 'completed');
    const identityValidation = (0, dreamPrompt_1.validateSelfIdentity)(output.selfIdentity);
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
/**
 * Full in-process dream loop for one date: plan → LLM (fragments when the
 * day is long) → parse retry → self-identity expansion retry → commit.
 */
async function runDream(paths, input, complete, deps = {}) {
    const date = input.date;
    const llm = input.llm ?? null;
    try {
        const plan = await planDream(paths, { date, llm, limits: input.limits }, deps);
        if (plan.kind === 'empty') {
            return { date, kind: 'empty' };
        }
        let prompt;
        if (plan.kind === 'fragments') {
            const fragmentOutputs = {};
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
        }
        else {
            prompt = plan;
        }
        const generateAndParse = async (user) => {
            const firstRaw = await complete({
                system: prompt.system,
                user,
                maxOutputTokens: prompt.maxOutputTokens,
            });
            const first = (0, dreamPrompt_1.parseDreamOutput)(firstRaw);
            if (first.ok)
                return { output: first.output, raw: firstRaw };
            const retryRaw = await complete({
                system: prompt.system,
                user: `${user}\n\n(上一次输出无法解析:${first.error}。请严格只输出一个 JSON 对象,不要输出任何其他文字。)`,
                maxOutputTokens: prompt.maxOutputTokens,
            });
            const retry = (0, dreamPrompt_1.parseDreamOutput)(retryRaw);
            if (retry.ok)
                return { output: retry.output, raw: retryRaw };
            throw new Error(`dream output unparseable after retry: ${retry.error}`);
        };
        let { output } = await generateAndParse(prompt.user);
        // One expansion retry when self_identity is missing or under the minimum.
        if (!input.isRepair && !(0, dreamPrompt_1.validateSelfIdentity)(output.selfIdentity).valid) {
            const charCount = countChars(output.selfIdentity);
            const retryRaw = await complete({
                system: prompt.system,
                user: `${prompt.user}\n\n(上一次的 self_identity ${output.selfIdentity ? `只有 ${charCount} 个非空白字符` : '缺失'}。请重新输出完整 JSON,其中 self_identity 不少于 200 个非空白字符,认真写一段「我是谁」。)`,
                maxOutputTokens: prompt.maxOutputTokens,
            });
            const retry = (0, dreamPrompt_1.parseDreamOutput)(retryRaw);
            if (retry.ok && (0, dreamPrompt_1.validateSelfIdentity)(retry.output.selfIdentity).valid) {
                output = retry.output;
            }
            else if (retry.ok && !output.selfIdentity) {
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const dreamStore = deps.dreamStore ?? (0, dreamStore_1.createDreamStore)(paths);
        await dreamStore.finishRun(date, 'failed', message).catch(() => undefined);
        return { date, kind: 'failed', error: message };
    }
}
function countChars(text) {
    return [...String(text ?? '')].filter((char) => !/\s/.test(char)).length;
}
/** Serialize a parsed DreamOutput back to the wire field names for commit. */
function outputToJson(output) {
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
async function dreamStatus(paths, deps = {}) {
    const dreamStore = deps.dreamStore ?? (0, dreamStore_1.createDreamStore)(paths);
    const memoryStore = deps.memoryStore ?? (0, memoryStore_1.createMemoryStore)(paths);
    // Same sweep as dueDreamDates: the UI must not show a phantom "running"
    // for a run orphaned by a restart days ago.
    await dreamStore.resetStaleRunningRuns({ staleMs: STALE_RUNNING_RESET_MS });
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
