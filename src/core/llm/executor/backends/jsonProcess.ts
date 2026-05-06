import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { LlmExecutionResult, LlmEventEmitter, LlmTokenUsage } from '../types';
import { buildProcessEnv, shutdownChildProcess, stringifyError } from './backend';

export const DEFAULT_PROCESS_TIMEOUT_MS = 1_200_000;

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function numberFromKeys(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

export function extractUsage(value: unknown): LlmTokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const cache = isRecord(value.cache) ? value.cache : {};
  const usage = {
    inputTokens: numberFromKeys(value, ['inputTokens', 'input_tokens', 'input', 'prompt_tokens']),
    outputTokens: numberFromKeys(value, ['outputTokens', 'output_tokens', 'output', 'completion_tokens']),
    cacheReadTokens: numberFromKeys(cache, ['read']) || numberFromKeys(value, ['cacheReadTokens', 'cacheRead', 'cache_read_tokens', 'cache_read_input_tokens', 'cache_read', 'cached_input_tokens', 'cachedInputTokens', 'cached']) || undefined,
    cacheWriteTokens: numberFromKeys(cache, ['write']) || numberFromKeys(value, ['cacheWriteTokens', 'cacheWrite', 'cacheCreationInputTokens', 'cache_write_tokens', 'cache_write_input_tokens', 'cache_creation_input_tokens', 'cache_write']) || undefined,
  };
  return usage.inputTokens || usage.outputTokens || usage.cacheReadTokens || usage.cacheWriteTokens
    ? usage
    : undefined;
}

export function addUsage(target: LlmTokenUsage, value: unknown): void {
  const usage = extractUsage(value);
  if (!usage) return;
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  if (usage.cacheReadTokens) target.cacheReadTokens = (target.cacheReadTokens ?? 0) + usage.cacheReadTokens;
  if (usage.cacheWriteTokens) target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + usage.cacheWriteTokens;
}

export function usageRecordHasTokens(usage: LlmTokenUsage): boolean {
  return Boolean(usage.inputTokens || usage.outputTokens || usage.cacheReadTokens || usage.cacheWriteTokens);
}

export function resolveJsonProcessError(
  processResult: JsonProcessRunResult,
  protocolStatus: LlmExecutionResult['status'],
  protocolError: string | undefined,
): string | undefined {
  if (protocolError && protocolStatus === 'failed' && processResult.status !== 'timeout' && processResult.status !== 'cancelled') {
    return protocolError;
  }
  return processResult.error ?? protocolError;
}

export function stringifyContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry === 'string') return entry;
      if (isRecord(entry) && typeof entry.text === 'string') return entry.text;
      return JSON.stringify(entry);
    }).join('');
  }
  return JSON.stringify(value);
}

export function hasArg(args: string[] | undefined, flag: string): boolean {
  return Boolean(args?.some((arg) => arg === flag || arg.startsWith(`${flag}=`)));
}

function stripStreamPrefix(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('stdout:')) return trimmed.slice('stdout:'.length).trimStart();
  if (trimmed.startsWith('stderr:')) return trimmed.slice('stderr:'.length).trimStart();
  return line;
}

export async function runJsonLineProcess(input: JsonProcessRunInput): Promise<JsonProcessRunResult> {
  const startedAt = Date.now();
  const child = spawn(input.binaryPath, input.args, {
    cwd: input.cwd,
    env: buildProcessEnv(input.env, input.requestEnv),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let finalStatus: LlmExecutionResult['status'] = 'completed';
  let finalError: string | undefined;
  let stderrTail = '';

  const childExit = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
  });
  const childError = new Promise<Error>((resolve) => {
    child.once('error', (error) => resolve(error));
  });

  const consumeStream = (stream: NodeJS.ReadableStream, streamName: 'stdout' | 'stderr'): Promise<void> => new Promise((resolve) => {
    const parseJson = input.jsonStreams.includes(streamName);
    stream.setEncoding('utf8');
    const rl = readline.createInterface({ input: stream });
    rl.on('line', (rawLine) => {
      const line = input.normalizeStreamPrefixes ? stripStreamPrefix(rawLine) : rawLine;
      if (streamName === 'stderr' && !parseJson) {
        stderrTail += `${line}\n`;
        if (stderrTail.length > 4096) stderrTail = stderrTail.slice(-4096);
      }
      if (!line.trim()) return;
      if (!parseJson) {
        input.emitter.emit({ type: 'log', level: streamName === 'stderr' ? 'error' : 'debug', message: line });
        return;
      }
      try {
        input.onJson(JSON.parse(line) as Record<string, unknown>, streamName);
      } catch (error) {
        if (error instanceof SyntaxError) {
          input.onNonJsonLine?.(line, streamName);
          input.emitter.emit({ type: 'log', level: 'debug', message: line });
          return;
        }
        finalStatus = 'failed';
        finalError = stringifyError(error);
        input.emitter.emit({ type: 'error', message: finalError });
      }
    });
    rl.on('close', () => resolve());
  });

  const stdoutDone = consumeStream(child.stdout, 'stdout');
  const stderrDone = consumeStream(child.stderr, 'stderr');

  const timeoutMs = input.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      finalStatus = 'timeout';
      finalError = `${input.label} timed out after ${timeoutMs}ms`;
      try {
        child.kill('SIGTERM');
      } catch {
        // Best effort.
      }
      resolve();
    }, timeoutMs);
  });

  const abort = new Promise<void>((resolve) => {
    if (input.signal.aborted) {
      finalStatus = 'cancelled';
      finalError = `${input.label} execution cancelled`;
      resolve();
      return;
    }
    input.signal.addEventListener('abort', () => {
      finalStatus = 'cancelled';
      finalError = `${input.label} execution cancelled`;
      try {
        child.kill('SIGTERM');
      } catch {
        // Best effort.
      }
      resolve();
    }, { once: true });
  });

  let exitCode: number | null = null;
  try {
    const completion = await Promise.race([
      Promise.all([stdoutDone, stderrDone, childExit]).then(([, , code]) => ({ type: 'exit' as const, code })),
      timeout.then(() => ({ type: 'terminal' as const })),
      abort.then(() => ({ type: 'terminal' as const })),
      childError.then((error) => ({ type: 'error' as const, error })),
    ]);
    if (completion.type === 'error') {
      finalStatus = 'failed';
      finalError = stringifyError(completion.error);
    } else if (completion.type === 'exit') {
      exitCode = completion.code;
      if (completion.code !== 0 && finalStatus === 'completed') {
        finalStatus = 'failed';
        finalError = `${input.label} exited with code ${completion.code ?? 'unknown'}`;
      }
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    await shutdownChildProcess(child, childExit, {
      terminate: finalStatus !== 'completed',
      graceMs: finalStatus === 'completed' ? 2_000 : 250,
    });
  }

  if (stderrTail.trim() && finalStatus !== 'completed') {
    finalError = `${finalError ?? `${input.label} failed`}\n${stderrTail.trim()}`;
  }

  return {
    status: finalStatus,
    error: finalError,
    durationMs: Date.now() - startedAt,
    exitCode,
  };
}
