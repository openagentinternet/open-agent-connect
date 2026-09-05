"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMemoryHygiene = runMemoryHygiene;
exports.memoryHygieneDue = memoryHygieneDue;
// Memory hygiene orchestration, ported from IDBots
// src/main/services/memoryHygieneService.ts onto the OAC file stores.
//
// The dream pass abstracts raw experience into summaries, memories,
// impressions and knowledge. This service retires what nothing will read
// again: supersede stale impression observations, soft-archive old episodes
// and decayed dream memories, prune knowledge-revision overflow and purge
// low-risk tombstones — then, on a slow cadence, runs the LLM deep
// consolidation over the belief layer. Every step is error-isolated so one
// failure never blocks the others, and nothing here can interfere with the
// dream pipeline (worst case a step retries next night).
//
// Scheduling: one pass per local date, eligible from 04:00 (late in the dream
// window so nightly dreams finish first) and any time later as catch-up.
// Manual runs (`memory hygiene run`) bypass every gate, like IDBots.
//
// Adaptations: IDBots loops over every metabot in a shared SQLite database;
// OAC runs one bot per profile, so there is no bot loop and no per-bot
// exclude sets — the profile's `hygieneEnabled` policy flag gates the whole
// run, and the deep-consolidation cadence is a single ledger stamp instead of
// a per-bot map. OAC has no team-culture store, so the IDBots `culture` step
// is dropped (noted for the future culture port).
const node_path_1 = __importDefault(require("node:path"));
const deepConsolidationPrompt_1 = require("./deepConsolidationPrompt");
const dreamStore_1 = require("./dreamStore");
const experienceStore_1 = require("./experienceStore");
const hygieneStore_1 = require("./hygieneStore");
const impressionStore_1 = require("./impressionStore");
const knowledgeStore_1 = require("./knowledgeStore");
const memoryHygienePolicy_1 = require("./memoryHygienePolicy");
const memoryPolicy_1 = require("./memoryPolicy");
const memoryStore_1 = require("./memoryStore");
function resolveHygieneStores(paths, deps) {
    const experienceStore = deps.experienceStore ?? (0, experienceStore_1.createExperienceStore)(paths);
    return {
        memoryStore: deps.memoryStore ?? (0, memoryStore_1.createMemoryStore)(paths),
        policyStore: deps.policyStore ?? (0, memoryPolicy_1.createMemoryPolicyStore)(paths),
        experienceStore,
        impressionStore: deps.impressionStore ?? (0, impressionStore_1.createImpressionStore)(paths, { experienceStore }),
        knowledgeStore: deps.knowledgeStore ?? (0, knowledgeStore_1.createKnowledgeStore)(paths),
        dreamStore: deps.dreamStore ?? (0, dreamStore_1.createDreamStore)(paths),
        hygieneStore: deps.hygieneStore ?? (0, hygieneStore_1.createHygieneStore)(paths),
    };
}
const DAY_MS = 86_400_000;
const STEPS = [
    // Impression observations: supersede stale ones past the per-pair anchors;
    // the snapshot survives as the compressed state.
    {
        name: 'impression-observations',
        run: async ({ impressionStore }, context) => {
            const result = await impressionStore.compactObservations({
                cutoffMs: context.nowMs - context.config.observationRetentionDays * DAY_MS,
                anchorsPerPair: context.config.observationAnchorsPerPair,
            });
            return {
                observationPairsCompacted: result.pairsCompacted,
                observationsSuperseded: result.observationsSuperseded,
                observationSnapshotsRebuilt: result.snapshotsRebuilt,
            };
        },
    },
    // Episodes: settle open rows whose source (order / task) already reached a
    // terminal state, or whose conversation went long-dormant — live event
    // wiring is best-effort and missed terminal transitions otherwise stay
    // 'open' forever (invisible to the archive stroke below, which only touches
    // terminal rows). Then soft-archive terminal episodes past the retention
    // horizon so dream candidates / contact views / cognition context stop
    // scanning them; recurring activity on the same source key revives.
    {
        name: 'episodes',
        run: async ({ experienceStore }, context) => {
            const settled = await experienceStore.reconcileOpenEpisodes({
                nowMs: context.nowMs,
                dormantCutoffMs: context.nowMs - context.config.episodeArchiveDays * DAY_MS,
            });
            const archived = await experienceStore.archiveEpisodes({
                cutoffMs: context.nowMs - context.config.episodeArchiveDays * DAY_MS,
                archivedAt: new Date(context.nowMs).toISOString(),
            });
            return {
                episodesReconciled: settled.serviceOrdersSettled + settled.taskEpisodesSettled,
                dormantInteractionsClosed: settled.dormantInteractionsClosed,
                episodesArchived: archived,
            };
        },
    },
    // Dream memories: decay-archive entries untouched past the horizon
    // (self_identity and conversation-origin rows never auto-archive), then
    // physically purge tombstones that outlived the grace period — the one
    // low-risk delete in the memory layer.
    {
        name: 'dream-memories',
        run: async ({ memoryStore }, context) => {
            const archived = await memoryStore.archiveDecayedDreamMemories({
                cutoffMs: context.nowMs - context.config.memoryDecayDays * DAY_MS,
                archivedAt: new Date(context.nowMs).toISOString(),
            });
            const purged = await memoryStore.purgeDeletedMemoryTombstones(context.nowMs - context.config.tombstonePurgeDays * DAY_MS);
            return { memoriesArchived: archived, tombstonesPurged: purged };
        },
    },
    // Knowledge revision overflow: keep the newest N historical revisions per
    // entry, physically remove older redundant copies.
    {
        name: 'knowledge-revisions',
        run: async ({ knowledgeStore }, context) => {
            const result = await knowledgeStore.pruneKnowledgeRevisions({
                keepPerEntry: context.config.knowledgeRevisionKeep,
            });
            return { knowledgeRevisionsPruned: result.revisionsDeleted };
        },
    },
    // Dream bookkeeping: completed runs and fragment caches past the horizon
    // are pure history (the scheduler only looks back 7 days).
    {
        name: 'dream-runs',
        run: async ({ dreamStore }, context) => {
            const cutoffDateKey = (0, memoryHygienePolicy_1.formatHygieneDateKey)(new Date(context.nowMs - context.config.dreamRunRetentionDays * DAY_MS));
            const result = await dreamStore.purgeOldRunsAndFragments({ cutoffDateKey });
            return { dreamRunsPurged: result.runsDeleted, dreamFragmentsPurged: result.fragmentsDeleted };
        },
    },
    // Deep consolidation (the LLM side of the compression stroke): every N
    // days, review the belief layer and retire/merge what aged out. Proposals
    // are validated against the listed inventory and applied via reversible
    // channels (memory archived_at mark / knowledge versioning).
    {
        name: 'deep-consolidation',
        run: async ({ memoryStore, knowledgeStore, hygieneStore }, context, input) => {
            if (input.deep === false)
                return { counts: {} };
            if (!input.complete || !context.config.deepConsolidationEnabled) {
                return { counts: { deepConsolidationSkipped: 1 } };
            }
            const errors = [];
            const intervalMs = context.config.deepConsolidationIntervalDays * DAY_MS;
            const lastRunAt = await hygieneStore.getDeepConsolidationLastRunAt();
            if (lastRunAt != null && context.nowMs - lastRunAt < intervalMs)
                return { counts: {} };
            // Inventory: value_boundary + work_review memories (status created, not
            // archived — the default list view) and active knowledge.
            const boundaries = await memoryStore.list({ usageClass: 'value_boundary', status: 'created', limit: 50 });
            const reviews = await memoryStore.list({ usageClass: 'work_review', status: 'created', limit: 50 });
            const knowledge = await knowledgeStore.listKnowledgeForDream(60);
            const items = [
                ...boundaries.map((memory) => ({ id: memory.id, kind: 'value_boundary', text: memory.text })),
                ...reviews.map((memory) => ({ id: memory.id, kind: 'work_review', text: memory.text })),
                ...knowledge.map((entry) => ({
                    id: entry.id,
                    kind: 'knowledge',
                    text: `${entry.topic}: ${entry.summary}`,
                    extra: `kind=${entry.kind}, v${entry.version}`,
                })),
            ];
            if (!(0, deepConsolidationPrompt_1.shouldRunDeepConsolidation)(items.length))
                return { counts: {} };
            let raw;
            try {
                raw = await input.complete({
                    system: 'You are a memory consolidation assistant. Respond only with the requested JSON object.',
                    user: (0, deepConsolidationPrompt_1.buildDeepConsolidationPrompt)({ botName: context.botName, items }),
                });
            }
            catch (error) {
                errors.push(`deep-consolidation: ${error instanceof Error ? error.message : String(error)}`);
                return { counts: {}, errors };
            }
            if (raw === null) {
                // No available LLM runtime — skip, not fail; cadence stamping is
                // unaffected (a later pass with a runtime retries).
                return { counts: { deepConsolidationSkipped: 1 } };
            }
            const output = (0, deepConsolidationPrompt_1.parseDeepConsolidationOutput)(raw);
            if (!output) {
                errors.push(`deep-consolidation: unparseable output (${(0, deepConsolidationPrompt_1.describeDeepConsolidationParseFailure)(raw)})`);
                return { counts: {}, errors };
            }
            const errorsBeforeApply = errors.length;
            const knowledgeIds = new Set(knowledge.map((entry) => entry.id));
            // Retire protection aligned with the deterministic decay stroke: only
            // dream-origin rows are ever auto-archived — conversation-origin entries
            // may carry the user's explicit "remember this".
            const dreamMemoryIds = new Set([...boundaries, ...reviews]
                .filter((memory) => memory.origin === 'dream')
                .map((memory) => memory.id));
            const retireMemories = output.retireMemoryIds.filter((id) => dreamMemoryIds.has(id));
            const retireKnowledge = output.retireKnowledgeIds.filter((id) => knowledgeIds.has(id));
            const rewrites = output.rewriteKnowledge.filter((rewrite) => knowledgeIds.has(rewrite.id));
            // Guardrail: a VALIDATED retire list eating more than a quarter of the
            // belief layer in one pass smells like a hallucinated purge — refuse the
            // whole proposal and let the cadence retry later. (Bogus and
            // conversation-origin ids are already filtered out, so junk output
            // cannot trip the guardrail by itself.)
            const retireCap = (0, deepConsolidationPrompt_1.deepConsolidationRetireCap)(items.length);
            if (retireMemories.length + retireKnowledge.length > retireCap) {
                errors.push(`deep-consolidation: retire list exceeds guardrail`
                    + ` (${retireMemories.length + retireKnowledge.length} > ${retireCap}); refusing`);
                return { counts: {}, errors };
            }
            const retiredMemories = await memoryStore.archiveMemories({
                ids: retireMemories,
                archivedAt: new Date(context.nowMs).toISOString(),
                // The LLM call had an await window: anything edited or injected
                // (touched) since the inventory snapshot must survive the proposal.
                notUsedSince: context.nowMs,
            });
            let retiredKnowledge = 0;
            for (const id of retireKnowledge) {
                try {
                    await knowledgeStore.archiveKnowledge(id);
                    retiredKnowledge += 1;
                }
                catch {
                    errors.push(`deep-consolidation: archive knowledge ${id} failed`);
                }
            }
            let rewrittenKnowledge = 0;
            for (const rewrite of rewrites) {
                try {
                    // Rewrite IN PLACE by id (version bump + revision kept). A
                    // topic-fingerprint upsert here would fork a new entry whenever the
                    // LLM rephrases the topic, growing the layer it should shrink.
                    const updated = await knowledgeStore.updateKnowledge({
                        id: rewrite.id,
                        topic: rewrite.topic,
                        summary: rewrite.summary,
                        kind: rewrite.kind,
                    });
                    if (updated) {
                        rewrittenKnowledge += 1;
                    }
                    else {
                        errors.push(`deep-consolidation: rewrite knowledge ${rewrite.id} not found`);
                    }
                }
                catch {
                    errors.push(`deep-consolidation: rewrite knowledge ${rewrite.id} failed`);
                }
            }
            // Stamp the cadence only for clean runs: a bot with errors retries on
            // the next pass instead of waiting out the whole interval.
            if (errors.length === errorsBeforeApply) {
                await hygieneStore.setDeepConsolidationLastRunAt(context.nowMs);
            }
            return {
                counts: {
                    deepConsolidationBots: 1,
                    deepRetiredMemories: retiredMemories,
                    deepRetiredKnowledge: retiredKnowledge,
                    deepRewrittenKnowledge: rewrittenKnowledge,
                },
                errors,
            };
        },
    },
];
function isEnvelope(result) {
    return Boolean(result && typeof result === 'object'
        && result.counts
        && typeof result.counts === 'object');
}
/**
 * Full in-process hygiene pass. Steps run sequentially and are error-isolated:
 * a throwing step lands in `stats.errors` (as `<step>: <message>`) and the
 * rest continue; the ledger is stamped with the merged counters either way.
 */
async function runMemoryHygiene(paths, input, deps = {}) {
    const stores = resolveHygieneStores(paths, deps);
    const now = input.now ?? new Date();
    const nowMs = now.getTime();
    const dateKey = (0, memoryHygienePolicy_1.formatHygieneDateKey)(now);
    const config = await stores.policyStore.getHygieneConfig();
    if (!config.enabled) {
        // Do not stamp the last-run record: a later enable still runs tonight.
        return { dateKey, ranAt: nowMs, trigger: input.trigger, counts: { skippedDisabled: 1 }, errors: [] };
    }
    if (input.trigger === 'scheduled') {
        if (!(0, memoryHygienePolicy_1.isMemoryHygieneRunTimeDue)(now)) {
            return { dateKey, ranAt: nowMs, trigger: input.trigger, counts: { skippedNotDue: 1 }, errors: [] };
        }
        const lastRun = await stores.hygieneStore.getLastRun();
        if (lastRun && lastRun.dateKey === dateKey) {
            return { dateKey, ranAt: nowMs, trigger: input.trigger, counts: { skippedAlreadyRun: 1 }, errors: [] };
        }
    }
    const stats = { dateKey, ranAt: nowMs, trigger: input.trigger, counts: {}, errors: [] };
    const context = {
        config,
        nowMs,
        botName: node_path_1.default.basename(paths.profileRoot),
    };
    for (const step of STEPS) {
        try {
            const result = await step.run(stores, context, input);
            const stepCounts = isEnvelope(result) ? result.counts : (result ?? {});
            for (const [key, value] of Object.entries(stepCounts)) {
                stats.counts[key] = value;
            }
            if (isEnvelope(result)) {
                for (const stepError of result.errors ?? []) {
                    stats.errors.push(stepError);
                }
            }
        }
        catch (error) {
            const message = `${step.name}: ${error instanceof Error ? error.message : String(error)}`;
            stats.errors.push(message);
        }
    }
    await stores.hygieneStore.setLastRun(stats);
    return stats;
}
/** Scheduled-pass eligibility: ≥ 04:00 local, once per local date, all-day
 * catch-up. Manual `run` bypasses this entirely. */
async function memoryHygieneDue(paths, input = {}, deps = {}) {
    const stores = resolveHygieneStores(paths, deps);
    const now = input.now ?? new Date();
    const config = await stores.policyStore.getHygieneConfig();
    if (!config.enabled) {
        return { due: false, reason: 'hygiene disabled by policy' };
    }
    if (!(0, memoryHygienePolicy_1.isMemoryHygieneRunTimeDue)(now)) {
        return { due: false, reason: 'before 04:00 local time' };
    }
    const lastRun = await stores.hygieneStore.getLastRun();
    if (lastRun && lastRun.dateKey === (0, memoryHygienePolicy_1.formatHygieneDateKey)(now)) {
        return { due: false, reason: 'already run today' };
    }
    return { due: true, reason: 'due' };
}
