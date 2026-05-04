import type { ChildProcess } from 'node:child_process';
import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter } from '../types';

const DEFAULT_SHUTDOWN_GRACE_MS = 250;
const DEFAULT_SHUTDOWN_KILL_WAIT_MS = 1_000;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isChildRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

export async function shutdownChildProcess(
  child: ChildProcess,
  childExit: Promise<unknown>,
  options: {
    terminate?: boolean;
    graceMs?: number;
    killWaitMs?: number;
  } = {},
): Promise<void> {
  const graceMs = options.graceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  const killWaitMs = options.killWaitMs ?? DEFAULT_SHUTDOWN_KILL_WAIT_MS;

  if (options.terminate && isChildRunning(child)) {
    try {
      child.kill('SIGTERM');
    } catch {
      // Best effort.
    }
  }

  const exitedDuringGrace = await Promise.race([
    childExit.then(() => true),
    delay(graceMs).then(() => false),
  ]);
  if (exitedDuringGrace) return;

  if (isChildRunning(child)) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Best effort.
    }
  }

  await Promise.race([
    childExit,
    delay(killWaitMs),
  ]);
}
