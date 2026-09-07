/**
 * Group Task prompt builders — the OAC port of IDBots groupTaskPrompts
 * (single-commander contract: the chair is the ONLY coordinator; the host
 * never speaks in the group — it feeds environment facts to the chair through
 * the host-notes channel instead). Pure string assembly: identity block, task
 * header, roster, role playbooks, the volatile turn context (authoritative
 * state line + recent transcript window + target message), and the
 * host-generated one-shot directives (planning / minimal planning / host
 * notes / supervisor wake). The engine feeds the output to the profile's LLM
 * runtime.
 */
import type { GroupTaskMessage, GroupTaskRecord } from './types';
export declare const GROUP_TASK_CONTEXT_MESSAGE_COUNT = 20;
export interface GroupTaskPromptIdentity {
    name: string;
    globalMetaId?: string | null;
    role?: string | null;
    bio?: string | null;
    soul?: string | null;
    goal?: string | null;
}
export interface GroupTaskPromptSeat {
    name: string;
    role: 'chair' | 'worker';
    remote: boolean;
    /** Optional profile fields for the roster-profiles section (capped 200). */
    roleText?: string | null;
    bio?: string | null;
    goal?: string | null;
}
export interface BuildGroupTaskSystemPromptInput {
    identity: GroupTaskPromptIdentity;
    task: Pick<GroupTaskRecord, 'title' | 'goal' | 'acceptanceCriteria'>;
    seats: GroupTaskPromptSeat[];
    chairName: string;
    ownerGlobalMetaId?: string | null;
    role: 'chair' | 'worker';
}
/** Assemble the full system prompt for one chair/worker seat. */
export declare function buildGroupTaskSystemPrompt(input: BuildGroupTaskSystemPromptInput): string;
export interface BuildGroupTaskTurnContextInput {
    task: Pick<GroupTaskRecord, 'id' | 'title'>;
    /** Recent transcript, oldest first (already truncated by the caller). */
    recentMessages: GroupTaskMessage[];
    /** The message this turn responds to (null for host-directed turns). */
    target: GroupTaskMessage | null;
    /** Optional host-side notes (deliverable verification results etc.). */
    notes?: string[];
    /**
     * The authoritative host-DB state line (chair turns only): outranks the
     * model's memory (AUTHORITY OF HOST STATE playbook rule).
     */
    stateLine?: string | null;
    nowMs?: number;
    contextMessageCount?: number;
}
/** Build the user-message context for a reply turn. */
export declare function buildGroupTaskTurnContext(input: BuildGroupTaskTurnContextInput): string;
export interface BuildPlanningDirectiveInput {
    task: Pick<GroupTaskRecord, 'id' | 'title' | 'goal' | 'acceptanceCriteria'>;
    seats: GroupTaskPromptSeat[];
    recentMessages: GroupTaskMessage[];
    nowMs?: number;
}
/**
 * The one-shot planning instruction: distribute the work and end with
 * [STATUS:EXECUTING]. Does not consume the reply budget or cooldowns. The
 * engine appends a deterministic [STATUS:EXECUTING] footer when the reply
 * carries no honored status tag.
 */
export declare function buildPlanningDirective(input: BuildPlanningDirectiveInput): string;
/**
 * Minimal planning directive (IDBots EP33 P2): the group log already contains
 * chair-authored opening content (welcome / dispatches), so the bootstrap must
 * not repeat any of it — post ONLY what is still missing (typically the
 * lifecycle transition), or [NO_REPLY] when nothing is missing.
 */
export declare function buildMinimalPlanningDirective(input: BuildPlanningDirectiveInput): string;
export interface BuildHostNotesDirectiveInput {
    task: Pick<GroupTaskRecord, 'id' | 'title'>;
    /** Rendered note lines, e.g. `[no_ack → designer] …` (oldest first). */
    noteLines: string[];
    recentMessages: GroupTaskMessage[];
    nowMs?: number;
}
/**
 * The ONE dedicated chair turn that delivers pending host environment notes.
 * The host never speaks in the group; the chair reads these facts and decides
 * what the group needs to hear, in its own voice (or stays silent).
 */
export declare function buildHostNotesDirective(input: BuildHostNotesDirectiveInput): string;
export interface BuildSupervisorWakeDirectiveInput {
    task: Pick<GroupTaskRecord, 'id' | 'title' | 'status'>;
    kind: 'nudge' | 'resume';
    memberName: string | null;
    memberNote: string | null;
    recentMessages: GroupTaskMessage[];
    nowMs?: number;
}
/**
 * One-shot chair instruction after an owner supervise action: nudge a silent
 * member for an ACK/status, or re-engage the roster after a dispatch pause.
 * Single-commander: supervision signals are delivered through the chair's own
 * turn context — the host never posts them into the group. In review the
 * nudge keeps its teeth through the review exception (a genuine defect MAY
 * reopen rework); an open checkpoint defers the turn entirely (engine-side).
 */
export declare function buildSupervisorWakeDirective(input: BuildSupervisorWakeDirectiveInput): string;
