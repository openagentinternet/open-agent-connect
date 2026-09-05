import type { MetabotPaths } from '../state/paths';
export type ScheduleSpec = {
    type: 'at';
    datetime: string;
} | {
    type: 'interval';
    intervalMs: number;
} | {
    type: 'cron';
    expression: string;
};
export type ScheduleChannel = 'auto' | 'host' | 'daemon';
export type ScheduleRunStatus = 'running' | 'success' | 'error';
export type ScheduleRunTrigger = 'scheduled' | 'manual';
export type ScheduleRunExecutor = 'daemon' | 'host' | 'cli';
export type ScheduleTaskStatus = 'success' | 'error' | 'running' | null;
export interface ScheduledTask {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    schedule: ScheduleSpec;
    prompt: string;
    workingDirectory: string;
    channel: ScheduleChannel;
    /** Date-only YYYY-MM-DD, null = never expires. */
    expiresAt: string | null;
    state: {
        nextRunAtMs: number | null;
        lastRunAtMs: number | null;
        lastStatus: ScheduleTaskStatus;
        lastError: string | null;
        lastDurationMs: number | null;
        runningAtMs: number | null;
        consecutiveErrors: number;
    };
    createdAt: string;
    updatedAt: string;
}
export interface ScheduledTaskRun {
    id: string;
    taskId: string;
    status: ScheduleRunStatus;
    trigger: ScheduleRunTrigger;
    executor: ScheduleRunExecutor | null;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    error: string | null;
}
export interface CreateScheduleTaskInput {
    name: string;
    description?: string;
    prompt: string;
    schedule: ScheduleSpec;
    workingDirectory?: string;
    channel?: ScheduleChannel;
    expiresAt?: string | null;
    enabled?: boolean;
}
export type ScheduleEnableWarning = 'TASK_EXPIRED' | 'TASK_AT_PAST';
export type ScheduleClaimResult = {
    ok: true;
    run: ScheduledTaskRun;
    task: ScheduledTask;
} | {
    ok: false;
    code: 'task_not_found' | 'task_expired' | 'already_running';
};
export type ScheduleCompleteResult = {
    settled: boolean;
    run: ScheduledTaskRun;
    task: ScheduledTask | null;
} | {
    notFound: true;
};
export interface ScheduleStore {
    listTasks(): Promise<ScheduledTask[]>;
    getTask(id: string): Promise<ScheduledTask | null>;
    createTask(input: CreateScheduleTaskInput, options?: {
        now?: number;
    }): Promise<ScheduledTask>;
    updateTask(id: string, partial: Partial<CreateScheduleTaskInput>, options?: {
        now?: number;
    }): Promise<{
        task: ScheduledTask;
        warnings: ScheduleEnableWarning[];
    } | {
        notFound: true;
    }>;
    deleteTask(id: string): Promise<{
        deleted: boolean;
    }>;
    setEnabled(id: string, enabled: boolean, options?: {
        now?: number;
    }): Promise<{
        task: ScheduledTask;
        warnings: ScheduleEnableWarning[];
    } | {
        notFound: true;
    }>;
    /** Due tasks (enabled, unexpired, not running, nextRunAtMs <= now), oldest first. */
    listDue(options?: {
        now?: number;
    }): Promise<ScheduledTask[]>;
    /** Atomically create the run row and mark the task running. */
    claim(id: string, input: {
        trigger: ScheduleRunTrigger;
        executor: ScheduleRunExecutor | null;
    }, options?: {
        now?: number;
    }): Promise<ScheduleClaimResult>;
    /** Settle a claimed run; applies auto-disable/prune rules. */
    complete(runId: string, input: {
        error?: string | null;
        durationMs?: number | null;
    }, options?: {
        now?: number;
    }): Promise<ScheduleCompleteResult>;
    listRuns(options?: {
        taskId?: string;
        limit?: number;
    }): Promise<ScheduledTaskRun[]>;
}
/** Runs left `running` longer than this are treated as crashed and reset. */
export declare const STALE_RUNNING_MS: number;
/** Host heartbeat lease duration: while fresh, the daemon hands `auto`/`host`
 *  tasks for that profile to the host. */
export declare const SCHEDULE_HOST_LEASE_MS: number;
/** Run history kept per task (IDBots parity). */
export declare const MAX_RUNS_PER_TASK = 100;
/** Minimum interval between fires for interval tasks. */
export declare const MIN_INTERVAL_MS = 60000;
/** Maximum run-history page a caller may request. */
export declare const MAX_RUNS_LIST_LIMIT = 1000;
export declare const CRASH_RECOVERY_ERROR = "Process stopped during execution";
export declare const STALE_RUNNING_RESET_ERROR = "stale running run reset";
export declare function validateScheduleSpec(value: unknown): {
    spec: ScheduleSpec | null;
    error: string | null;
};
export declare function computeNextRunAtMs(task: ScheduledTask, nowMs: number): number | null;
/** Warnings for enabling a task: expired, or a one-shot `at` in the past. */
export declare function enableWarnings(task: ScheduledTask, nowMs: number): ScheduleEnableWarning[];
export declare function createScheduleStore(paths: MetabotPaths): ScheduleStore;
