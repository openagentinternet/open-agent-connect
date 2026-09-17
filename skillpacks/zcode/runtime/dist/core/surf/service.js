"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SurfService = exports.PRE_DREAM_SURF_RECENCY_MS = void 0;
/**
 * SurfService — the autonomous MetaWeb surf ("AI 冲浪") loop. OAC port of the
 * IDBots surfService: one run = stage-0 briefing (deterministic) → optional
 * unattended LLM session (injected; learns/engages in persona) → watermarks
 * advance, report lands in the run store for the UI and the same night's
 * dream.
 *
 * One instance per bot profile (the daemon keeps a slug→service map); the
 * in-memory running flag is the per-bot mutex and the run row is the
 * crash-recovery anchor.
 */
const node_crypto_1 = require("node:crypto");
const store_js_1 = require("./store.js");
const briefing_js_1 = require("./briefing.js");
const prompt_js_1 = require("./prompt.js");
const guard_js_1 = require("./guard.js");
const protocols_js_1 = require("./protocols.js");
/** A finished surf younger than this makes the pre-dream surf redundant. */
exports.PRE_DREAM_SURF_RECENCY_MS = 20 * 60 * 60 * 1000;
class SurfService {
    botSlug;
    botName;
    store;
    settings;
    broadcast;
    runSurfSession;
    isMemoryEnabled;
    listChainWritesForSurf;
    registry;
    nowMs;
    getBotIdentity;
    fetchSurfInbox;
    fetchProtocolRadar;
    runningRunId = null;
    constructor(deps) {
        this.botSlug = deps.botSlug;
        this.botName = deps.botName;
        this.store = deps.store;
        this.settings = deps.settings;
        this.broadcast = deps.broadcast;
        this.runSurfSession = deps.runSurfSession;
        this.isMemoryEnabled = deps.isMemoryEnabled;
        this.listChainWritesForSurf = deps.listChainWritesForSurf;
        this.registry = deps.registry ?? protocols_js_1.DEFAULT_SURF_PROTOCOLS;
        this.nowMs = deps.nowMs ?? (() => Date.now());
        this.getBotIdentity = deps.getBotIdentity;
        this.fetchSurfInbox = deps.fetchSurfInbox;
        this.fetchProtocolRadar = deps.fetchProtocolRadar;
    }
    /** Crash recovery at daemon startup: runs orphaned by a killed process become failed. */
    async recoverAfterRestart(excludeRunId) {
        return this.store.failStaleRunningRuns({
            error: 'Process restarted during surf run',
            nowIso: new Date(this.nowMs()).toISOString(),
            excludeId: excludeRunId,
        });
    }
    isRunning() {
        return this.runningRunId !== null;
    }
    /** The run this process is executing right now; null when idle. Orphan
     *  sweeps exclude it when failing `running` rows a dead process left. */
    currentRunId() {
        return this.runningRunId;
    }
    /**
     * The notes the bot wrote to itself in its last DONE run: read back out of
     * reportJson so the next surf inherits its hard-won lessons. Best-effort —
     * a missing/malformed note must never block a run.
     */
    async latestSurfNotes() {
        try {
            const latest = await this.store.getLatestFinishedRun();
            return (0, prompt_js_1.extractSurfNotesFromReportJson)(latest?.reportJson ?? null);
        }
        catch {
            return null;
        }
    }
    /**
     * Backfill the seen ledger from the local chain-writes ledger: every own
     * write is a 'posted' receipt and every extractable interaction payload
     * yields its target receipt. Strongest-wins batching makes this a no-op
     * when the ledger is already current. Best-effort — a sick writes ledger
     * must not block a surf run.
     */
    async reconcileSeenLedger() {
        if (!this.listChainWritesForSurf)
            return;
        try {
            const rows = await this.listChainWritesForSurf();
            const receipts = rows.flatMap((row) => (0, guard_js_1.surfReceiptsFromChainWriteRecord)(row));
            if (receipts.length > 0) {
                await this.store.markSeenBatch(receipts, new Date(this.nowMs()).toISOString());
            }
        }
        catch {
            // Reconciliation is insurance, never a run blocker.
        }
    }
    /**
     * Pre-dream gate: the bot's surf-before-dream toggle is explicitly enabled
     * (default OFF — opt-in, since every surf spends LLM tokens and gas) and it
     * has not finished a surf within the recency window (a manual evening surf
     * makes the nightly one redundant).
     */
    async shouldPreDreamSurf() {
        const settings = await this.settings.read();
        if (!settings.surfBeforeDreamEnabled)
            return false;
        if (this.isRunning())
            return false;
        try {
            // A bot without memory learns nothing from surfing — skip quietly here
            // (the dream proceeds either way); manual triggers fail loudly instead.
            if (await Promise.resolve(this.isMemoryEnabled?.()) === false)
                return false;
        }
        catch {
            return false;
        }
        const latest = await this.store.getLatestFinishedRun();
        if (!latest?.finishedAt)
            return true;
        const finishedMs = Date.parse(latest.finishedAt);
        if (!Number.isFinite(finishedMs))
            return true;
        return this.nowMs() - finishedMs >= exports.PRE_DREAM_SURF_RECENCY_MS;
    }
    /**
     * Start a surf run in the background; returns the created run row.
     * Throws when a run is already in flight.
     */
    async startSurf(trigger) {
        const run = await this.beginRun(trigger);
        void this.executeRun(run.id).catch(() => {
            // executeRun records failures on the run row itself; this catch only
            // guards against bugs in the failure-recording path.
        });
        return run;
    }
    /** Awaitable variant for the pre-dream pipeline. */
    async runSurfAndWait(trigger) {
        const run = await this.beginRun(trigger);
        await this.executeRun(run.id).catch(() => undefined);
        return (await this.store.getRun(run.id)) ?? run;
    }
    async beginRun(trigger) {
        // Only pre-dream is memory-gated (same gate as dreaming). Manual triggers
        // run DEGRADED with memory off: the session then has no KB/memory tools
        // and the prompt says so, but the bot can still browse, engage, and
        // handle its inbox.
        if (trigger === 'pre-dream' && await Promise.resolve(this.isMemoryEnabled?.()) === false) {
            throw new Error('Pre-dream surf requires memory enabled (same gate as dreaming).');
        }
        if (this.runningRunId !== null) {
            throw new Error('A surf run is already in progress for this bot');
        }
        const nowIso = new Date(this.nowMs()).toISOString();
        const run = await this.store.createRun({ id: (0, node_crypto_1.randomUUID)(), trigger, nowIso });
        this.runningRunId = run.id;
        this.broadcast({ botSlug: this.botSlug, runId: run.id, trigger, status: 'running' });
        return run;
    }
    async executeRun(runId) {
        const run = await this.store.getRun(runId);
        if (!run)
            return;
        const { trigger } = run;
        const finish = async (outcome, error) => {
            this.broadcast({ botSlug: this.botSlug, runId, trigger, status: outcome, error });
            if (this.runningRunId === runId)
                this.runningRunId = null;
        };
        let fetchedCount = 0;
        try {
            // Reconcile the seen ledger against the local chain-writes ledger
            // first: receipts lost to a crash/kill mid-run are re-derived locally —
            // the duplicate-interaction guard must never work off a stale ledger.
            // Idempotent (strongest-wins batching).
            await this.reconcileSeenLedger();
            const settings = await this.settings.read();
            const budget = settings.interactionBudget;
            // Inbox/radar baseline: the START of the latest finished run (its
            // createdAt — NOT finishedAt: an interaction arriving mid-run must
            // surface on the NEXT run). No finished run yet → the briefing's
            // first-lookback default applies (inboxBaselineTs stays undefined).
            let inboxBaselineTs;
            const latestFinished = await this.store.getLatestFinishedRun();
            if (latestFinished?.createdAt) {
                const parsedMs = Date.parse(latestFinished.createdAt);
                if (Number.isFinite(parsedMs))
                    inboxBaselineTs = Math.floor(parsedMs / 1000);
            }
            const identity = await Promise.resolve(this.getBotIdentity?.() ?? null);
            const owner = (identity?.address ?? '').trim() || (identity?.globalMetaId ?? '').trim() || null;
            const briefing = await (0, briefing_js_1.buildSurfBriefing)({
                store: this.store,
                interactionBudget: budget,
                registry: this.registry,
                nowMs: this.nowMs(),
                inboxBaselineTs,
                fetchInbox: this.fetchSurfInbox && owner
                    ? ({ sinceTs }) => this.fetchSurfInbox({ owner, sinceTs })
                    : undefined,
                fetchProtocolRadar: this.fetchProtocolRadar,
            });
            fetchedCount = briefing.items.length;
            const stats = { ...(0, store_js_1.emptySurfRunStats)(), fetched: briefing.items.length };
            let reportMarkdown = null;
            let reportJson = null;
            const sessionSeenActions = [];
            if (this.runSurfSession) {
                const session = await this.runSurfSession({
                    runId,
                    botSlug: this.botSlug,
                    botName: this.botName,
                    trigger,
                    briefing,
                    previousNotes: await this.latestSurfNotes(),
                });
                Object.assign(stats, session.stats ?? {});
                reportMarkdown = session.reportMarkdown ?? null;
                reportJson = session.reportJson ?? null;
                sessionSeenActions.push(...(session.seenActions ?? []));
            }
            // Seen-ledger writes land ONLY on this success path: every briefed pin
            // becomes 'presented' and the session's self-reported actions fold on
            // top (strongest action wins, one batched store write). Presented
            // inbox items join the same batch — the ledger is what guarantees the
            // deterministic inbox presents each interaction exactly once.
            // A run that fails before this point leaves the ledger untouched, so
            // the next surf re-presents the same window — one bad night (LLM
            // timeout, outage) never silently drops that content.
            const nowIso = new Date(this.nowMs()).toISOString();
            await this.store.markSeenBatch([
                ...briefing.items.map((item) => ({ pinId: item.pinId, action: 'presented' })),
                ...(briefing.inbox && !briefing.inbox.error
                    ? briefing.inbox.items.map((item) => ({ pinId: item.pinId, action: 'presented' }))
                    : []),
                ...sessionSeenActions,
            ], nowIso);
            // Watermarks/cursors advance only after the run body completed, and
            // only for sections with a usable action (fetch errors preserve their
            // old state so the next surf retries them). Backlog pages move ONLY
            // the cursor — never the watermark.
            for (const section of briefing.protocols) {
                if (section.error)
                    continue;
                if (section.nextWatermarkTs !== null) {
                    await this.store.advanceProtocolState(section.key, {
                        lastSeenTs: section.nextWatermarkTs,
                        lastPinId: null,
                        nowIso,
                        backlogCursor: section.backlogCursorAction === 'store'
                            ? section.backlogCursor
                            : section.backlogCursorAction === 'clear' ? null : undefined,
                    });
                }
                else if (section.backlogCursorAction !== 'preserve') {
                    await this.store.advanceProtocolState(section.key, {
                        lastSeenTs: null,
                        nowIso,
                        backlogCursor: section.backlogCursorAction === 'store'
                            ? section.backlogCursor
                            : section.backlogCursorAction === 'clear' ? null : undefined,
                    });
                }
            }
            await this.store.pruneSeenPins(nowIso);
            const digest = (0, briefing_js_1.renderSurfBriefingMarkdown)(briefing);
            await this.store.finishRun(runId, {
                status: 'done',
                stats,
                reportMarkdown: reportMarkdown ? `${reportMarkdown}\n\n---\n\n${digest}` : digest,
                reportJson,
                finishedAtIso: nowIso,
            });
            await finish('done', null);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // A failed run keeps the REAL numbers the host can vouch for (fetched
            // from the briefing; deep reads / KB adds / chain interactions
            // attached to the session error by the turn loop) instead of the
            // historical all-zero stats.
            const partial = error?.surfPartialStats;
            await this.store.finishRun(runId, {
                status: 'failed',
                stats: { ...(0, store_js_1.emptySurfRunStats)(), fetched: fetchedCount, ...(partial ?? {}) },
                error: message,
                finishedAtIso: new Date(this.nowMs()).toISOString(),
            });
            await finish('failed', message);
        }
    }
}
exports.SurfService = SurfService;
