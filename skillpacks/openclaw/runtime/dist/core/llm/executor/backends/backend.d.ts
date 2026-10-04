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
/**
 * Drop sensitive entries from a process-level env before it is spread into a
 * spawned CLI process. Remote-driven turns run backends with bypassed
 * permissions, so any variable that reaches the child env is readable by
 * untrusted prompt content through the CLI's own tools. Explicitly configured
 * env (executor config or request env) is the sanctioned credential channel
 * and must not go through this scrub.
 */
export declare function scrubSensitiveEnvVars(env: Record<string, string | undefined>): Record<string, string>;
export declare function buildProcessEnv(baseEnv: Record<string, string> | undefined, requestEnv: Record<string, string> | undefined): NodeJS.ProcessEnv;
export declare function stringifyError(error: unknown): string;
export declare function shutdownChildProcess(child: ChildProcess, childExit: Promise<unknown>, options?: {
    terminate?: boolean;
    graceMs?: number;
    killWaitMs?: number;
}): Promise<void>;
