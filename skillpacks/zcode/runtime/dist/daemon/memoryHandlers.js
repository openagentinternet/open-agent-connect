"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMemoryDaemonHandlers = createMemoryDaemonHandlers;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../core/contracts/commandResult");
const chatPersonaLoader_1 = require("../core/chat/chatPersonaLoader");
const hostLlmExecutorBridge_1 = require("../core/llm/hostLlmExecutorBridge");
const llmBindingStore_1 = require("../core/llm/llmBindingStore");
const llmRuntimeResolver_1 = require("../core/llm/llmRuntimeResolver");
const llmRuntimeStore_1 = require("../core/llm/llmRuntimeStore");
const llmRuntimeExecution_1 = require("../core/llm/llmRuntimeExecution");
const contactNames_1 = require("../core/memory/contactNames");
const experiencePromptBlocks_1 = require("../core/memory/experiencePromptBlocks");
const dreamStore_1 = require("../core/memory/dreamStore");
const dreamPrompt_1 = require("../core/memory/dreamPrompt");
const experienceStore_1 = require("../core/memory/experienceStore");
const hygieneStore_1 = require("../core/memory/hygieneStore");
const impressionStore_1 = require("../core/memory/impressionStore");
const knowledgeStore_1 = require("../core/memory/knowledgeStore");
const knowledgePromptBlocks_1 = require("../core/memory/knowledgePromptBlocks");
const memoryHygieneService_1 = require("../core/memory/memoryHygieneService");
const memoryPolicy_1 = require("../core/memory/memoryPolicy");
const memoryStore_1 = require("../core/memory/memoryStore");
const transcriptStore_1 = require("../core/memory/transcriptStore");
const paths_1 = require("../core/state/paths");
const HYGIENE_LLM_TIMEOUT_MS = 180_000;
function createMemoryDaemonHandlers(input) {
    async function readPreferredLlmRuntimeId(paths) {
        try {
            const raw = await node_fs_1.promises.readFile(paths.preferredLlmRuntimePath, 'utf8');
            const data = JSON.parse(raw);
            return typeof data.runtimeId === 'string' ? data.runtimeId : null;
        }
        catch {
            return null;
        }
    }
    return {
        list: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, memoryStore_1.createMemoryStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const entries = await store.list({
                ...(rawInput?.scopeKind ? { scopeKind: rawInput.scopeKind } : {}),
                ...(rawInput?.scopeKey ? { scopeKey: rawInput.scopeKey } : {}),
                ...(rawInput?.usageClass ? { usageClass: rawInput.usageClass } : {}),
                ...(rawInput?.status ? { status: rawInput.status } : {}),
                ...(rawInput?.origin ? { origin: rawInput.origin } : {}),
                ...(rawInput?.query ? { query: rawInput.query } : {}),
                ...(rawInput?.limit !== undefined ? { limit: rawInput.limit } : {}),
                ...(rawInput?.includeDeleted ? { includeDeleted: true } : {}),
                ...(rawInput?.includeArchived ? { includeArchived: true } : {}),
            });
            return (0, commandResult_1.commandSuccess)({ entries });
        },
        add: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, memoryStore_1.createMemoryStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const payload = rawInput?.payload ?? {};
            const memory = await store.create({
                text: String(payload.text ?? ''),
                ...(typeof payload.scopeKind === 'string' ? { scopeKind: payload.scopeKind } : {}),
                ...(typeof payload.scopeKey === 'string' ? { scopeKey: payload.scopeKey } : {}),
                ...(typeof payload.usageClass === 'string' ? { usageClass: payload.usageClass } : {}),
                ...(typeof payload.visibility === 'string' ? { visibility: payload.visibility } : {}),
                ...(typeof payload.confidence === 'number' ? { confidence: payload.confidence } : {}),
                ...(typeof payload.isExplicit === 'boolean' ? { isExplicit: payload.isExplicit } : {}),
                ...(typeof payload.origin === 'string' ? { origin: payload.origin } : {}),
                ...(payload.source && typeof payload.source === 'object' && !Array.isArray(payload.source)
                    ? { source: payload.source }
                    : {}),
            });
            return (0, commandResult_1.commandSuccess)({ memory });
        },
        update: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, memoryStore_1.createMemoryStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const payload = rawInput?.payload ?? {};
            const memory = await store.update({
                id: String(payload.id ?? ''),
                ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
                ...(typeof payload.scopeKind === 'string' ? { scopeKind: payload.scopeKind } : {}),
                ...(typeof payload.scopeKey === 'string' ? { scopeKey: payload.scopeKey } : {}),
                ...(typeof payload.usageClass === 'string' ? { usageClass: payload.usageClass } : {}),
                ...(typeof payload.visibility === 'string' ? { visibility: payload.visibility } : {}),
                ...(typeof payload.confidence === 'number' ? { confidence: payload.confidence } : {}),
                ...(typeof payload.isExplicit === 'boolean' ? { isExplicit: payload.isExplicit } : {}),
                ...(typeof payload.status === 'string' ? { status: payload.status } : {}),
            });
            if (!memory) {
                return (0, commandResult_1.commandFailed)('not_found', 'Memory entry not found in the resolved scope (or it is protected).');
            }
            return (0, commandResult_1.commandSuccess)({ memory });
        },
        delete: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, memoryStore_1.createMemoryStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const payload = rawInput?.payload ?? {};
            const deleted = await store.remove({
                id: String(payload.id ?? ''),
                ...(typeof payload.scopeKind === 'string' ? { scopeKind: payload.scopeKind } : {}),
                ...(typeof payload.scopeKey === 'string' ? { scopeKey: payload.scopeKey } : {}),
            });
            if (!deleted) {
                return (0, commandResult_1.commandFailed)('not_found', 'Memory entry not found in the resolved scope (or it is protected).');
            }
            return (0, commandResult_1.commandSuccess)({ deleted: true });
        },
        unarchive: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, memoryStore_1.createMemoryStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const restored = await store.unarchiveMemories([String(rawInput?.payload?.id ?? '')]);
            if (restored === 0) {
                return (0, commandResult_1.commandFailed)('not_found', 'No archived memory entry with that id.');
            }
            return (0, commandResult_1.commandSuccess)({ restored });
        },
        search: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const payload = rawInput?.payload ?? {};
            const records = await (0, transcriptStore_1.searchConversations)((0, paths_1.resolveMetabotPaths)(bot.homeDir), {
                query: String(payload.query ?? ''),
                ...(typeof payload.maxResults === 'number' ? { maxResults: payload.maxResults } : {}),
                ...(typeof payload.before === 'number' ? { before: payload.before } : {}),
                ...(typeof payload.after === 'number' ? { after: payload.after } : {}),
            });
            return (0, commandResult_1.commandSuccess)({ records });
        },
        recall: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const paths = (0, paths_1.resolveMetabotPaths)(bot.homeDir);
            const payload = rawInput?.payload ?? {};
            const dreamStore = (0, dreamStore_1.createDreamStore)(paths);
            const query = (0, experiencePromptBlocks_1.resolveExperienceRecallQuery)({
                query: typeof payload.query === 'string' ? payload.query : undefined,
                date_from: typeof payload.dateFrom === 'string' ? payload.dateFrom : undefined,
                date_to: typeof payload.dateTo === 'string' ? payload.dateTo : undefined,
                granularity: typeof payload.granularity === 'string'
                    ? payload.granularity
                    : undefined,
                ...(typeof payload.limit === 'number' ? { limit: payload.limit } : {}),
            });
            const summaries = await dreamStore.searchDailySummaries({
                query: query.query,
                dateFrom: query.dateFrom,
                dateTo: query.dateTo,
                limit: query.limit,
            });
            let text;
            if (summaries.length > 0) {
                text = (0, experiencePromptBlocks_1.formatExperienceRecallResults)(summaries.map((summary) => ({
                    summaryDate: summary.summaryDate,
                    summaryText: summary.summaryText,
                    sessionRefs: summary.sessionRefs,
                })), query.granularity);
            }
            else {
                // Raw-episode timeline fallback so un-dreamed days are never blind.
                const experienceStore = (0, experienceStore_1.createExperienceStore)(paths);
                const fromTime = query.dateFrom ? (0, dreamPrompt_1.getDayBoundsMs)(query.dateFrom).startMs : undefined;
                const toTime = query.dateTo ? (0, dreamPrompt_1.getDayBoundsMs)(query.dateTo).endMs : undefined;
                const episodes = await experienceStore.listEpisodes({
                    ...(fromTime !== undefined ? { fromTime } : {}),
                    ...(toTime !== undefined ? { toTime } : {}),
                    limit: 30,
                });
                text = (0, experiencePromptBlocks_1.formatExperienceTimelineFallback)({
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
            return (0, commandResult_1.commandSuccess)({ text, summaries, query });
        },
        knowledgeList: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, knowledgeStore_1.createKnowledgeStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const entries = await store.listKnowledge({
                ...(rawInput?.kind ? { kind: rawInput.kind } : {}),
                ...(rawInput?.category ? { category: rawInput.category } : {}),
                ...(rawInput?.status ? { status: rawInput.status } : {}),
                ...(rawInput?.query ? { query: rawInput.query } : {}),
                ...(rawInput?.limit !== undefined ? { limit: rawInput.limit } : {}),
            });
            return (0, commandResult_1.commandSuccess)({ entries });
        },
        knowledgeUpsert: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, knowledgeStore_1.createKnowledgeStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const payload = rawInput?.payload ?? {};
            const result = await store.upsertKnowledge({
                topic: String(payload.topic ?? ''),
                summary: String(payload.summary ?? ''),
                ...(typeof payload.kind === 'string' ? { kind: payload.kind } : {}),
                ...(typeof payload.category === 'string' ? { category: payload.category } : {}),
                ...(Array.isArray(payload.tags)
                    ? { tags: payload.tags.filter((tag) => typeof tag === 'string') }
                    : {}),
                ...(typeof payload.origin === 'string' ? { origin: payload.origin } : {}),
                ...(Array.isArray(payload.sources)
                    ? { sources: payload.sources }
                    : {}),
            });
            return (0, commandResult_1.commandSuccess)({
                entry: result.entry,
                created: result.created,
                revised: result.revised,
                text: (0, knowledgePromptBlocks_1.formatKnowledgeUpsertResult)({
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
            if ('failure' in bot)
                return bot.failure;
            const store = (0, knowledgeStore_1.createKnowledgeStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const payload = rawInput?.payload ?? {};
            const entry = await store.updateKnowledge({
                id: String(payload.id ?? ''),
                ...(typeof payload.topic === 'string' ? { topic: payload.topic } : {}),
                ...(typeof payload.summary === 'string' ? { summary: payload.summary } : {}),
                ...(typeof payload.kind === 'string' ? { kind: payload.kind } : {}),
            });
            if (!entry)
                return (0, commandResult_1.commandFailed)('not_found', 'Knowledge entry not found.');
            return (0, commandResult_1.commandSuccess)({ entry });
        },
        knowledgeArchive: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, knowledgeStore_1.createKnowledgeStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const entry = await store.archiveKnowledge(String(rawInput?.payload?.id ?? ''));
            if (!entry)
                return (0, commandResult_1.commandFailed)('not_found', 'Knowledge entry not found.');
            return (0, commandResult_1.commandSuccess)({ entry });
        },
        knowledgeDelete: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, knowledgeStore_1.createKnowledgeStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const deleted = await store.deleteKnowledge(String(rawInput?.payload?.id ?? ''));
            if (!deleted)
                return (0, commandResult_1.commandFailed)('not_found', 'Knowledge entry not found.');
            return (0, commandResult_1.commandSuccess)({ deleted: true });
        },
        impressionsList: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const paths = (0, paths_1.resolveMetabotPaths)(bot.homeDir);
            const persona = await (0, chatPersonaLoader_1.loadChatPersona)(paths);
            const observerGlobalMetaId = persona.identity?.globalMetaId ?? '';
            if (!observerGlobalMetaId) {
                return (0, commandResult_1.commandFailed)('identity_missing', 'No local MetaBot identity is loaded for this profile.');
            }
            const store = (0, impressionStore_1.createImpressionStore)(paths);
            const snapshots = await store.listSnapshots(observerGlobalMetaId);
            const names = await (0, contactNames_1.resolveContactNames)(paths, snapshots.map((s) => s.subjectGlobalMetaId));
            const rows = snapshots.map((s) => ({
                ...s,
                subjectName: names.get(s.subjectGlobalMetaId) ?? null,
            }));
            return (0, commandResult_1.commandSuccess)({ observerGlobalMetaId, snapshots: rows });
        },
        impressionsShow: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const paths = (0, paths_1.resolveMetabotPaths)(bot.homeDir);
            const persona = await (0, chatPersonaLoader_1.loadChatPersona)(paths);
            const observerGlobalMetaId = persona.identity?.globalMetaId ?? '';
            if (!observerGlobalMetaId) {
                return (0, commandResult_1.commandFailed)('identity_missing', 'No local MetaBot identity is loaded for this profile.');
            }
            const store = (0, impressionStore_1.createImpressionStore)(paths);
            const snapshot = await store.getSnapshot(observerGlobalMetaId, rawInput?.subject ?? '');
            const observations = await store.listObservations({
                observerGlobalMetaId,
                subjectGlobalMetaId: rawInput?.subject ?? '',
                includeSuperseded: true,
            });
            const names = await (0, contactNames_1.resolveContactNames)(paths, [rawInput?.subject ?? '']);
            const namedSnapshot = snapshot
                ? { ...snapshot, subjectName: names.get(rawInput?.subject ?? '') ?? null }
                : snapshot;
            return (0, commandResult_1.commandSuccess)({
                observerGlobalMetaId,
                subject: rawInput?.subject ?? '',
                snapshot: namedSnapshot,
                observations,
            });
        },
        policyGet: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, memoryPolicy_1.createMemoryPolicyStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            return (0, commandResult_1.commandSuccess)({
                effective: await store.effectivePolicy(),
                override: await store.readOverride(),
            });
        },
        policySet: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, memoryPolicy_1.createMemoryPolicyStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
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
            ];
            const updates = {};
            for (const key of allowed) {
                if (rawInput?.payload?.[key] !== undefined)
                    updates[key] = rawInput.payload[key];
            }
            const policy = await store.setOverride(updates);
            return (0, commandResult_1.commandSuccess)({ policy });
        },
        policyDelete: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, memoryPolicy_1.createMemoryPolicyStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            return (0, commandResult_1.commandSuccess)({ deleted: await store.deleteOverride() });
        },
        hygieneStatus: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const paths = (0, paths_1.resolveMetabotPaths)(bot.homeDir);
            const policyStore = (0, memoryPolicy_1.createMemoryPolicyStore)(paths);
            const hygieneStore = (0, hygieneStore_1.createHygieneStore)(paths);
            const [config, ledger, due] = await Promise.all([
                policyStore.getHygieneConfig(),
                hygieneStore.getLedger(),
                (0, memoryHygieneService_1.memoryHygieneDue)(paths),
            ]);
            return (0, commandResult_1.commandSuccess)({
                config,
                lastRun: ledger.lastRun,
                deepConsolidationLastRunAt: ledger.deepConsolidationLastRunAt,
                due,
            });
        },
        hygieneDue: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            return (0, commandResult_1.commandSuccess)(await (0, memoryHygieneService_1.memoryHygieneDue)((0, paths_1.resolveMetabotPaths)(bot.homeDir)));
        },
        hygieneRun: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const paths = (0, paths_1.resolveMetabotPaths)(bot.homeDir);
            const slug = node_path_1.default.basename(paths.profileRoot);
            const llmExecutor = input.llmExecutor ?? null;
            const runtimeResolver = (0, llmRuntimeResolver_1.createLlmRuntimeResolver)({
                runtimeStore: (0, llmRuntimeStore_1.createLlmRuntimeStore)(paths),
                bindingStore: (0, llmBindingStore_1.createLlmBindingStore)(paths),
                getPreferredRuntimeId: () => readPreferredLlmRuntimeId(paths),
            });
            // The deep-consolidation call: DSH pair first, then the local chain.
            // No healthy runtime binding = skip (null), never fail; a started run
            // that errors mid-call lands in the run's error list via a throw.
            const complete = async (request) => {
                const hostText = await (0, hostLlmExecutorBridge_1.createHostFirstCompletion)({
                    dshLlmPath: paths.dshLlmPath,
                    timeoutMs: HYGIENE_LLM_TIMEOUT_MS,
                })({ botSlug: slug, system: request.system, user: request.user });
                if (hostText !== null)
                    return hostText;
                if (!llmExecutor)
                    return null;
                const outcome = await (0, llmRuntimeExecution_1.runLlmPromptWithRuntimeFallback)({
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
                const stats = await (0, memoryHygieneService_1.runMemoryHygiene)(paths, {
                    trigger: 'manual',
                    deep: rawInput?.noDeep ? false : undefined,
                    complete,
                });
                return (0, commandResult_1.commandSuccess)(stats);
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('hygiene_run_failed', error instanceof Error ? error.message : String(error));
            }
        },
        hygieneConfigGet: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, memoryPolicy_1.createMemoryPolicyStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            return (0, commandResult_1.commandSuccess)({ config: await store.getHygieneConfig() });
        },
        hygieneConfigSet: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, memoryPolicy_1.createMemoryPolicyStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const config = await store.setHygieneConfig(rawInput?.payload ?? {});
            return (0, commandResult_1.commandSuccess)({ config });
        },
    };
}
