import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter, LlmTokenUsage } from '../types';
import { buildProcessEnv, filterBlockedArgs, shutdownChildProcess, stringifyError, type LlmBackend, type LlmBackendFactory } from './backend';

const DEFAULT_TIMEOUT_MS = 1_200_000;
const CLAUDE_USAGE_KEY = 'claude-code';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberFromKeys(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function addUsage(target: LlmTokenUsage, source: unknown): void {
  if (!isRecord(source)) return;
  target.inputTokens += numberFromKeys(source, ['inputTokens', 'input_tokens', 'input', 'prompt_tokens']);
  target.outputTokens += numberFromKeys(source, ['outputTokens', 'output_tokens', 'output', 'completion_tokens']);
  const cacheRead = numberFromKeys(source, ['cacheReadTokens', 'cache_read_tokens', 'cache_read_input_tokens', 'cached_input_tokens']);
  const cacheWrite = numberFromKeys(source, ['cacheWriteTokens', 'cache_write_tokens', 'cache_creation_input_tokens']);
  if (cacheRead) target.cacheReadTokens = (target.cacheReadTokens ?? 0) + cacheRead;
  if (cacheWrite) target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + cacheWrite;
}

function buildClaudeArgs(request: LlmExecutionRequest): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'bypassPermissions',
    '--strict-mcp-config',
  ];

  if (request.maxTurns && request.maxTurns > 0) {
    args.push('--max-turns', String(request.maxTurns));
  }
  if (request.model) {
    args.push('--model', request.model);
  }
  if (request.systemPrompt && !request.resumeSessionId) {
    args.push('--append-system-prompt', request.systemPrompt);
  }
  if (request.resumeSessionId) {
    args.push('--resume', request.resumeSessionId);
  }

  args.push(...filterBlockedArgs(request.extraArgs, {
    '-p': { takesValue: false },
    '--output-format': { takesValue: true },
    '--input-format': { takesValue: true },
    '--permission-mode': { takesValue: true },
    '--mcp-config': { takesValue: true },
    '--resume': { takesValue: true },
    '--max-turns': { takesValue: true },
  }));

  return args;
}

function stringifyToolResultContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (isRecord(entry) && typeof entry.text === 'string') return entry.text;
      return typeof entry === 'string' ? entry : JSON.stringify(entry);
    }).join('');
  }
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

export function createClaudeBackend(binaryPath: string, env?: Record<string, string>): LlmBackend {
  return {
    provider: 'claude-code',
    async execute(request: LlmExecutionRequest, emitter: LlmEventEmitter, signal: AbortSignal): Promise<LlmExecutionResult> {
      const startedAt = Date.now();
      const args = buildClaudeArgs(request);
      const child = spawn(binaryPath, args, {
        cwd: request.cwd,
        env: buildProcessEnv(env, request.env),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      let resultOutput: string | undefined;
      let stderr = '';
      let sessionId: string | undefined;
      let status: LlmExecutionResult['status'] = 'completed';
      let errorMessage: string | undefined;
      let resultDurationMs: number | undefined;
      const usage: LlmTokenUsage = { inputTokens: 0, outputTokens: 0 };

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        if (stderr.length > 4096) stderr = stderr.slice(-4096);
      });

      const childExit = new Promise<number | null>((resolve) => {
        child.on('close', (code) => resolve(code));
      });
      const childError = new Promise<Error>((resolve) => {
        child.once('error', (error) => resolve(error));
      });

      const writeJsonLine = (message: Record<string, unknown>): void => {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      };

      const stdoutDone = new Promise<void>((resolve) => {
        child.stdout.setEncoding('utf8');
        const rl = readline.createInterface({ input: child.stdout });
        rl.on('line', (line) => {
          if (!line.trim()) return;
          let message: Record<string, unknown>;
          try {
            message = JSON.parse(line) as Record<string, unknown>;
          } catch {
            emitter.emit({ type: 'log', level: 'debug', message: line });
            return;
          }

          const type = typeof message.type === 'string' ? message.type : '';
          if (type === 'control_request') {
            const request = isRecord(message.request) ? message.request : {};
            const requestId = typeof message.request_id === 'string' ? message.request_id : '';
            const input = isRecord(request.input) ? request.input : {};
            try {
              writeJsonLine({
                type: 'control_response',
                response: {
                  subtype: 'success',
                  request_id: requestId,
                  response: {
                    behavior: 'allow',
                    updatedInput: input,
                  },
                },
              });
            } catch (error) {
              status = 'failed';
              errorMessage = stringifyError(error);
              emitter.emit({ type: 'error', message: errorMessage });
            }
            return;
          }

          if (type === 'system') {
            sessionId = typeof message.session_id === 'string' ? message.session_id : sessionId;
            emitter.emit({ type: 'status', status: 'running', sessionId });
            return;
          }

          if (type === 'assistant') {
            const assistant = isRecord(message.message) ? message.message : {};
            addUsage(usage, assistant.usage);
            const content = Array.isArray(assistant.content) ? assistant.content : [];
            for (const block of content) {
              if (!isRecord(block)) continue;
              const blockType = typeof block.type === 'string' ? block.type : '';
              if (blockType === 'text') {
                const text = String(block.text ?? '');
                if (text) {
                  output += text;
                  emitter.emit({ type: 'text', content: text });
                }
              } else if (blockType === 'thinking') {
                const thinking = String(block.thinking ?? block.text ?? '');
                if (thinking) emitter.emit({ type: 'thinking', content: thinking });
              } else if (blockType === 'tool_use') {
                emitter.emit({
                  type: 'tool_use',
                  tool: String(block.name ?? 'tool'),
                  callId: String(block.id ?? 'tool'),
                  input: isRecord(block.input) ? block.input : {},
                });
              }
            }
            return;
          }

          if (type === 'user') {
            const user = isRecord(message.message) ? message.message : {};
            const content = Array.isArray(user.content) ? user.content : [];
            for (const block of content) {
              if (!isRecord(block) || block.type !== 'tool_result') continue;
              emitter.emit({
                type: 'tool_result',
                callId: String(block.tool_use_id ?? block.id ?? 'tool'),
                output: stringifyToolResultContent(block.content),
              });
            }
            return;
          }

          if (type === 'result') {
            sessionId = typeof message.session_id === 'string' ? message.session_id : sessionId;
            resultOutput = typeof message.result === 'string' ? message.result : resultOutput;
            if (typeof message.duration_ms === 'number' && Number.isFinite(message.duration_ms)) {
              resultDurationMs = message.duration_ms;
            }
            if (message.is_error === true) {
              status = 'failed';
              errorMessage = resultOutput ?? 'claude execution failed';
            }
            try {
              child.stdin.end();
            } catch {
              // Best effort.
            }
            return;
          }

          if (type === 'log') {
            const log = isRecord(message.log) ? message.log : {};
            emitter.emit({
              type: 'log',
              level: String(log.level ?? 'info'),
              message: String(log.message ?? ''),
            });
          }
        });
        rl.on('close', () => resolve());
      });

      const timeoutMs = request.timeout ?? DEFAULT_TIMEOUT_MS;
      let timeoutHandle: NodeJS.Timeout | undefined;
      const timeout = new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          status = 'timeout';
          errorMessage = `claude timed out after ${timeoutMs}ms`;
          try {
            child.kill('SIGTERM');
          } catch {
            // Best effort.
          }
          resolve();
        }, timeoutMs);
      });

      const abort = new Promise<void>((resolve) => {
        if (signal.aborted) {
          status = 'cancelled';
          errorMessage = 'claude execution cancelled';
          resolve();
          return;
        }
        signal.addEventListener('abort', () => {
          status = 'cancelled';
          errorMessage = 'claude execution cancelled';
          try {
            child.kill('SIGTERM');
          } catch {
            // Best effort.
          }
          resolve();
        }, { once: true });
      });

      try {
        writeJsonLine({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: request.prompt }],
          },
        });

        const completion = await Promise.race([
          Promise.all([stdoutDone, childExit]).then(([, exitCode]) => ({ type: 'exit' as const, exitCode })),
          timeout.then(() => ({ type: 'terminal' as const })),
          abort.then(() => ({ type: 'terminal' as const })),
          childError.then((error) => ({ type: 'error' as const, error })),
        ]);
        if (completion.type === 'error') {
          status = 'failed';
          errorMessage = stringifyError(completion.error);
        } else if (completion.type === 'exit' && completion.exitCode !== 0 && status === 'completed') {
          status = 'failed';
          errorMessage = `claude exited with code ${completion.exitCode ?? 'unknown'}`;
        }
      } catch (error) {
        if (status === 'completed') {
          status = 'failed';
          errorMessage = stringifyError(error);
        }
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        try {
          child.stdin.end();
        } catch {
          // Best effort.
        }
        await shutdownChildProcess(child, childExit, {
          terminate: status !== 'completed',
          graceMs: status === 'completed' ? 2_000 : 250,
        });
      }

      if (stderr.trim() && status !== 'completed') {
        errorMessage = `${errorMessage ?? 'claude failed'}\n${stderr.trim()}`;
      }

      if (status === 'failed' && request.resumeSessionId && sessionId && sessionId !== request.resumeSessionId) {
        sessionId = undefined;
      }

      return {
        status,
        output: resultOutput ?? output,
        error: errorMessage,
        providerSessionId: sessionId,
        durationMs: resultDurationMs ?? (Date.now() - startedAt),
        usage: usage.inputTokens || usage.outputTokens || usage.cacheReadTokens || usage.cacheWriteTokens
          ? { [CLAUDE_USAGE_KEY]: usage }
          : undefined,
      };
    },
  };
}

export const claudeBackendFactory: LlmBackendFactory = createClaudeBackend;
