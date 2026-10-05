/**
 * MetaTask writer (M6 — OAC port of the IDBots metataskAgentTools guards).
 *
 * Every check in this file exists to NOT SPEND A PIN on something replay
 * would ignore: a refused write costs 0 sats and returns the exact refusal
 * the IDBots tools return. The guard logic is ported verbatim; the seams
 * (actor identity, event pool, projection reads, pin writes, roster,
 * activation boundary) are injected so the daemon handlers stay thin wiring
 * and the tests drive the guards without a chain.
 *
 * Verb map (IDBots tool → OAC function):
 *   metatask_claim        → claimMetaTaskNode
 *   metatask_submit       → submitMetaTaskWork
 *   metatask_verify       → verifyMetaTaskSubmission
 *   metatask_release      → releaseMetaTaskClaim
 *   metatask_publish      → publishMetaTask
 *   metatask_publish_spec → publishMetaTaskSpec
 *   metatask_amend        → amendMetaTask
 */
import type { MetaTaskChainEvent, MetaTaskTaskProjection } from './engine/types';
export interface MetaTaskPinWriteResult {
    pinId: string;
    txids: string[];
    totalCost?: number;
}
/** Everything a verb needs from its host; the daemon supplies the real ones. */
export interface MetaTaskWriteSeams {
    /** The acting bot's globalMetaId (protocol §12 item 6 identity checks). */
    actorGlobalMetaId: string;
    /** globalMetaIds of every local bot (the same-owner roster side). */
    localRosterMetaIds: () => string[];
    /** The cached chain event pool (engine input). */
    loadEvents: () => Promise<MetaTaskChainEvent[]>;
    /** Persisted projection for a task root (null = unknown). */
    getProjection: (rootPinId: string) => Promise<MetaTaskTaskProjection | null>;
    /** H_ACT3 write gate inputs: announced height + local boundary block. */
    activation: () => {
        hAct3: number | null;
        boundaryBlock: number | null;
    };
    /** Write one /protocols/metatask/<subpath> pin as the actor. */
    writeProtocolPin: (subpath: string, payload: Record<string, unknown>, origin: string) => Promise<MetaTaskPinWriteResult>;
    /** Write one raw-path pin (the roster reference sibling). */
    writeRawPin: (protocolPath: string, payload: Record<string, unknown>, origin: string) => Promise<MetaTaskPinWriteResult>;
    /** Fire-and-forget projection refresh after a successful write. */
    refreshInBackground: (reason: string) => void;
}
export type MetaTaskWriteOutcome<T> = {
    ok: true;
    data: T;
} | {
    ok: false;
    refusal: string;
};
interface SpecPayloadInput {
    name?: string;
    lang?: string;
    entry?: string;
    script?: string;
    input?: unknown;
    output?: unknown;
    validation?: Record<string, unknown>;
    /** v1.3 draft §4.1 workspace declaration (git/metafile/inline/pin/…). */
    workspace?: unknown;
}
/**
 * The canonical spec pin payload (protocol §3), shared by publish and
 * publish_spec so both writers emit byte-identical field order: name, lang,
 * entry, script, input, output, then validation when present.
 */
export declare const buildSpecPayload: (spec: SpecPayloadInput) => Record<string, unknown>;
/**
 * Writer-side check for the v1.3 draft §4.1 spec.workspace declaration. The
 * engine never reads `workspace` (except the submit guard's git-bundle
 * enforcement on type:"git"), so a malformed declaration would silently
 * dead-letter the artifact contract — refuse it before any spend.
 */
export declare const specWorkspaceRefusal: (workspace: unknown) => string | null;
/** Refuse a missing/empty/bogus script reference; returns null when usable. */
export declare const specScriptRefusal: (script: unknown) => string | null;
/**
 * Writer-side enforcement of the v1.2.1 spec.validation block (protocol §3,
 * mandatory for specs published at/after H_ACT2): all three items present,
 * null_tolerance boolean true, enumeration_closure declaring the closure plus
 * an integer self-check count, and proposition_fidelity pointing at a REAL
 * independent correspondence artifact. Returns a refusal message or null.
 */
export declare const specValidationRefusal: (validation: unknown) => string | null;
interface CompetitiveNodeShape {
    id: string;
    deps: string[];
    params: Record<string, unknown>;
}
/**
 * Writer-side competitive tree invariants (draft §3.1/§3.3, authoring list §5):
 * `finalnode` names a live node; the deps graph is acyclic with exactly ONE
 * sink and that sink IS the final node; every node is reachable from an entry
 * node (deps: []) and can reach the final node.
 */
export declare const competitiveGraphRefusal: (nodes: readonly CompetitiveNodeShape[], finalnode: string) => string | null;
/**
 * Every competitive node carries a non-empty rubric (draft §3.3, pinned
 * location: `params.rubric` — an array of strings with at least one non-empty
 * entry).
 */
export declare const competitiveRubricRefusal: (node: {
    id: string;
    params: Record<string, unknown>;
}) => string | null;
export interface ClaimInput {
    rootPinId: string;
    node: string;
}
export declare function claimMetaTaskNode(seams: MetaTaskWriteSeams, args: ClaimInput): Promise<MetaTaskWriteOutcome<{
    claimPinId: string;
    txids: string[];
    node: string;
    taskid: string;
    intentOnly?: boolean;
    note: string;
}>>;
export interface SubmitInput {
    rootPinId: string;
    node: string;
    result?: Record<string, unknown>;
    contentType?: string;
    attachment?: string;
    claimPinId?: string;
    childIds?: string[];
    parentRefs?: Record<string, string>;
    supersedePinId?: string;
}
export declare function submitMetaTaskWork(seams: MetaTaskWriteSeams, args: SubmitInput): Promise<MetaTaskWriteOutcome<{
    submissionPinId: string;
    txids: string[];
    innerHash: string;
    outerHash: string;
    mode?: 'competitive';
    parentrefs?: Record<string, string> | null;
    optimistic?: boolean;
    optimisticParents?: {
        parent: string;
        pinId: string;
        state: string;
    }[];
    claimPinIdIgnored?: boolean;
    note: string;
}>>;
export interface VerifyInput {
    targetPinId: string;
    verdict: 'pass' | 'fail';
    method: string;
    semanticCheck: string;
    failReason?: string;
    evidence?: string;
}
export declare function verifyMetaTaskSubmission(seams: MetaTaskWriteSeams, args: VerifyInput): Promise<MetaTaskWriteOutcome<{
    verifyPinId: string;
    txids: string[];
}>>;
export interface ReleaseInput {
    rootPinId: string;
    node: string;
    claimPinId: string;
}
export declare function releaseMetaTaskClaim(seams: MetaTaskWriteSeams, args: ReleaseInput): Promise<MetaTaskWriteOutcome<{
    releasePinId: string;
    txids: string[];
}>>;
export interface PublishInput {
    title?: string;
    brief?: string;
    nodes?: Array<Record<string, unknown>>;
    spec?: Record<string, unknown>;
    policy?: Record<string, unknown>;
    tags?: string[];
    allowPreActivation?: boolean;
    draftsFile?: string;
    taskId?: string;
    specPinByKey?: Record<string, string>;
}
export declare function publishMetaTask(seams: MetaTaskWriteSeams, args: PublishInput): Promise<MetaTaskWriteOutcome<{
    taskRootPinId: string;
    treePinId: string;
    specPinId: string;
    rosterPinId: string | null;
    txids: string[];
    source: 'draftsFile' | 'inline';
    taskId?: string;
    mode?: 'competitive';
    finalnode?: string;
    preActivationOverride?: boolean;
    activationNote?: string;
    policyWarnings?: string[];
    reminder: string;
}>>;
export interface PublishSpecInput {
    name?: string;
    lang?: string;
    entry?: string;
    script?: string;
    input?: unknown;
    output?: unknown;
    workspace?: Record<string, unknown>;
    validation?: Record<string, unknown>;
    enforceHAct2Validation?: boolean;
    draftsFile?: string;
    specKey?: string;
}
export declare function publishMetaTaskSpec(seams: MetaTaskWriteSeams, args: PublishSpecInput): Promise<MetaTaskWriteOutcome<{
    specPinId: string;
    txids: string[];
    totalCost?: number;
    name: string;
    lang: string;
    entry: string;
    hasValidation: boolean;
    source: 'draftsFile' | 'inline';
    specKey?: string;
    note: string;
}>>;
export interface AmendInput {
    rootPinId: string;
    ops: Array<Record<string, unknown>>;
}
export declare function amendMetaTask(seams: MetaTaskWriteSeams, args: AmendInput): Promise<MetaTaskWriteOutcome<{
    amendPinId: string;
    bases: string;
    txids: string[];
}>>;
export {};
