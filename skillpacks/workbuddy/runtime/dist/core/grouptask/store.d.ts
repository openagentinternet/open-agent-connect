/**
 * Group Task store: file-backed CRUD for tasks / members / deliverables /
 * transitions / status events / checkpoints / integrity events / plan changes
 * / acceptance summaries, plus the task status state machine and an engine kv.
 *
 * Layout (storage layout v2, all under the CHAIR profile's runtime root):
 *   .runtime/grouptask/state.json            — entities + kv + id sequence
 *   .runtime/grouptask/messages/<groupId>.json — decrypted transcript cache
 *
 * Writes are atomic (tmp file + rename) and serialized through an in-process
 * queue; the daemon is the only writer (CLI verbs delegate over HTTP).
 */
import type { MetabotPaths } from '../state/paths';
import { type GroupTaskAcceptanceSummary, type GroupTaskCheckpoint, type GroupTaskCheckpointStatus, type GroupTaskDeliverable, type GroupTaskDeliverableStatus, type GroupTaskIntegrityEvent, type GroupTaskIntegrityEventType, type GroupTaskMember, type GroupTaskMemberRole, type GroupTaskMemberStatus, type GroupTaskMessage, type GroupTaskPlanChange, type GroupTaskRecord, type GroupTaskStatus, type GroupTaskStatusEvent, type GroupTaskStatusEventActor, type GroupTaskTransition } from './types';
export interface GroupTaskStateFile {
    seq: number;
    tasks: GroupTaskRecord[];
    members: GroupTaskMember[];
    deliverables: GroupTaskDeliverable[];
    transitions: GroupTaskTransition[];
    statusEvents: GroupTaskStatusEvent[];
    checkpoints: GroupTaskCheckpoint[];
    integrityEvents: GroupTaskIntegrityEvent[];
    planChanges: GroupTaskPlanChange[];
    acceptanceSummaries: GroupTaskAcceptanceSummary[];
    kv: Record<string, string>;
}
export interface CreateGroupTaskRecordInput {
    groupId: string;
    title: string;
    goal: string;
    acceptanceCriteria?: string | null;
    chairSlug: string;
    chairGlobalMetaId?: string | null;
    createdBy: string;
    createPinId?: string | null;
}
export interface AddGroupTaskMemberInput {
    taskId: number;
    slug: string | null;
    globalMetaId?: string | null;
    role: GroupTaskMemberRole;
    joinedPinId?: string | null;
    displayName?: string | null;
}
export interface MarkGroupTaskMemberRemovedInput {
    taskId: number;
    slug?: string | null;
    globalMetaId?: string | null;
    removePinId?: string | null;
}
export interface AddGroupTaskDeliverableInput {
    taskId: number;
    msgPinId?: string | null;
    authorGlobalMetaId?: string | null;
    kind?: string | null;
    uri?: string | null;
}
export interface UpdateGroupTaskStatusOptions {
    actor?: GroupTaskStatusEventActor;
    reason?: string | null;
}
export interface GroupTaskMessagesPage {
    messages: GroupTaskMessage[];
    /** Total cached rows for the group. */
    total: number;
}
export declare class GroupTaskStoreError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export interface GroupTaskStore {
    /** Absolute grouptask root (…/.runtime/grouptask). */
    readonly root: string;
    createTask(input: CreateGroupTaskRecordInput): Promise<GroupTaskRecord>;
    getTaskById(taskId: number): Promise<GroupTaskRecord | null>;
    getTaskByGroupId(groupId: string): Promise<GroupTaskRecord | null>;
    listTasks(filter?: {
        status?: GroupTaskStatus;
        includeArchived?: boolean;
    }): Promise<GroupTaskRecord[]>;
    listArchivedTasks(): Promise<GroupTaskRecord[]>;
    updateTaskStatus(taskId: number, next: GroupTaskStatus, opts?: UpdateGroupTaskStatusOptions): Promise<GroupTaskRecord>;
    updateTaskRating(taskId: number, rating: number, ratingComment?: string | null): Promise<GroupTaskRecord>;
    updateTaskCursor(taskId: number, lastProcessedIndex: number): Promise<void>;
    touchTaskDriven(taskId: number, atMs?: number): Promise<void>;
    renameTask(taskId: number, displayName: string): Promise<GroupTaskRecord>;
    setTaskPinned(taskId: number, pinned: boolean): Promise<GroupTaskRecord>;
    archiveTask(taskId: number): Promise<GroupTaskRecord>;
    unarchiveTask(taskId: number): Promise<GroupTaskRecord>;
    addMember(input: AddGroupTaskMemberInput): Promise<GroupTaskMember>;
    listMembers(taskId: number, opts?: {
        includeRemoved?: boolean;
    }): Promise<GroupTaskMember[]>;
    updateMemberJoinedPinId(taskId: number, slug: string, joinedPinId: string): Promise<void>;
    updateRemoteMemberJoinedPinId(taskId: number, globalMetaId: string, joinedPinId: string): Promise<void>;
    markMemberRemoved(input: MarkGroupTaskMemberRemovedInput): Promise<GroupTaskMember>;
    setMemberStatus(taskId: number, slug: string | null, status: GroupTaskMemberStatus, globalMetaId?: string | null): Promise<GroupTaskMember | null>;
    addDeliverable(input: AddGroupTaskDeliverableInput): Promise<GroupTaskDeliverable>;
    listDeliverables(taskId: number): Promise<GroupTaskDeliverable[]>;
    hasDeliverableWithMsgPin(taskId: number, msgPinId: string): Promise<boolean>;
    deleteDeliverable(deliverableId: number): Promise<boolean>;
    updateDeliverableVerification(deliverableId: number, verification: string | null, confirmation: 'unconfirmed' | 'confirmed', status?: GroupTaskDeliverableStatus): Promise<void>;
    updateDeliverablesStatusByTask(taskId: number, fromStatus: GroupTaskDeliverableStatus, toStatus: GroupTaskDeliverableStatus): Promise<number>;
    addTransition(input: {
        taskId: number;
        fromStatus: GroupTaskStatus | null;
        toStatus: GroupTaskStatus;
        actor?: string | null;
        reason?: string | null;
    }): Promise<GroupTaskTransition>;
    listTransitions(taskId: number): Promise<GroupTaskTransition[]>;
    listStatusEvents(taskId: number): Promise<GroupTaskStatusEvent[]>;
    openCheckpoint(taskId: number, topic: string | null, openedMsgPinId: string | null): Promise<GroupTaskCheckpoint>;
    resolveCheckpoint(taskId: number, resolution: string | null, resolvedMsgPinId: string | null): Promise<GroupTaskCheckpoint | null>;
    closeOpenCheckpoints(taskId: number, status: GroupTaskCheckpointStatus, resolution: string | null): Promise<number>;
    listCheckpoints(taskId: number): Promise<GroupTaskCheckpoint[]>;
    addIntegrityEvent(input: {
        taskId: number;
        msgPinId?: string | null;
        authorGlobalMetaId?: string | null;
        eventType: GroupTaskIntegrityEventType;
        detail?: string | null;
    }): Promise<GroupTaskIntegrityEvent>;
    listIntegrityEvents(taskId: number): Promise<GroupTaskIntegrityEvent[]>;
    hasIntegrityEventWithMsgPin(taskId: number, msgPinId: string): Promise<boolean>;
    addPlanChange(input: {
        taskId: number;
        msgPinId?: string | null;
        authorGlobalMetaId?: string | null;
        summary: string;
    }): Promise<GroupTaskPlanChange>;
    listPlanChanges(taskId: number): Promise<GroupTaskPlanChange[]>;
    addAcceptanceSummary(input: Omit<GroupTaskAcceptanceSummary, 'id' | 'version' | 'generatedAt'> & {
        generatedAt?: number;
    }): Promise<GroupTaskAcceptanceSummary>;
    getLatestAcceptanceSummary(taskId: number): Promise<GroupTaskAcceptanceSummary | null>;
    finalizeAcceptanceSummary(taskId: number, input: {
        outcome: GroupTaskStatus;
        rating: number | null;
        ratingComment: string | null;
    }): Promise<void>;
    updateAcceptanceSummaryPublishedPin(taskId: number, pinId: string): Promise<void>;
    appendMessages(groupId: string, messages: GroupTaskMessage[]): Promise<number>;
    listMessages(groupId: string, opts?: {
        limit?: number;
        beforeIndex?: number;
    }): Promise<GroupTaskMessagesPage>;
    getMessageByPinId(groupId: string, pinId: string): Promise<GroupTaskMessage | null>;
    getMessageCursor(groupId: string): Promise<number>;
    getMembersLastSpeakAt(groupId: string, globalMetaIds: Array<string | null>): Promise<Map<string, number>>;
    getMembersWorkingAt(groupId: string, globalMetaIds: Array<string | null>): Promise<Map<string, number>>;
    kvGet(key: string): Promise<string | undefined>;
    kvSet(key: string, value: string): Promise<void>;
    kvDelete(key: string): Promise<void>;
}
export declare function resolveGroupTaskRoot(paths: MetabotPaths): string;
export declare function createGroupTaskStore(paths: MetabotPaths): GroupTaskStore;
