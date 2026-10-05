/**
 * MetaTask protocol constants.
 *
 * H_ACT: the #8/#9 vote-gate switch point (engine ruling, 2026-09-16) —
 * frozen forever, do not change. NOTE: the chain passed this height (v1.2.1
 * published at chain height 191204); the gates are LIVE for new votes.
 * H_ACT2: the v1.2 feature switch point — published in the v1.2.1
 * registration body (pin cbae49e0…, announced 2026-09-27, activation
 * announcement pin c9ded493…). Round block height 191500.
 */
export declare const METATASK_PROTOCOL_ROOT = "/protocols/metatask";
/** The nine replay event paths: engine input and eventSetHash membership. */
export declare const METATASK_EVENT_PATHS: readonly ["task", "tree", "spec", "claim", "release", "submission", "verify", "amend", "challenge"];
export type MetaTaskEventPath = (typeof METATASK_EVENT_PATHS)[number];
/**
 * Same-side roster declaration (protocol §10.4 verifyCount): a reference pin
 * published by `metatask_publish` as a flat sibling of the protocol root and
 * referenced only through `policy.split.rosterid`. It is NOT a replay event —
 * it carries no taskid, never joins eventSetHash, and is read by the engine
 * solely through its task's split policy.
 */
export declare const METATASK_ROSTER_PATH = "/protocols/metatask-roster";
export declare const METATASK_ROSTER_SEGMENT = "metatask-roster";
/** Every pool the collector sweeps: the nine event paths + the roster pool. */
export declare const METATASK_COLLECTED_PATHS: readonly ["task", "tree", "spec", "claim", "release", "submission", "verify", "amend", "challenge", "metatask-roster"];
export type MetaTaskCollectedPath = (typeof METATASK_COLLECTED_PATHS)[number];
/** Pool URL for a collected segment (the roster pin is a flat sibling). */
export declare const metataskPoolPath: (segment: MetaTaskCollectedPath) => string;
/** Engine-ruled switch for the #8/#9 vote gates. Frozen. */
export declare const H_ACT = 190000;
/** v1.2 feature gate — published in the v1.2.1 registration body. */
export declare const H_ACT2: number | null;
/**
 * v1.3 competitive-mode activation gate (protocol v1.3.0 draft §7). NOT
 * enforced by the replay engine: no competitive-mode task exists on-chain yet,
 * so replay accepts `policy.mode: "competitive"` at any height (pre-activation
 * fixtures must stay replayable). The writer side (metatask_publish in
 * metataskAgentTools.ts) refuses pre-activation broadcasts unless the caller
 * passes the explicit pilot/testing escape hatch `allowPreActivation: true`;
 * it reads the announced height from `board.activation.hAct3` (this constant,
 * surfaced by the projection store) and compares it against the refresher's
 * refresh-state boundary block.
 *
 * Announced 2026-10-04 by the protocol owner (AI_Sunny) with the v1.3.0
 * registration pin `fd33de09e0ff314016ff76e12d47c38bb0ee17fc7a9706bbfd3824ded0c0c947i0`
 * (announced at chain height 192281, ~75h notice, procedure floor 72h).
 */
export declare const H_ACT3: number | null;
export declare const hAct2Or: (value: number | null | undefined) => number;
/** Settlement constants (protocol text §11 — deliberately not payload fields). */
export declare const SUBMITTER_SHARE_BP_DEFAULT = 8000;
export declare const SUBMITTER_SHARE_BP_MIN = 6000;
export declare const SUBMITTER_SHARE_BP_MAX = 9000;
export declare const REVIEWER_ACCURACY_FLOOR_BP = 2500;
export declare const CHALLENGE_TTL_DAYS_DEFAULT = 14;
export declare const ENGINE_ALGO_VERSION = "idbots-metatask-engine/1.2.1";
/** Competitive-mode tasks (v1.3.0 draft §6) report this version instead. */
export declare const ENGINE_ALGO_VERSION_COMPETITIVE = "idbots-metatask-engine/1.3.0";
