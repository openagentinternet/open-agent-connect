/**
 * Group Task prompt builders — the OAC port of IDBots groupTaskPrompts.
 * Pure string assembly: identity block, task header, roster, role playbooks,
 * the volatile turn context (recent transcript window + target message), and
 * the host-generated planning directive. The engine feeds the output to the
 * profile's LLM runtime.
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
 * [STATUS:EXECUTING]. Does not consume the reply budget or cooldowns.
 */
export declare function buildPlanningDirective(input: BuildPlanningDirectiveInput): string;
export interface BuildRosterChangeDirectiveInput {
    task: Pick<GroupTaskRecord, 'id' | 'title' | 'goal' | 'acceptanceCriteria'>;
    joinedName: string;
    joinedSkills: string[];
    seats: GroupTaskPromptSeat[];
    recentMessages: GroupTaskMessage[];
    nowMs?: number;
}
/**
 * Wake-up instruction when a remote member joined after the plan was posted
 * (the planning turn raced the OpenTeam accepts, or someone joined mid-task).
 * The chair must reconcile the plan with the current roster in one message.
 */
export declare function buildRosterChangeDirective(input: BuildRosterChangeDirectiveInput): string;
export interface BuildSupervisorWakeDirectiveInput {
    task: Pick<GroupTaskRecord, 'id' | 'title'>;
    kind: 'nudge' | 'resume';
    memberName: string | null;
    memberNote: string | null;
    recentMessages: GroupTaskMessage[];
    nowMs?: number;
}
/**
 * One-shot chair instruction after an owner supervise action: nudge a silent
 * member for an ACK/status, or re-engage the roster after a dispatch pause.
 */
export declare function buildSupervisorWakeDirective(input: BuildSupervisorWakeDirectiveInput): string;
