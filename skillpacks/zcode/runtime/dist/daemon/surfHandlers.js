"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSurfDaemonHandlers = createSurfDaemonHandlers;
/**
 * Daemon-side MetaWeb surf handler group (OAC port of the IDBots
 * SurfService host wiring): per-bot SurfService instances (slug-keyed mutex,
 * run store as the crash-recovery anchor) plus the `metabot surf *` HTTP
 * surface — status/run/enable/disable/budget.
 *
 * The unattended LLM session executor is injected (`runSurfSession`) by the
 * daemon runtime, which owns the passive-LLM chain (DSH pair via the
 * host-executor lease first, then local CLI runtimes) and the full surf tool
 * wiring (see runtime.ts). Everything file/store/identity-shaped resolves
 * here in-process.
 */
const commandResult_1 = require("../core/contracts/commandResult");
const store_1 = require("../core/chainhistory/store");
const memoryPolicy_1 = require("../core/memory/memoryPolicy");
const studyJobs_1 = require("../core/knowledgebase/studyJobs");
const runtimeStateStore_1 = require("../core/state/runtimeStateStore");
const paths_1 = require("../core/state/paths");
const protocols_1 = require("../core/surf/protocols");
const service_1 = require("../core/surf/service");
const store_2 = require("../core/surf/store");
const settings_1 = require("../core/surf/settings");
const format_1 = require("../core/surf/format");
const surfReads_1 = require("../core/surf/surfReads");
const SURF_READS_OPTIONS = (baseUrl) => (baseUrl ? { baseUrl } : undefined);
function createSurfDaemonHandlers(input) {
    const servicesByHome = new Map();
    const readsOptions = SURF_READS_OPTIONS(input.metawebBaseUrl);
    function serviceFor(bot) {
        let service = servicesByHome.get(bot.homeDir);
        if (!service) {
            const paths = (0, paths_1.resolveMetabotPaths)(bot.homeDir);
            const store = (0, store_2.createMetawebSurfStore)(paths);
            const settings = (0, settings_1.createSurfSettingsStore)(paths);
            const chainHistory = (0, store_1.createChainHistoryStore)(paths);
            const log = input.log ?? (() => undefined);
            service = new service_1.SurfService({
                botSlug: bot.slug,
                botName: bot.name,
                store,
                settings,
                broadcast: (payload) => {
                    log(`[Surf] ${payload.botSlug} run ${payload.runId} ${payload.trigger} → ${payload.status}${payload.error ? ` (${payload.error})` : ''}`);
                },
                runSurfSession: input.runSurfSession,
                isMemoryEnabled: () => (0, memoryPolicy_1.createMemoryPolicyStore)(paths).effectivePolicy().then((policy) => policy.memoryEnabled),
                listChainWritesForSurf: async () => {
                    const rows = await chainHistory.searchWrites({ limit: 2000 });
                    return rows.map((row) => ({
                        pinId: row.pinId,
                        path: row.path,
                        contentText: row.contentText,
                    }));
                },
                registry: (0, protocols_1.createSurfProtocols)(input.metawebBaseUrl ? { baseUrl: input.metawebBaseUrl } : {}),
                getBotIdentity: async () => {
                    // The identity is best-effort — bots without one simply get no inbox.
                    try {
                        const state = await (0, runtimeStateStore_1.createRuntimeStateStore)(bot.homeDir).readState();
                        const globalMetaId = state.identity?.globalMetaId ?? null;
                        const address = state.identity?.addresses?.mvc ?? null;
                        return globalMetaId || address ? { globalMetaId, address } : null;
                    }
                    catch {
                        return null;
                    }
                },
                fetchSurfInbox: async ({ owner, sinceTs }) => {
                    // Page at most 2×50 (the briefing caps presentation at 30 anyway).
                    const items = [];
                    let cursor;
                    for (let page = 0; page < 2; page += 1) {
                        const result = await (0, surfReads_1.metawebInteractions)({ owner, since: sinceTs, size: 50, ...(cursor ? { cursor } : {}) }, readsOptions);
                        for (const item of result.items) {
                            items.push({
                                type: item.type,
                                pinId: item.pinId,
                                targetPinId: item.targetPinId,
                                actorName: item.actor.name,
                                actorGlobalMetaId: item.actor.globalMetaId,
                                createdAt: item.createdAt,
                                excerpt: item.excerpt,
                            });
                        }
                        if (!result.hasMore || !result.nextCursor)
                            break;
                        cursor = result.nextCursor;
                    }
                    return items;
                },
                fetchProtocolRadar: async () => {
                    const page = await (0, surfReads_1.metawebProtocols)({ size: 50 }, readsOptions);
                    return {
                        items: page.items.map((item) => ({
                            path: item.path,
                            title: item.title,
                            protocolName: item.protocolName,
                            intro: item.intro,
                            version: item.version,
                            authorName: item.author.name,
                            createdAt: item.createdAt,
                        })),
                        rejectedCount: page.rejected.length,
                    };
                },
            });
            servicesByHome.set(bot.homeDir, service);
        }
        return service;
    }
    return {
        /** Crash recovery at daemon boot: orphaned `running` rows become failed. */
        recoverAfterRestart: async () => {
            let recovered = 0;
            for (const service of servicesByHome.values()) {
                recovered += await service.recoverAfterRestart();
            }
            return recovered;
        },
        status: async (rawInput) => {
            const bot = await input.resolveBot(rawInput.from);
            if ('failure' in bot)
                return bot.failure;
            // Self-healing orphan sweep (IDBots parity): `running` rows a dead
            // daemon left behind become failed before anything reads them — the
            // in-memory run of THIS process is excluded.
            const service = serviceFor(bot);
            const store = (0, store_2.createMetawebSurfStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            if (await store.hasRunningRun()) {
                await store.failStaleRunningRuns({
                    error: 'Daemon restarted during surf run',
                    nowIso: new Date().toISOString(),
                    ...(service.currentRunId() != null ? { excludeId: service.currentRunId() } : {}),
                }).catch(() => 0);
            }
            const paths = (0, paths_1.resolveMetabotPaths)(bot.homeDir);
            const limit = Math.max(1, Math.min(50, Math.floor(rawInput.limit ?? 5)));
            const [runs, settings] = await Promise.all([
                (0, store_2.createMetawebSurfStore)(paths).listRuns(limit),
                (0, settings_1.createSurfSettingsStore)(paths).read(),
            ]);
            // Pre-dream gate (opt-in + 20h recency + memory + not running) — the
            // dream scheduler reads this to decide whether tonight's dream gets a
            // fresh surf first.
            const preDreamDue = await serviceFor(bot).shouldPreDreamSurf().catch(() => false);
            return (0, commandResult_1.commandSuccess)({
                botSlug: bot.slug,
                runs,
                running: servicesByHome.get(bot.homeDir)?.isRunning() ?? false,
                surfBeforeDreamEnabled: settings.surfBeforeDreamEnabled,
                interactionBudget: settings.interactionBudget,
                preDreamDue,
                formatted: (0, format_1.formatSurfRunList)(runs),
            });
        },
        run: async (rawInput) => {
            const bot = await input.resolveBot(rawInput.from);
            if ('failure' in bot)
                return bot.failure;
            const trigger = rawInput.trigger === 'manual-chat' || rawInput.trigger === 'pre-dream'
                ? rawInput.trigger
                : 'manual-ui';
            const service = serviceFor(bot);
            try {
                if (rawInput.wait === true) {
                    const run = await service.runSurfAndWait(trigger);
                    return (0, commandResult_1.commandSuccess)({
                        runId: run.id,
                        trigger,
                        status: run.status,
                        stats: run.stats,
                        error: run.error,
                        reportMarkdown: run.reportMarkdown,
                    });
                }
                const run = await service.startSurf(trigger);
                return (0, commandResult_1.commandSuccess)({ runId: run.id, trigger, status: 'running' });
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('surf_start_failed', error instanceof Error ? error.message : String(error));
            }
        },
        enable: async (rawInput) => {
            const bot = await input.resolveBot(rawInput.from);
            if ('failure' in bot)
                return bot.failure;
            const settings = (0, settings_1.createSurfSettingsStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const next = await settings.update({ surfBeforeDreamEnabled: true });
            // IDBots 0.9.1 migration: enabling surf retires the legacy nightly
            // qa-surf job — Q&A browsing now happens inside the surf run.
            let qaSurfRetired = false;
            try {
                qaSurfRetired = await (0, studyJobs_1.retireQaSurfJobsForSurf)((0, studyJobs_1.createStudyJobStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir)), bot.slug);
            }
            catch {
                // A sick study store never blocks enabling surf.
            }
            return (0, commandResult_1.commandSuccess)({
                surfBeforeDreamEnabled: next.surfBeforeDreamEnabled,
                interactionBudget: next.interactionBudget,
                qaSurfRetired,
            });
        },
        disable: async (rawInput) => {
            const bot = await input.resolveBot(rawInput.from);
            if ('failure' in bot)
                return bot.failure;
            const settings = (0, settings_1.createSurfSettingsStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            const next = await settings.update({ surfBeforeDreamEnabled: false });
            return (0, commandResult_1.commandSuccess)({ surfBeforeDreamEnabled: next.surfBeforeDreamEnabled });
        },
        budget: async (rawInput) => {
            const bot = await input.resolveBot(rawInput.from);
            if ('failure' in bot)
                return bot.failure;
            const settings = (0, settings_1.createSurfSettingsStore)((0, paths_1.resolveMetabotPaths)(bot.homeDir));
            try {
                const next = await settings.update({ interactionBudget: rawInput.budget });
                return (0, commandResult_1.commandSuccess)({ interactionBudget: next.interactionBudget });
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('invalid_budget', error instanceof Error ? error.message : String(error));
            }
        },
    };
}
