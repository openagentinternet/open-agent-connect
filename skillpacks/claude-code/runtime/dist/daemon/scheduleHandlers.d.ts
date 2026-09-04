/**
 * Scheduled-task daemon handler group: the /api/schedule/* verbs. Business
 * rules live in core/schedule/store; this file is wiring + input
 * normalization only (the grouptask handler-group pattern). The host lease
 * lives in the daemon process and is shared with the daemon tick via the
 * injected `hostLeases` map; `createScheduleStore` is shared too so
 * claim/complete go through the same per-profile write queue the tick uses.
 */
import { type ScheduleStore } from '../core/schedule/store';
import type { MetabotDaemonHttpHandlers } from './routes/types';
export interface ScheduleDaemonHandlersInput {
    systemHomeDir: string;
    createScheduleStore?: (homeDir: string) => ScheduleStore;
    hostLeases?: Map<string, {
        host: string;
        expiresAtMs: number;
    }>;
    log?: (message: string) => void;
}
export declare function normalizeScheduleStoreInput(value: unknown): string;
export declare function createScheduleDaemonHandlers(input: ScheduleDaemonHandlersInput): NonNullable<MetabotDaemonHttpHandlers['schedule']>;
