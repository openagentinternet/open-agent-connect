/**
 * Group Task tag grammar + turn-taking decisions — pure functions ported from
 * the proven IDBots engine (groupTaskDeliverableParser / mention utils /
 * decideGroupTaskResponders). No IO here: the engine module wires these to the
 * store and the chain.
 *
 * Tag emitters: chair-only tags are [STATUS:...], [CHECKPOINT:...],
 * [CHECKPOINT_RESOLVED...], [PLAN_CHANGE:...]; worker tags are [DELIVERABLE],
 * [WORKING], [STANDBY]; [NO_REPLY] is an LLM-output escape hatch (never sent
 * on-chain); [DEPENDS_ON:...] rides on chair dispatch messages.
 */
import type { GroupTaskMessage, GroupTaskStatus } from './types';
export declare const DELIVERABLE_TAG: RegExp;
export declare const STATUS_TAG: RegExp;
export declare const CHECKPOINT_OPEN_TAG: RegExp;
export declare const CHECKPOINT_RESOLVED_TAG: RegExp;
export declare const PLAN_CHANGE_TAG: RegExp;
/** Must START the LLM reply to suppress the on-chain send. */
export declare const NO_REPLY_TAG: RegExp;
export declare const WORKING_TAG: RegExp;
export declare const STANDBY_TAG: RegExp;
export declare const DEPENDS_ON_TAG: RegExp;
/** Strips every checkpoint-family tag for display summaries. */
export declare const CHECKPOINT_ANY_TAG: RegExp;
/** Host-generated notice prefix (welcome / pause / resume / review lines). */
export declare const HOST_NOTICE_PREFIX = "[GROUP_TASK_NOTICE:";
export type GroupTaskDeliverableKind = 'metaapp' | 'metafile' | 'link' | 'pin' | 'text';
export interface GroupTaskDeliverableCandidate {
    kind: GroupTaskDeliverableKind;
    /** Canonical uri (null for text deliverables). */
    uri: string | null;
    /** Raw payload text after the tag on that line. */
    payload: string;
    /** True when the payload announces a correction of a previous deliverable. */
    correction: boolean;
}
export interface GroupTaskWorkingAck {
    /** Free-text note after the tag, capped at 120 chars. */
    note: string;
    /** Optional ETA in minutes ("30 分钟" / "30 min"), null when absent. */
    etaMinutes: number | null;
}
export interface ParsedGroupTaskTags {
    deliverables: GroupTaskDeliverableCandidate[];
    /** Lowercased [STATUS:...] target, null when absent. */
    status: 'executing' | 'review' | null;
    /** [CHECKPOINT: topic] topic, null when absent. */
    checkpointTopic: string | null;
    checkpointResolved: boolean;
    /** Decision text of [CHECKPOINT_RESOLVED: decision], null when bare/absent. */
    checkpointDecision: string | null;
    /** One-line [PLAN_CHANGE: ...] disclosures, capped at 240 chars each. */
    planChanges: string[];
    working: GroupTaskWorkingAck | null;
    standby: boolean;
    /** [DEPENDS_ON: token] token, null when absent. */
    dependsOn: string | null;
}
/**
 * Extract deliverable candidates from a message. Line-scoped: each line
 * containing [DELIVERABLE] yields one candidate per tag occurrence, its
 * payload being the text after that tag. Lines with a URI-shaped token that
 * fails validation are dropped (fabrication guard); URI-free payloads become
 * text deliverables.
 */
export declare function parseDeliverableCandidates(content: string): GroupTaskDeliverableCandidate[];
/** Parse a [WORKING] acknowledgement: note after the tag + optional ETA. */
export declare function parseWorkingAck(content: string): GroupTaskWorkingAck | null;
/** Parse every engine-relevant tag of one message body. */
export declare function parseGroupTaskTags(content: string): ParsedGroupTaskTags;
/** True when an LLM reply opted out of speaking ([NO_REPLY] at line start). */
export declare function isNoReplyResponse(reply: string): boolean;
/** True for host-generated notice lines (never trigger engine replies). */
export declare function isHostNotice(content: string): boolean;
/** [DEPENDS_ON] token is enforceable only when it names a pin or txid. */
export declare function isEnforceableDependencyToken(token: string): boolean;
export interface GroupTaskMentionTarget {
    name: string;
    globalMetaId: string | null;
    metaId?: string | null;
}
/**
 * A bot is mentioned when the message mention array carries its
 * GlobalMetaID/MetaID, or the body contains an explicit `@Name` with word
 * boundaries (a bare name without `@` does not count).
 */
export declare function isMentioned(message: Pick<GroupTaskMessage, 'content' | 'mention'>, target: GroupTaskMentionTarget): boolean;
export type GroupTaskReplyReason = 'worker_mentioned' | 'chair_mentioned' | 'chair_owner_message' | 'chair_deliverable' | 'chair_floor_control';
export interface GroupTaskResponderSeat {
    /** Local profile slug; remote members are never responders. */
    slug: string;
    role: 'chair' | 'worker';
    name: string;
    globalMetaId: string | null;
    metaId?: string | null;
}
export interface GroupTaskResponderDecision {
    slug: string;
    role: 'chair' | 'worker';
    reason: GroupTaskReplyReason;
}
export interface DecideRespondersInput {
    message: Pick<GroupTaskMessage, 'content' | 'mention' | 'senderGlobalMetaId' | 'senderSuspect'>;
    taskStatus: GroupTaskStatus;
    hasOpenCheckpoint: boolean;
    /** Active local seats only (removed and remote members excluded). */
    seats: GroupTaskResponderSeat[];
    ownerGlobalMetaId: string | null;
}
/**
 * Decide which local seats reply to one inbound message (IDBots
 * decideGroupTaskResponders semantics):
 * - never: empty body, terminal task, suspect sender, self, host notices;
 * - human-gate (review OR open checkpoint): workers silent even when
 *   mentioned; chair answers the owner only;
 * - normal: workers only when mentioned; chair by mention > owner message >
 *   [DELIVERABLE] > floor control (only when nobody specific was addressed).
 */
export declare function decideGroupTaskResponders(input: DecideRespondersInput): GroupTaskResponderDecision[];
