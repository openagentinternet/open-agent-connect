import type { LlmExecutionResult, LlmEventEmitter, LlmTokenUsage } from '../types';
export declare const DEFAULT_PROCESS_TIMEOUT_MS = 1200000;
export interface JsonProcessRunResult {
    status: LlmExecutionResult['status'];
    error?: string;
    durationMs: number;
    exitCode: number | null;
}
export interface JsonProcessRunInput {
    label: string;
    binaryPath: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    requestEnv?: Record<string, string>;
    timeoutMs?: number;
    signal: AbortSignal;
    emitter: LlmEventEmitter;
    jsonStreams: Array<'stdout' | 'stderr'>;
    normalizeStreamPrefixes?: boolean;
    onJson(message: Record<string, unknown>, stream: 'stdout' | 'stderr'): void;
    onNonJsonLine?(line: string, stream: 'stdout' | 'stderr'): void;
}
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function getString(value: unknown): string | undefined;
export declare function numberFromKeys(source: Record<string, unknown>, keys: string[]): number;
export declare function extractUsage(value: unknown): LlmTokenUsage | undefined;
export declare function addUsage(target: LlmTokenUsage, value: unknown): void;
export declare function usageRecordHasTokens(usage: LlmTokenUsage): boolean;
export declare function resolveJsonProcessError(processResult: JsonProcessRunResult, protocolStatus: LlmExecutionResult['status'], protocolError: string | undefined): string | undefined;
export declare function stringifyContent(value: unknown): string;
export declare function hasArg(args: string[] | undefined, flag: string): boolean;
export declare function runJsonLineProcess(input: JsonProcessRunInput): Promise<JsonProcessRunResult>;
