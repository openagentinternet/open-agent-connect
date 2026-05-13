import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter, LlmTokenUsage } from '../types';
import { buildProcessEnv, filterBlockedArgs, shutdownChildProcess, stringifyError, type LlmBackend, type LlmBackendFactory } from './backend';

const DEFAULT_TIMEOUT_MS = 1_200_000;
const CODEBUDDY_USAGE_KEY = 'codebuddy';

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

function buildCodeBuddyArgs(request: LlmExecutionRequest): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '-y',
    '--permission-mode',
    'acceptEdits',
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
    '--print': { takesValue: false },
    '--output-format': { takesValue: true },
    '--input-format': { takesValue: true },
    '--permission-mode': { takesValue: true },
    '--dangerously-skip-permissions': { takesValue: false },
    '-y': { takesValue: false },
    '--resume': { takesValue: true },
    '--max-turns': { takesValue: true },
    '--model': { takesValue: true },
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

export function createCodeBuddyBackend(binaryPath: string, env?: Record<string, string>): LlmBackend {
  return {
    provider: 'codebuddy',
    async execute(request: LlmExecutionRequest, emitter: LlmEventEmitter, signal: AbortSignal): Promise<LlmExecutionResult> {
      const startedAt = Date.now();
      const args = buildCodeBuddyArgs(request);
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
              if (blockType === 'text' || blockType === 'output_text') {
                const text = String(block.text ?? block.content ?? '');
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
                  tool: String(block.name ?? block.tool ?? 'tool'),
                  callId: String(block.id ?? block.callId ?? 'tool'),
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
              errorMessage = resultOutput ?? 'codebuddy execution failed';
            }
            try {
              child.stdin.end();
            } catch {
              // Best effort.
            }
          }
        });
        rl.on('close', () => resolve());
      });

      const writePrompt = (): void => {
        const prompt = {
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: request.prompt }],
          },
        };
        child.stdin.write(`${JSON.stringify(prompt)}\n`);
      };

      const timeoutMs = request.timeout ?? DEFAULT_TIMEOUT_MS;
      let timeout: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        timeout = setTimeout(() => resolve('timeout'), timeoutMs);
      });

      try {
        writePrompt();
      } catch (error) {
        await shutdownChildProcess(child, childExit);
        return {
          status: 'failed',
          output,
          error: stringifyError(error),
          providerSessionId: sessionId,
          durationMs: Date.now() - startedAt,
        };
      }

      const outcome = await Promise.race([
        childExit.then((code) => ({ type: 'exit' as const, code })),
        childError.then((error) => ({ type: 'error' as const, error })),
        timeoutPromise.then(() => ({ type: 'timeout' as const })),
      ]);
      if (timeout) clearTimeout(timeout);
      await stdoutDone.catch(() => {});

      if (outcome.type === 'timeout') {
        await shutdownChildProcess(child, childExit, { terminate: true });
        return {
          status: 'timeout',
          output,
          error: `codebuddy execution timed out after ${timeoutMs}ms`,
          providerSessionId: sessionId,
          durationMs: Date.now() - startedAt,
        };
      }

      if (outcome.type === 'error') {
        return {
          status: 'failed',
          output,
          error: stringifyError(outcome.error),
          providerSessionId: sessionId,
          durationMs: Date.now() - startedAt,
        };
      }

      if (outcome.code && outcome.code !== 0 && status === 'completed') {
        status = 'failed';
        errorMessage = stderr || `codebuddy exited with code ${outcome.code}`;
      }

      const finalOutput = resultOutput ?? output;
      return {
        status,
        output: finalOutput,
        error: errorMessage,
        providerSessionId: sessionId,
        durationMs: resultDurationMs ?? Date.now() - startedAt,
        usage: usage.inputTokens || usage.outputTokens ? { [CODEBUDDY_USAGE_KEY]: usage } : undefined,
      };
    },
  };
}

export const codebuddyBackendFactory: LlmBackendFactory = createCodeBuddyBackend;
