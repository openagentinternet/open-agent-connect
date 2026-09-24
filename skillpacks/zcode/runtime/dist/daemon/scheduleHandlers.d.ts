/**
 * Scheduled-task daemon handler group: the /api/schedule/* verbs. Business
 * rules live in core/schedule/store; this file is wiring + input
 * normalization only (the grouptask handler-group pattern). The host lease
 * lives in the daemon process and is shared with the daemon tick via the
 * injected `hostLeases` map; `createScheduleStore` is shared too so
 * claim/complete go through the same per-profile write queue the tick uses.
 */
import { type ScheduleStore } from '../core/schedule/store';
import type { LlmExecutor } from '../core/llm/executor';
import type { MetabotDaemonHttpHandlers } from './routes/types';
export interface ScheduleDaemonHandlersInput {
    systemHomeDir: string;
    createScheduleStore?: (homeDir: string) => ScheduleStore;
    hostLeases?: Map<string, {
        host: string;
        expiresAtMs: number;
    }>;
    /**
     * The daemon's shared LLM executor (local-runtime chain) for the run-now
     * verb. Absent → run-now fails with a clear error when an LLM call is
     * actually needed, same contract as the dream run handler.
     */
    llmExecutor?: Pick<LlmExecutor, 'execute' | 'getSession'> | null;
    log?: (message: string) => void;
}
export declare function normalizeScheduleStoreInput(value: unknown): string;
export declare function createScheduleDaemonHandlers(input: ScheduleDaemonHandlersInput): NonNullable<MetabotDaemonHttpHandlers['schedule']>;
