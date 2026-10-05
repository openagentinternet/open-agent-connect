import type { MetaTaskChainEvent, MetaTaskTaskProjection, TaskBody } from './types';
export interface ReplayOptions {
    /** Task root pin; omitted = latest task pin in the pool. */
    rootPinId?: string;
    /** Fixed clock (ms epoch) for TTL / review-window / challenge-expiry derivation. Omit = no expiry. */
    now?: number;
    hAct?: number;
    hAct2?: number | null;
    evaluatedAtMs?: number;
    /** Roster pin bodies by pinId (same-side review filtering, H_ACT2-gated only). */
    rosterPins?: Record<string, unknown>;
}
export interface MetaTaskEventHashEntry {
    path: string;
    pinId: string;
    height: number;
    txIndex: number;
}
/**
 * One task root's replay-relevant event set — the SINGLE source of truth for
 * membership, shared by replayMetaTask and the refresher's dirty-root check so
 * the two can never drift.
 *
 * Membership (protocol v1.2.1 settlement.eventSetHash.membership):
 *  - the root task pin and the tree pin it references (`treeid`);
 *  - every pin carrying `taskid === rootPinId` (claim/release/submission/
 *    verify/amend/challenge), excluding the task/tree/spec paths;
 *  - spec pins ONLY via the root's `specid` (node-level specid overrides are
 *    not task members);
 *  - verify/challenge pins scope by `targetid` (a submission of this task).
 */
export interface MetaTaskTaskEventSet {
    rootPin: MetaTaskChainEvent;
    rootAuthor: string;
    taskBody: TaskBody;
    treePinId: string;
    treePin: MetaTaskChainEvent | null;
    /** Task submissions (taskid-scoped), in chain order. */
    submissions: MetaTaskChainEvent[];
    /** Submission pin ids of this task — the verify/challenge target universe. */
    knownTargets: Set<string>;
    /** Every pin that can affect this task's replay, confirmed AND mempool. */
    scoped: MetaTaskChainEvent[];
    /** Same pins keyed by pinId (the replay walk's membership view). */
    scopedByPin: Map<string, MetaTaskChainEvent>;
    /** eventSetHash input rows — the engine's recipe, confirmed pins only. */
    hashEntries: MetaTaskEventHashEntry[];
    /** Highest confirmed height in the set (-1 when nothing is confirmed). */
    boundaryBlock: number;
    /** Scoped pins excluded from eventSetHash (height < 0 = mempool). */
    mempoolPinIds: string[];
}
/**
 * Compute a task's replay-relevant event set from a raw event pool. Pure and
 * side-effect free: replayMetaTask passes its own byPath so the sweep of a
 * large pool is not repeated, external callers (the refresher) omit it.
 */
export declare function taskEventSet(events: MetaTaskChainEvent[], options?: {
    rootPinId?: string;
    byPath?: Map<string, MetaTaskChainEvent[]>;
}): MetaTaskTaskEventSet;
/**
 * Stable dirty key for a task root: everything replayMetaTask reads.
 *
 *  - the engine's eventSetHash INPUT (shared helper, so the two can never
 *    drift);
 *  - the scoped-but-unconfirmed (mempool) pins. The eventSetHash recipe
 *    deliberately excludes height < 0 pins, but they DO act in the replay walk
 *    (a brand-new unconfirmed submission must dirty its root), so they are part
 *    of this key while the engine's own eventSetHash stays untouched;
 *  - a BODY fingerprint of every scoped event. Pin ids and heights alone do not
 *    change when the indexer's content contract degrades (truncated summary →
 *    empty body) or when a later sweep recovers the full body again, so without
 *    the body the root would stay "clean" and a broken projection would stick
 *    forever;
 *  - the roster pin the task's split references. Same-side roster filtering
 *    reads that pin's body, and it is NOT part of the task's own event set
 *    (reference pin, no taskid), so its arrival or absence must dirty the root
 *    on its own.
 *
 * The body fingerprints deliberately changed this key's format: every root is
 * re-dirtied ONCE on upgrade (one extra replay per task, then stable again).
 * The engine's protocol eventSetHash recipe is untouched by this.
 *
 * `PROJECTION_FORMAT_VERSION` salts the key with the projection FORMAT version
 * (not the protocol version): whenever the projection shape or replay semantics
 * change (e.g. competitive mode added `submissions`/`satisfied`), cached
 * projections written by an older build are invalidated once, forcing a single
 * re-replay per root — otherwise a pre-upgrade cache would keep serving the old
 * format forever because the chain events did not change.
 *
 * Equal keys ⇒ the same inputs produce the same projection, time-driven expiry
 * aside; that residual is covered by nextTimeDeadlineMs.
 */
export declare const PROJECTION_FORMAT_VERSION = 3;
export declare const taskDirtyKey: (taskSet: MetaTaskTaskEventSet, options?: {
    rosterPins?: Record<string, unknown>;
}) => string;
/**
 * Replay one MetaTask from its event set. Baseline node states follow the
 * reference Python engine exactly (final-holder anchoring, last-valid vote
 * per bot with #8/#9 filtered first, quorum judgment, immediate reopen on a
 * valid fail). v1.2 features (amend / supersede / challenge / settlement)
 * are H_ACT2-gated per the rev-2 registration draft.
 *
 * Node universe: only the effective (post-amend) tree exists. Claims,
 * releases, submissions and cycles naming any other node id — a stray claim
 * on an invented node, or a node an effective amend removed — are dropped
 * and recorded in `ignoredEvents` with reason 'unknown_node'; they never
 * create node state, appear in openNodes, count in progress, or join the
 * settlement weight table.
 */
export declare function replayMetaTask(events: MetaTaskChainEvent[], options?: ReplayOptions): MetaTaskTaskProjection;
