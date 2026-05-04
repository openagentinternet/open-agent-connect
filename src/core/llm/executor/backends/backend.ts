import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter } from '../types';

export interface LlmBackend {
  readonly provider: string;
  execute(
    request: LlmExecutionRequest,
    emitter: LlmEventEmitter,
    signal: AbortSignal,
  ): Promise<LlmExecutionResult>;
}

export type LlmBackendFactory = (binaryPath: string, env?: Record<string, string>) => LlmBackend;

export interface BlockedArgSpec {
  takesValue: boolean;
}

export function filterBlockedArgs(args: string[] | undefined, blocked: Record<string, BlockedArgSpec>): string[] {
  if (!args || args.length === 0) return [];

  const filtered: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const eqIndex = arg.indexOf('=');
    const key = eqIndex >= 0 ? arg.slice(0, eqIndex) : arg;
    const spec = blocked[key];
    if (!spec) {
      filtered.push(arg);
      continue;
    }
    if (spec.takesValue && eqIndex < 0 && i + 1 < args.length) {
      i += 1;
    }
  }
  return filtered;
}

export function buildProcessEnv(
  baseEnv: Record<string, string> | undefined,
  requestEnv: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(baseEnv ?? {}),
    ...(requestEnv ?? {}),
  };
}

export function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
}
