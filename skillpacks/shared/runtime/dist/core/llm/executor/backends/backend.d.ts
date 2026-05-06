import type { ChildProcess } from 'node:child_process';
import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter } from '../types';
export interface LlmBackend {
    readonly provider: string;
    execute(request: LlmExecutionRequest, emitter: LlmEventEmitter, signal: AbortSignal): Promise<LlmExecutionResult>;
}
export type LlmBackendFactory = (binaryPath: string, env?: Record<string, string>) => LlmBackend;
export interface BlockedArgSpec {
    takesValue: boolean;
}
export declare function filterBlockedArgs(args: string[] | undefined, blocked: Record<string, BlockedArgSpec>): string[];
export declare function buildProcessEnv(baseEnv: Record<string, string> | undefined, requestEnv: Record<string, string> | undefined): NodeJS.ProcessEnv;
export declare function stringifyError(error: unknown): string;
export declare function shutdownChildProcess(child: ChildProcess, childExit: Promise<unknown>, options?: {
    terminate?: boolean;
    graceMs?: number;
    killWaitMs?: number;
}): Promise<void>;
