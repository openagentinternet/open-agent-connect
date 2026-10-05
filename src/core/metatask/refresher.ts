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

import { collectMetaTaskEvents, rosterPinsFromEvents, type CollectMetaTaskEventsOptions } from './collector';
import { nextTimeDeadlineMs } from './engine/deadlines';
import { replayMetaTask, taskDirtyKey, taskEventSet, type MetaTaskTaskEventSet } from './engine/engine';
import type { MetaTaskBoard, MetaTaskChainEvent, MetaTaskTaskProjection } from './engine/types';
import type { MetaTaskStore } from './store';

export interface MetaTaskRefreshResult {
  ok: boolean;
  board: MetaTaskBoard | null;
  error: string | null;
}

export interface MetaTaskRefreshOptions {
  /**
   * Start even when the minimum-interval window has not elapsed. The daemon
   * tick uses this: its own cadence already spaces it out, and it must never
   * be deferred by a burst of tool-triggered requests.
   */
  bypassMinInterval?: boolean;
}

export interface MetaTaskRefresherOptions {
  store: () => MetaTaskStore;
  rosterMetaIds?: () => string[];
  collectOptions?: CollectMetaTaskEventsOptions;
  /**
   * Minimum spacing between sweeps STARTED by ordinary callers (tools, HTTP).
   * Requests inside the window do not run immediately: exactly one trailing
   * sweep is scheduled for when the window elapses. 0 disables coalescing.
   */
  minIntervalMs?: number;
  /** Clock seam (default Date.now). */
  now?: () => number;
}

export class MetaTaskRefresher {
  private readonly options: MetaTaskRefresherOptions;
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private inFlight: Promise<MetaTaskRefreshResult> | null = null;
  /** Start instant of the last sweep that actually began (ms). */
  private lastStartedAtMs: number | null = null;
  private trailing: { timer: ReturnType<typeof setTimeout> | null; promise: Promise<MetaTaskRefreshResult> } | null = null;

  constructor(options: MetaTaskRefresherOptions) {
    this.options = options;
    this.minIntervalMs = Math.max(0, Math.trunc(options.minIntervalMs ?? 60_000));
    this.now = options.now ?? Date.now;
  }

  async board(): Promise<MetaTaskBoard> {
    return this.options.store().board(this.roster());
  }

  async detail(rootPinId: string): Promise<MetaTaskTaskProjection | null> {
    return this.options.store().getProjection(rootPinId);
  }

  /** All cached chain events — engine input for guards and replays. */
  async loadEvents(): Promise<MetaTaskChainEvent[]> {
    return this.options.store().loadEvents();
  }

  private roster(): string[] {
    return this.options.rosterMetaIds ? this.options.rosterMetaIds() : [];
  }

  /**
   * Sweep the chain. Concurrent callers share the in-flight sweep; callers
   * inside the minimum-interval window share exactly one trailing sweep.
   */
  refreshOnce(reason: string, options: MetaTaskRefreshOptions = {}): Promise<MetaTaskRefreshResult> {
    if (this.inFlight) return this.inFlight;
    const nowMs = this.now();
    if (
      !options.bypassMinInterval
      && this.minIntervalMs > 0
      && this.lastStartedAtMs !== null
      && nowMs - this.lastStartedAtMs < this.minIntervalMs
    ) {
      return this.scheduleTrailing(reason);
    }
    return this.start(reason);
  }

  /** Cancel a pending coalesced sweep (daemon shutdown). */
  dispose(): void {
    if (this.trailing?.timer) clearTimeout(this.trailing.timer);
    this.trailing = null;
  }

  private start(reason: string): Promise<MetaTaskRefreshResult> {
    this.lastStartedAtMs = this.now();
    this.inFlight = this.runRefresh(reason, this.lastStartedAtMs).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private scheduleTrailing(reason: string): Promise<MetaTaskRefreshResult> {
    if (this.trailing) return this.trailing.promise;
    const waitMs = Math.max(0, (this.lastStartedAtMs ?? this.now()) + this.minIntervalMs - this.now());
    const entry: { timer: ReturnType<typeof setTimeout> | null; promise: Promise<MetaTaskRefreshResult> } = {
      timer: null,
      promise: null as unknown as Promise<MetaTaskRefreshResult>,
    };
    entry.promise = new Promise<MetaTaskRefreshResult>((resolve) => {
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
  private deadlinePending(
    projection: MetaTaskTaskProjection,
    taskSet: MetaTaskTaskEventSet,
    nowMs: number
  ): boolean {
    const deadline = nextTimeDeadlineMs(projection, {
      challengeTimestampsMs: taskSet.scoped
        .filter((pin) => pin.path === 'challenge')
        .map((pin) => pin.timestampMs),
    });
    if (deadline === null) return false;
    // The engine transitions on `now > deadline`, so a deadline below the last
    // replay instant already fired then; only [evaluatedAtMs, now) can still trip.
    const evaluatedAtMs = projection.freshness?.evaluatedAtMs ?? 0;
    return deadline >= evaluatedAtMs && deadline < nowMs;
  }

  private async runRefresh(reason: string, nowMs: number): Promise<MetaTaskRefreshResult> {
    const store = this.options.store();
    await store.setRefreshing(true);
    try {
      const collected = await collectMetaTaskEvents(this.options.collectOptions);
      await store.upsertEvents(collected.events);
      const allEvents = await store.loadEvents();
      // Same-side roster pins travel with the event set: the engine filters a
      // post-H_ACT2 vote whose voter shares a roster group with the submitter
      // or the root author (pre-H_ACT2 votes stay untouched, so the pilots'
      // projections are unchanged).
      const rosterPins = rosterPinsFromEvents(allEvents);
      const roots = allEvents.filter((event) => event.path === 'task');
      const persisted = new Map((await store.projectionSweepState()).map((row) => [row.rootPinId, row]));
      const projections: MetaTaskTaskProjection[] = [];
      const liveRootIds: string[] = [];
      const dirtyKeys: Record<string, string> = {};
      for (const root of roots) {
        // Live roots are declared even when their replay fails, so a malformed
        // task keeps its last good row instead of being pruned.
        liveRootIds.push(root.pinId);
        let taskSet: MetaTaskTaskEventSet;
        try {
          taskSet = taskEventSet(allEvents, { rootPinId: root.pinId });
        } catch {
          continue;
        }
        const dirtyKey = taskDirtyKey(taskSet, { rosterPins });
        dirtyKeys[root.pinId] = dirtyKey;
        const previous = persisted.get(root.pinId);
        if (
          previous
          && previous.dirtyKey === dirtyKey
          && !this.deadlinePending(previous.projection, taskSet, nowMs)
        ) {
          // Unchanged event set, no pending clock: the persisted row already
          // says exactly what a replay would — leave it untouched.
          continue;
        }
        try {
          projections.push(
            replayMetaTask(allEvents, {
              rootPinId: root.pinId,
              now: nowMs,
              evaluatedAtMs: nowMs,
              rosterPins,
            })
          );
        } catch {
          // one malformed task must not fail the sweep; next refresh retries it
        }
      }
      // Identity enrichment runs only for the replayed roots: a skipped row
      // already carries its persisted identities.
      await store.enrichIdentities(projections);
      await store.saveProjections(projections, { liveRootIds, dirtyKeys });
      const boundaryBlock = projections.reduce(
        (max, projection) => Math.max(max, projection.freshness.boundaryBlock),
        -1
      );
      await store.markRefreshDone(true, null, boundaryBlock);
      await store.bumpSeq();
      return { ok: true, board: await store.board(this.roster()), error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.markRefreshDone(false, message, -1);
      return { ok: false, board: await store.board(this.roster()), error: message };
    }
  }
}
