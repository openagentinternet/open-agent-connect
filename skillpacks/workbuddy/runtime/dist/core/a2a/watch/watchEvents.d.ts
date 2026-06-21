import type { PublicStatus } from '../publicStatus';
export interface TraceWatchEvent {
    traceId: string;
    sessionId: string;
    taskRunId: string | null;
    status: PublicStatus;
    terminal: boolean;
    observedAt: number;
}
export declare function isTerminalTraceWatchStatus(status: PublicStatus): boolean;
