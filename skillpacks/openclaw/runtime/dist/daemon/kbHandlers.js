"use strict";
/**
 * Daemon-side knowledge-base handler group: the /api/kb/* verbs. KB
 * management (list/create/update/remove/query/add-document/learn) ports the
 * `metabot knowledge-base *` CLI dependency handlers against
 * core/knowledgebase stores; the study verbs (study/status/enqueue/retry)
 * mirror the DSH `metaweb_study_*` tool semantics against
 * core/knowledgebase/studyJobs (the daemon nightly tick drains the queue).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setActiveStudyTurnRunner = setActiveStudyTurnRunner;
exports.retryFailedStudyJobs = retryFailedStudyJobs;
exports.createKbDaemonHandlers = createKbDaemonHandlers;
const commandResult_1 = require("../core/contracts/commandResult");
const service_1 = require("../core/knowledgebase/service");
const studyJobs_1 = require("../core/knowledgebase/studyJobs");
const paths_1 = require("../core/state/paths");
let activeStudyTurnRunner = null;
function setActiveStudyTurnRunner(runner) {
    activeStudyTurnRunner = runner;
}
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
            const service = (0, service_1.createKnowledgeBaseService)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const knowledgeBase = await service.store.createKnowledgeBase({
                // Single-source the owner slug from resolveBot (#12): the study verbs
                // already used bot.slug, while these KB verbs derived it from
                // basename(profileRoot) — the two disagreed when no Twin exists and
                // no --from was passed (effectiveSlug 'default' vs the dir basename).
                metabotSlug: bot.slug,
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
            const service = (0, service_1.createKnowledgeBaseService)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const existing = await service.store.getKnowledgeBase(rawInput?.id ?? '');
            if (!existing || existing.metabotSlug !== bot.slug) {
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
            const service = (0, service_1.createKnowledgeBaseService)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const existing = await service.store.getKnowledgeBase(rawInput?.id ?? '');
            if (!existing || existing.metabotSlug !== bot.slug) {
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
            const results = await service.queryKnowledgeBase(bot.slug, rawInput?.text ?? '', {
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
            const saved = await service.addDocument(bot.slug, {
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
            const knowledgeBase = await service.learnKnowledgeBase(bot.slug, rawInput?.id, rawInput?.full === true);
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
        // Manual study run (daylight-testing surface for the nightly drain):
        // resolve + claim the job now — window ignored — and let the turn run in
        // the daemon background. The route answers as soon as the job is claimed
        // (`running` in the store), so clients poll `study status` / studyList
        // for the outcome instead of holding the HTTP request for a 30-minute
        // LLM turn. Crash recovery (stale `running` sweep) runs as part of the
        // resolve step, and in-flight runs in this process are never double-run.
        studyRun: async (rawInput) => {
            const bot = await input.resolveBot(rawInput?.from);
            if ('failure' in bot)
                return bot.failure;
            const runner = activeStudyTurnRunner;
            if (!runner) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'The study-run executor is not configured in this daemon.');
            }
            const store = runner.storeFor(bot.homeDir);
            const log = (message) => console.warn(message);
            let job;
            try {
                job = await (0, studyJobs_1.resolveStudyJobForRun)(store, {
                    metabotSlug: bot.slug,
                    ...(typeof rawInput?.jobId === 'string' && rawInput.jobId.trim() ? { jobId: rawInput.jobId } : {}),
                    ...(typeof rawInput?.topic === 'string' && rawInput.topic.trim() ? { topic: rawInput.topic } : {}),
                });
            }
            catch (error) {
                if (error instanceof studyJobs_1.StudyRunError)
                    return (0, commandResult_1.commandFailed)(error.code, error.message);
                return (0, commandResult_1.commandFailed)('study_run_failed', error instanceof Error ? error.message : String(error));
            }
            void (0, studyJobs_1.startStudyJobRun)(store, { runStudyTurn: runner.runStudyTurn, log }, job)
                .catch((error) => log(`[Study] Manual run of job ${job.id} failed hard: ${error instanceof Error ? error.message : String(error)}`));
            return (0, commandResult_1.commandSuccess)({ started: true, jobId: job.id, topic: job.topic, status: job.status, budgetPins: job.budgetPins });
        },
    };
}
