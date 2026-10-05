"use strict";
/**
 * Chain → projection pipeline for the MetaTask read path (M4 — OAC port of
 * the IDBots refresher): collect the ten pools → cache events → replay the
 * DIRTY task roots → persist projections → board. The chain is the source of
 * truth; everything in the store is a rebuildable projection. A failed network
 * sweep keeps the last good projections and records the error for the
 * freshness line.
 *
 * Scale hardening (ported as-is):
 *  - a root whose replay-relevant event set is unchanged (and whose persisted
 *    projection has no pending time-driven deadline) is not replayed and its
 *    file is not rewritten;
 *  - ordinary callers are coalesced to at most one sweep per minIntervalMs
 *    (tick callers bypass it — their own cadence already spaces them out).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaTaskRefresher = void 0;
const collector_1 = require("./collector");
const deadlines_1 = require("./engine/deadlines");
const engine_1 = require("./engine/engine");
class MetaTaskRefresher {
    options;
    minIntervalMs;
    now;
    inFlight = null;
    /** Start instant of the last sweep that actually began (ms). */
    lastStartedAtMs = null;
    trailing = null;
    constructor(options) {
        this.options = options;
        this.minIntervalMs = Math.max(0, Math.trunc(options.minIntervalMs ?? 60_000));
        this.now = options.now ?? Date.now;
    }
    async board() {
        return this.options.store().board(this.roster());
    }
    async detail(rootPinId) {
        return this.options.store().getProjection(rootPinId);
    }
    /** All cached chain events — engine input for guards and replays. */
    async loadEvents() {
        return this.options.store().loadEvents();
    }
    roster() {
        return this.options.rosterMetaIds ? this.options.rosterMetaIds() : [];
    }
    /**
     * Sweep the chain. Concurrent callers share the in-flight sweep; callers
     * inside the minimum-interval window share exactly one trailing sweep.
     */
    refreshOnce(reason, options = {}) {
        if (this.inFlight)
            return this.inFlight;
        const nowMs = this.now();
        if (!options.bypassMinInterval
            && this.minIntervalMs > 0
            && this.lastStartedAtMs !== null
            && nowMs - this.lastStartedAtMs < this.minIntervalMs) {
            return this.scheduleTrailing(reason);
        }
        return this.start(reason);
    }
    /** Cancel a pending coalesced sweep (daemon shutdown). */
    dispose() {
        if (this.trailing?.timer)
            clearTimeout(this.trailing.timer);
        this.trailing = null;
    }
    start(reason) {
        this.lastStartedAtMs = this.now();
        this.inFlight = this.runRefresh(reason, this.lastStartedAtMs).finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }
    scheduleTrailing(reason) {
        if (this.trailing)
            return this.trailing.promise;
        const waitMs = Math.max(0, (this.lastStartedAtMs ?? this.now()) + this.minIntervalMs - this.now());
        const entry = {
            timer: null,
            promise: null,
        };
        entry.promise = new Promise((resolve) => {
            entry.timer = setTimeout(() => {
                this.trailing = null;
                // runRefresh never rejects (it records the failure and reports ok:false),
                // so a failing trailing sweep cannot wedge the scheduler.
                resolve(this.start(`${reason}+coalesced`));
            }, waitMs);
            // Never hold the daemon process open for a pending coalesced sweep.
            entry.timer.unref?.();
        });
        this.trailing = entry;
        return entry.promise;
    }
    /**
     * A skipped replay is only safe while no time-driven clock has crossed since
     * the last one (claim TTL / review window / challenge TTL — see deadlines).
     * Challenge candidates come from the scoped event set, because the projection
     * exposes only the `disputed` flag, not challenge timestamps.
     */
    deadlinePending(projection, taskSet, nowMs) {
        const deadline = (0, deadlines_1.nextTimeDeadlineMs)(projection, {
            challengeTimestampsMs: taskSet.scoped
                .filter((pin) => pin.path === 'challenge')
                .map((pin) => pin.timestampMs),
        });
        if (deadline === null)
            return false;
        // The engine transitions on `now > deadline`, so a deadline below the last
        // replay instant already fired then; only [evaluatedAtMs, now) can still trip.
        const evaluatedAtMs = projection.freshness?.evaluatedAtMs ?? 0;
        return deadline >= evaluatedAtMs && deadline < nowMs;
    }
    async runRefresh(reason, nowMs) {
        const store = this.options.store();
        await store.setRefreshing(true);
        try {
            const collected = await (0, collector_1.collectMetaTaskEvents)(this.options.collectOptions);
            await store.upsertEvents(collected.events);
            const allEvents = await store.loadEvents();
            // Same-side roster pins travel with the event set: the engine filters a
            // post-H_ACT2 vote whose voter shares a roster group with the submitter
            // or the root author (pre-H_ACT2 votes stay untouched, so the pilots'
            // projections are unchanged).
            const rosterPins = (0, collector_1.rosterPinsFromEvents)(allEvents);
            const roots = allEvents.filter((event) => event.path === 'task');
            const persisted = new Map((await store.projectionSweepState()).map((row) => [row.rootPinId, row]));
            const projections = [];
            const liveRootIds = [];
            const dirtyKeys = {};
            for (const root of roots) {
                // Live roots are declared even when their replay fails, so a malformed
                // task keeps its last good row instead of being pruned.
                liveRootIds.push(root.pinId);
                let taskSet;
                try {
                    taskSet = (0, engine_1.taskEventSet)(allEvents, { rootPinId: root.pinId });
                }
                catch {
                    continue;
                }
                const dirtyKey = (0, engine_1.taskDirtyKey)(taskSet, { rosterPins });
                dirtyKeys[root.pinId] = dirtyKey;
                const previous = persisted.get(root.pinId);
                if (previous
                    && previous.dirtyKey === dirtyKey
                    && !this.deadlinePending(previous.projection, taskSet, nowMs)) {
                    // Unchanged event set, no pending clock: the persisted row already
                    // says exactly what a replay would — leave it untouched.
                    continue;
                }
                try {
                    projections.push((0, engine_1.replayMetaTask)(allEvents, {
                        rootPinId: root.pinId,
                        now: nowMs,
                        evaluatedAtMs: nowMs,
                        rosterPins,
                    }));
                }
                catch {
                    // one malformed task must not fail the sweep; next refresh retries it
                }
            }
            // Identity enrichment runs only for the replayed roots: a skipped row
            // already carries its persisted identities.
            await store.enrichIdentities(projections);
            await store.saveProjections(projections, { liveRootIds, dirtyKeys });
            const boundaryBlock = projections.reduce((max, projection) => Math.max(max, projection.freshness.boundaryBlock), -1);
            await store.markRefreshDone(true, null, boundaryBlock);
            await store.bumpSeq();
            return { ok: true, board: await store.board(this.roster()), error: null };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await store.markRefreshDone(false, message, -1);
            return { ok: false, board: await store.board(this.roster()), error: message };
        }
    }
}
exports.MetaTaskRefresher = MetaTaskRefresher;
