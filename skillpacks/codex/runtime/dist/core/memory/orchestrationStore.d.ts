import type { MetabotPaths } from '../state/paths';
export type OrchestrationTaskStatus = 'planning' | 'running' | 'review' | 'completed' | 'failed' | 'cancelled';
export type OrchestrationStepStatus = 'blocked' | 'ready' | 'queued' | 'running' | 'waiting_input' | 'completed' | 'failed' | 'cancelled';
export type OrchestrationAttemptStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled';
export interface OrchestrationAttempt {
    id: string;
    status: OrchestrationAttemptStatus;
    dshSessionId: string | null;
    handoff: string | null;
    error: string | null;
    /** Set once the terminal notification has been delivered to the twin. */
    notifiedAt: number | null;
    startedAt: number;
    endedAt: number | null;
}
export interface OrchestrationStep {
    id: string;
    workerSlug: string;
    objective: string;
    acceptanceCriteria: string[];
    permissionScope: Record<string, unknown> | null;
    /** Step ids that must reach completed before this step becomes ready. */
    dependsOn: string[];
    idempotencyKey: string;
    status: OrchestrationStepStatus;
    attempts: OrchestrationAttempt[];
    createdAt: number;
    updatedAt: number;
}
export interface OrchestrationTask {
    id: string;
    title: string;
    goal: string;
    intent: string | null;
    ownerGlobalMetaId: string | null;
    status: OrchestrationTaskStatus;
    steps: OrchestrationStep[];
    createdAt: number;
    updatedAt: number;
}
export interface CreateOrchestrationStepInput {
    workerSlug: string;
    objective: string;
    acceptanceCriteria?: string[];
    permissionScope?: Record<string, unknown> | null;
    dependsOn?: string[];
    idempotencyKey?: string;
}
export interface OrchestrationStore {
    createTask(input: {
        title: string;
        goal: string;
        intent?: string;
        ownerGlobalMetaId?: string | null;
        steps?: CreateOrchestrationStepInput[];
    }): Promise<OrchestrationTask>;
    getTask(id: string): Promise<OrchestrationTask | null>;
    listTasks(options?: {
        status?: OrchestrationTaskStatus;
        limit?: number;
    }): Promise<OrchestrationTask[]>;
    updateTaskStatus(id: string, status: OrchestrationTaskStatus): Promise<OrchestrationTask | null>;
    updateStep(taskId: string, stepId: string, patch: {
        status?: OrchestrationStepStatus;
        workerSlug?: string;
    }): Promise<OrchestrationStep | null>;
    addAttempt(taskId: string, stepId: string, input?: {
        dshSessionId?: string | null;
    }): Promise<OrchestrationAttempt | null>;
    updateAttempt(taskId: string, stepId: string, attemptId: string, patch: {
        status?: OrchestrationAttemptStatus;
        dshSessionId?: string | null;
        handoff?: string | null;
        error?: string | null;
    }): Promise<OrchestrationAttempt | null>;
    markAttemptNotified(taskId: string, stepId: string, attemptId: string): Promise<void>;
    /** Terminal attempts whose twin notification has not been delivered yet. */
    listUnnotifiedTerminalAttempts(): Promise<Array<{
        task: OrchestrationTask;
        step: OrchestrationStep;
        attempt: OrchestrationAttempt;
    }>>;
    /** Running/queued workload of one worker (for roster availability). */
    activeStepCountForWorker(workerSlug: string): Promise<number>;
    findStepByIdempotencyKey(key: string): Promise<{
        task: OrchestrationTask;
        step: OrchestrationStep;
    } | null>;
}
export declare function createOrchestrationStore(paths: MetabotPaths): OrchestrationStore;
