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

/**
 * Env var names that must never leak into spawned CLI processes. Names are
 * upper-cased before matching because Windows env names are case-insensitive.
 * Deliberately over-matches: a false positive only drops a variable the child
 * process did not strictly need.
 */
const SENSITIVE_ENV_NAME_PATTERNS: readonly RegExp[] = [
  // Suffix-style secret names: API_KEY, MY_TOKEN, DB_PASSWORD,
  // SERVICE_PRIVATE_KEY, DEPLOY_PASSPHRASE, APP_CREDENTIALS, BOT_AUTH, ...
  /(^|_)(API_?KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|PRIVATE_?KEY|CREDENTIALS|AUTH)$/,
  // Provider/credential families whose non-suffix variables are also secret:
  // AWS_SECRET_ACCESS_KEY, GITHUB_TOKEN, NPM_TOKEN, OPENAI_API_KEY, ...
  /^(AWS|GITHUB|GITLAB|NPM|OPENAI|ANTHROPIC|GOOGLE|GCLOUD|AZURE|FIREBASE|HUGGINGFACE|OPENROUTER|DEEPSEEK|ZHIPU|DASHSCOPE|MOONSHOT)_/,
];

function isSensitiveEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  return SENSITIVE_ENV_NAME_PATTERNS.some((pattern) => pattern.test(upper));
}

/**
 * Drop sensitive entries from a process-level env before it is spread into a
 * spawned CLI process. Remote-driven turns run backends with bypassed
 * permissions, so any variable that reaches the child env is readable by
 * untrusted prompt content through the CLI's own tools. Explicitly configured
 * env (executor config or request env) is the sanctioned credential channel
 * and must not go through this scrub.
 */
export function scrubSensitiveEnvVars(env: Record<string, string | undefined>): Record<string, string> {
  const scrubbed: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string' || isSensitiveEnvName(name)) continue;
    scrubbed[name] = value;
  }
  return scrubbed;
}

export function buildProcessEnv(
  baseEnv: Record<string, string> | undefined,
  requestEnv: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  return {
    // The daemon's own env may hold API keys and tokens; strip the sensitive
    // families before spreading. baseEnv/requestEnv stay verbatim.
    ...scrubSensitiveEnvVars(process.env),
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
