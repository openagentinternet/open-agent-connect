import type { MetabotCommandResult } from '../../core/contracts/commandResult';
export interface PollTraceInput {
    traceId: string;
    localUiUrl: string;
    requestFn: (method: 'GET' | 'POST' | 'DELETE', path: string) => Promise<MetabotCommandResult<unknown>>;
    stderr: Pick<NodeJS.WriteStream, 'write'>;
    timeoutMs?: number;
    intervalMs?: number;
}
export interface PollTraceResult {
    completed: boolean;
    terminalStatus?: string | null;
    trace?: Record<string, unknown>;
}
export declare function pollTraceUntilComplete(input: PollTraceInput): Promise<PollTraceResult>;
