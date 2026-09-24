"use strict";
/**
 * Daemon-side knowledge-base handler group: the /api/kb/* verbs. KB
 * management (list/create/update/remove/query/add-document/learn) ports the
 * `metabot knowledge-base *` CLI dependency handlers against
 * core/knowledgebase stores; the study verbs (study/status/enqueue/retry)
 * mirror the DSH `metaweb_study_*` tool semantics against
 * core/knowledgebase/studyJobs (the daemon nightly tick drains the queue).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryFailedStudyJobs = retryFailedStudyJobs;
exports.createKbDaemonHandlers = createKbDaemonHandlers;
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../core/contracts/commandResult");
const service_1 = require("../core/knowledgebase/service");
const studyJobs_1 = require("../core/knowledgebase/studyJobs");
const paths_1 = require("../core/state/paths");
/**
 * Shared failed-study-job retry selection + requeue (DSH metaweb_study_retry
 * semantics): an explicit jobId must exist for this bot; otherwise every
 * failed job matches, narrowed by an optional topic substring. Exported so the
 * CLI `knowledge-base study retry` dependency drives the exact same logic and
 * returns the exact same shape as the /api/kb/study/retry handler.
 */
async function retryFailedStudyJobs(input) {
    const rows = await input.store.listStudyJobs(input.slug);
    const jobId = input.jobId?.trim() ?? '';
    const topic = input.topic?.trim() ?? '';
    if (jobId && rows.every((job) => job.id !== jobId)) {
        return { failure: (0, commandResult_1.commandFailed)('study_job_not_found', `No study job with id "${jobId}" for this bot.`) };
    }
    const targets = rows.filter((job) => {
        if (job.status !== 'failed')
            return false;
        if (jobId)
            return job.id === jobId;
        if (topic)
            return job.topic.toLowerCase().includes(topic.toLowerCase());
        return true;
    });
    const retried = [];
    for (const job of targets) {
        const result = await input.store.retryStudyJob(job.id);
        if (result?.retried)
            retried.push(result.job);
    }
    return { retried };
}
function readPositiveInt(value) {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}
function createKbDaemonHandlers(input) {
    return {
        list: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const service = (0, service_1.createKnowledgeBaseService)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            // Ensure the default KB like IDBots does (every metabot owns one), so
            // the UI always shows a save target.
            await service.ensureDefaultKnowledgeBase(bot.slug).catch(() => undefined);
            const knowledgeBases = await service.store.listKnowledgeBases();
            return (0, commandResult_1.commandSuccess)({ knowledgeBases });
        },
        create: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const paths = (0, paths_1.resolveMetabotPaths)(bot.homeDir);
            const service = (0, service_1.createKnowledgeBaseService)(paths);
            const knowledgeBase = await service.store.createKnowledgeBase({
                metabotSlug: node_path_1.default.basename(paths.profileRoot),
                name: rawInput?.name ?? '',
                ...(rawInput?.description ? { description: rawInput.description } : {}),
                ...(rawInput?.rawDir ? { rawDir: rawInput.rawDir } : {}),
                ...(rawInput?.autoLearn !== undefined ? { autoLearn: rawInput.autoLearn } : {}),
            });
            return (0, commandResult_1.commandSuccess)({ knowledgeBase });
        },
        update: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const paths = (0, paths_1.resolveMetabotPaths)(bot.homeDir);
            const service = (0, service_1.createKnowledgeBaseService)(paths);
            const slug = node_path_1.default.basename(paths.profileRoot);
            const existing = await service.store.getKnowledgeBase(rawInput?.id ?? '');
            if (!existing || existing.metabotSlug !== slug) {
                return (0, commandResult_1.commandFailed)('kb_not_found', `Knowledge base ${rawInput?.id ?? ''} not found for this Bot.`);
            }
            const knowledgeBase = await service.store.updateKnowledgeBase(rawInput?.id ?? '', {
                ...(rawInput?.name ? { name: rawInput.name } : {}),
                ...(rawInput?.description ? { description: rawInput.description } : {}),
                ...(rawInput?.autoLearn !== undefined ? { autoLearn: rawInput.autoLearn } : {}),
            });
            return (0, commandResult_1.commandSuccess)({ knowledgeBase });
        },
        remove: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const paths = (0, paths_1.resolveMetabotPaths)(bot.homeDir);
            const service = (0, service_1.createKnowledgeBaseService)(paths);
            const slug = node_path_1.default.basename(paths.profileRoot);
            const existing = await service.store.getKnowledgeBase(rawInput?.id ?? '');
            if (!existing || existing.metabotSlug !== slug) {
                return (0, commandResult_1.commandFailed)('kb_not_found', `Knowledge base ${rawInput?.id ?? ''} not found for this Bot.`);
            }
            const removed = await service.store.removeKnowledgeBase(rawInput?.id ?? '');
            return (0, commandResult_1.commandSuccess)({ removed, knowledgeBaseId: rawInput?.id ?? '' });
        },
        query: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const service = (0, service_1.createKnowledgeBaseService)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const results = await service.queryKnowledgeBase(node_path_1.default.basename((0, paths_1.resolveMetabotPaths)(bot.homeDir).profileRoot), rawInput?.text ?? '', {
                ...(rawInput?.id ? { knowledgeBaseId: rawInput.id } : {}),
                ...(rawInput?.topK != null ? { topK: rawInput.topK } : {}),
                ...(rawInput?.minScore != null ? { minScore: rawInput.minScore } : {}),
            });
            return (0, commandResult_1.commandSuccess)({ results });
        },
        addDocument: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const service = (0, service_1.createKnowledgeBaseService)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const saved = await service.addDocument(node_path_1.default.basename((0, paths_1.resolveMetabotPaths)(bot.homeDir).profileRoot), {
                title: rawInput?.title ?? '',
                content: rawInput?.content ?? '',
                ...(rawInput?.id ? { knowledgeBaseId: rawInput.id } : {}),
                ...(rawInput?.sourceType ? { sourceType: rawInput.sourceType } : {}),
                ...(rawInput?.url ? { url: rawInput.url } : {}),
                ...(rawInput?.pinId ? { pinId: rawInput.pinId } : {}),
                ...(rawInput?.tags ? { tags: rawInput.tags } : {}),
            });
            return (0, commandResult_1.commandSuccess)({ knowledgeBase: saved.knowledgeBase, relPath: saved.relPath, indexed: saved.indexed });
        },
        learn: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const service = (0, service_1.createKnowledgeBaseService)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const knowledgeBase = await service.learnKnowledgeBase(node_path_1.default.basename((0, paths_1.resolveMetabotPaths)(bot.homeDir).profileRoot), rawInput?.id, rawInput?.full === true);
            return (0, commandResult_1.commandSuccess)({ knowledgeBase });
        },
        studyList: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, studyJobs_1.createStudyJobStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const jobs = await store.listStudyJobs(bot.slug);
            return (0, commandResult_1.commandSuccess)({ jobs });
        },
        studyEnqueue: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, studyJobs_1.createStudyJobStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const result = await store.enqueueStudyJob({
                metabotSlug: bot.slug,
                topic: rawInput?.topic ?? '',
                ...(readPositiveInt(rawInput?.budgetPins) !== undefined
                    ? { budgetPins: readPositiveInt(rawInput?.budgetPins) }
                    : {}),
            });
            return (0, commandResult_1.commandSuccess)({ job: result.job, created: result.created });
        },
        studyRetry: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const store = (0, studyJobs_1.createStudyJobStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const outcome = await retryFailedStudyJobs({
                store,
                slug: bot.slug,
                ...(typeof rawInput?.jobId === 'string' ? { jobId: rawInput.jobId } : {}),
                ...(typeof rawInput?.topic === 'string' ? { topic: rawInput.topic } : {}),
            });
            if ('failure' in outcome)
                return outcome.failure;
            return (0, commandResult_1.commandSuccess)({ retried: outcome.retried, count: outcome.retried.length });
        },
    };
}
