import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { LlmExecutionEvent, LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter, LlmTokenUsage } from '../types';
import { buildProcessEnv, filterBlockedArgs, stringifyError, type LlmBackend, type LlmBackendFactory } from './backend';

const DEFAULT_TIMEOUT_MS = 1_200_000;
const DEFAULT_SEMANTIC_INACTIVITY_TIMEOUT_MS = 600_000;
const CODEX_USAGE_KEY = 'codex';

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberFromKeys(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function extractUsage(value: unknown): LlmTokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    inputTokens: numberFromKeys(value, ['inputTokens', 'input_tokens', 'input', 'prompt_tokens']),
    outputTokens: numberFromKeys(value, ['outputTokens', 'output_tokens', 'output', 'completion_tokens']),
    cacheReadTokens: numberFromKeys(value, ['cacheReadTokens', 'cache_read_tokens', 'cache_read_input_tokens', 'cached_input_tokens']) || undefined,
    cacheWriteTokens: numberFromKeys(value, ['cacheWriteTokens', 'cache_write_tokens', 'cache_creation_input_tokens']) || undefined,
  };
}

function buildCodexArgs(request: LlmExecutionRequest): string[] {
  return [
    'app-server',
    '--listen',
    'stdio://',
    ...filterBlockedArgs(request.extraArgs, {
      '--listen': { takesValue: true },
    }),
  ];
}

function extractThreadId(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const thread = result.thread;
  if (isRecord(thread)) return getString(thread.id);
  return getString(result.threadId);
}

function getNotificationThreadId(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined;
  return getString(params.threadId) ?? getString(params.thread_id);
}

function getItemId(params: unknown): string {
  if (!isRecord(params)) return 'codex-item';
  const item = params.item;
  if (isRecord(item)) return getString(item.id) ?? getString(params.itemId) ?? 'codex-item';
  return getString(params.itemId) ?? 'codex-item';
}

function getItemKind(params: unknown): string {
  if (!isRecord(params)) return '';
  const item = params.item;
  if (isRecord(item)) return getString(item.type) ?? getString(item.kind) ?? '';
  return getString(params.type) ?? getString(params.kind) ?? '';
}

function getCommandInput(params: unknown): Record<string, unknown> {
  if (!isRecord(params)) return {};
  const item = params.item;
  if (isRecord(item)) {
    const command = item.command ?? item.cmd ?? item.input;
    return isRecord(command) ? command : { command };
  }
  return {};
}

function getCompletedOutput(params: unknown): string {
  if (!isRecord(params)) return '';
  const item = params.item;
  if (isRecord(item)) {
    return String(item.output ?? item.result ?? item.text ?? '');
  }
  return String(params.output ?? params.result ?? params.text ?? '');
}

export function createCodexBackend(binaryPath: string, env?: Record<string, string>): LlmBackend {
  return {
    provider: 'codex',
    async execute(request: LlmExecutionRequest, emitter: LlmEventEmitter, signal: AbortSignal): Promise<LlmExecutionResult> {
      const startedAt = Date.now();
      const args = buildCodexArgs(request);
      const child = spawn(binaryPath, args, {
        cwd: request.cwd,
        env: buildProcessEnv(env, request.env),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let nextId = 1;
      const pending = new Map<number | string, PendingRpc>();
      const outputParts: string[] = [];
      let stderr = '';
      let threadId: string | undefined;
      let finalStatus: LlmExecutionResult['status'] = 'completed';
      let finalError: string | undefined;
      let usage: LlmTokenUsage | undefined;
      let turnStarted = false;
      let settled = false;
      let semanticTimer: NodeJS.Timeout | undefined;

      const clearSemanticTimer = () => {
        if (semanticTimer) clearTimeout(semanticTimer);
        semanticTimer = undefined;
      };

      const childExit = new Promise<number | null>((resolve) => {
        child.on('close', (code) => resolve(code));
      });

      const turnDone = new Promise<void>((resolve) => {
        const resolveOnce = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        const resetSemanticTimer = () => {
          clearSemanticTimer();
          const timeout = request.semanticInactivityTimeout ?? DEFAULT_SEMANTIC_INACTIVITY_TIMEOUT_MS;
          semanticTimer = setTimeout(() => {
            finalStatus = 'timeout';
            finalError = `codex semantic inactivity timeout after ${timeout}ms`;
            try {
              child.kill('SIGTERM');
            } catch {
              // Best effort.
            }
            resolveOnce();
          }, timeout);
        };

        const emitSemantic = (event: LlmExecutionEvent) => {
          emitter.emit(event);
          if (event.type === 'text') outputParts.push(event.content);
          resetSemanticTimer();
        };

        const handleRawNotification = (message: JsonRpcMessage) => {
          const method = message.method ?? '';
          const params = message.params;
          const notificationThreadId = getNotificationThreadId(params);
          if (threadId && notificationThreadId && notificationThreadId !== threadId) return;

          if (method === 'turn/started') {
            turnStarted = true;
            emitter.emit({ type: 'status', status: 'running', sessionId: threadId });
            resetSemanticTimer();
            return;
          }

          if (method === 'item/agentMessage/delta') {
            const delta = isRecord(params) ? String(params.delta ?? params.textDelta ?? params.text ?? '') : '';
            if (delta) emitSemantic({ type: 'text', content: delta });
            return;
          }

          if (method === 'item/started') {
            const kind = getItemKind(params);
            if (kind === 'commandExecution') {
              emitSemantic({ type: 'tool_use', tool: 'exec_command', callId: getItemId(params), input: getCommandInput(params) });
            } else if (kind === 'fileChange') {
              emitSemantic({ type: 'tool_use', tool: 'patch_apply', callId: getItemId(params), input: {} });
            }
            return;
          }

          if (method === 'item/completed') {
            const kind = getItemKind(params);
            if (kind === 'commandExecution') {
              emitSemantic({ type: 'tool_result', tool: 'exec_command', callId: getItemId(params), output: getCompletedOutput(params) });
            } else if (kind === 'fileChange') {
              emitSemantic({ type: 'tool_result', tool: 'patch_apply', callId: getItemId(params), output: getCompletedOutput(params) });
            }
            return;
          }

          if (method === 'turn/completed') {
            const turn = isRecord(params) && isRecord(params.turn) ? params.turn : {};
            const status = getString(turn.status) ?? 'completed';
            if (status === 'failed') {
              finalStatus = 'failed';
              finalError = String(turn.error ?? 'codex turn failed');
            } else if (['cancelled', 'aborted', 'interrupted'].includes(status)) {
              finalStatus = 'cancelled';
              finalError = `codex turn ${status}`;
            }
            usage = extractUsage(turn.usage);
            resolveOnce();
            return;
          }

          if (method === 'thread/status/changed') {
            const status = isRecord(params) ? getString(params.status) : undefined;
            if (turnStarted && status === 'idle') resolveOnce();
            return;
          }

          if (method === 'error') {
            finalStatus = 'failed';
            finalError = isRecord(params) ? String(params.message ?? 'codex error') : 'codex error';
            emitter.emit({ type: 'error', message: finalError });
            resolveOnce();
          }
        };

        const handleLegacyNotification = (message: JsonRpcMessage) => {
          const params = isRecord(message.params) ? message.params : {};
          const msg = isRecord(params.msg) ? params.msg : {};
          const type = getString(msg.type) ?? '';
          if (type === 'task_started') {
            turnStarted = true;
            emitter.emit({ type: 'status', status: 'running', sessionId: threadId });
            resetSemanticTimer();
          } else if (type === 'agent_message') {
            const content = String(msg.message ?? msg.content ?? '');
            if (content) emitSemantic({ type: 'text', content });
          } else if (type === 'exec_command_begin') {
            emitSemantic({ type: 'tool_use', tool: 'exec_command', callId: String(msg.call_id ?? msg.callId ?? 'exec'), input: { command: msg.command } });
          } else if (type === 'exec_command_end') {
            emitSemantic({ type: 'tool_result', tool: 'exec_command', callId: String(msg.call_id ?? msg.callId ?? 'exec'), output: String(msg.output ?? '') });
          } else if (type === 'task_complete') {
            usage = extractUsage(msg.usage);
            resolveOnce();
          } else if (type === 'turn_aborted') {
            finalStatus = 'cancelled';
            finalError = 'codex turn aborted';
            resolveOnce();
          } else if (type === 'token_count') {
            usage = extractUsage(msg);
          }
        };

        child.stdout.setEncoding('utf8');
        const rl = readline.createInterface({ input: child.stdout });
        rl.on('line', (line) => {
          if (!line.trim()) return;
          let message: JsonRpcMessage;
          try {
            message = JSON.parse(line) as JsonRpcMessage;
          } catch {
            emitter.emit({ type: 'log', level: 'debug', message: line });
            return;
          }

          if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
            const pendingRequest = pending.get(message.id);
            if (!pendingRequest) return;
            pending.delete(message.id);
            if (message.error) {
              pendingRequest.reject(new Error(stringifyError(message.error)));
            } else {
              pendingRequest.resolve(message.result);
            }
            return;
          }

          if (message.id !== undefined && message.method) {
            const result = message.method.includes('requestApproval') ? { decision: 'accept' } : {};
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
            return;
          }

          if (message.method === 'codex/event') {
            handleLegacyNotification(message);
          } else if (message.method) {
            handleRawNotification(message);
          }
        });
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        if (stderr.length > 4096) stderr = stderr.slice(-4096);
      });

      const requestRpc = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
        const id = nextId;
        nextId += 1;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        });
      };

      const notifyRpc = (method: string, params: Record<string, unknown> = {}) => {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
      };

      const timeoutMs = request.timeout ?? DEFAULT_TIMEOUT_MS;
      let timeoutHandle: NodeJS.Timeout | undefined;
      const timeout = new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          if (settled) return;
          finalStatus = 'timeout';
          finalError = `codex timed out after ${timeoutMs}ms`;
          try {
            child.kill('SIGTERM');
          } catch {
            // Best effort.
          }
          settled = true;
          resolve();
        }, timeoutMs);
      });

      const abort = new Promise<void>((resolve) => {
        if (signal.aborted) {
          finalStatus = 'cancelled';
          settled = true;
          resolve();
          return;
        }
        signal.addEventListener('abort', () => {
          finalStatus = 'cancelled';
          finalError = 'codex execution cancelled';
          try {
            child.kill('SIGTERM');
          } catch {
            // Best effort.
          }
          settled = true;
          resolve();
        }, { once: true });
      });

      const awaitRpc = async (promise: Promise<unknown>, phase: string): Promise<unknown> => {
        const completion = await Promise.race([
          promise.then((value) => ({ type: 'value' as const, value })),
          timeout.then(() => ({ type: 'terminal' as const })),
          abort.then(() => ({ type: 'terminal' as const })),
          childExit.then(() => ({ type: 'exit' as const })),
        ]);
        if (completion.type === 'value') return completion.value;
        if (completion.type === 'exit' && !settled) {
          finalStatus = 'failed';
          finalError = `codex process exited before ${phase}`;
        }
        throw new Error(finalError ?? `codex ${phase} did not complete`);
      };

      try {
        await awaitRpc(requestRpc('initialize', {
          capabilities: { experimentalApi: true },
          clientInfo: { name: 'metabot-daemon', title: 'MetaBot Daemon', version: '0.2.5' },
        }), 'initialize response');
        if (finalStatus !== 'completed') throw new Error(finalError ?? 'codex initialization did not complete');
        notifyRpc('initialized');

        if (request.resumeSessionId) {
          try {
            const resumed = await awaitRpc(requestRpc('thread/resume', {
              threadId: request.resumeSessionId,
              cwd: request.cwd,
              model: request.model ?? null,
              developerInstructions: request.systemPrompt,
            }), 'thread resume response');
            threadId = extractThreadId(resumed) ?? request.resumeSessionId;
          } catch {
            const started = await awaitRpc(requestRpc('thread/start', {
              cwd: request.cwd,
              developerInstructions: request.systemPrompt,
              persistExtendedHistory: true,
            }), 'thread start response');
            threadId = extractThreadId(started);
          }
        } else {
          const started = await awaitRpc(requestRpc('thread/start', {
            cwd: request.cwd,
            approvalPolicy: null,
            sandbox: null,
            developerInstructions: request.systemPrompt,
            persistExtendedHistory: true,
          }), 'thread start response');
          threadId = extractThreadId(started);
        }

        if (!threadId) throw new Error('codex did not return a thread id');

        await awaitRpc(requestRpc('turn/start', {
          threadId,
          input: [{ type: 'text', text: request.prompt }],
          cwd: request.cwd,
        }), 'turn start response');
        const completion = await Promise.race([
          turnDone.then(() => 'turn' as const),
          timeout.then(() => 'timeout' as const),
          abort.then(() => 'abort' as const),
          childExit.then(() => 'exit' as const),
        ]);
        if (completion === 'exit' && !settled) {
          finalStatus = 'failed';
          finalError = 'codex process exited before turn completion';
        }
      } catch (error) {
        if (finalStatus === 'completed') {
          finalStatus = 'failed';
          finalError = stringifyError(error);
        }
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        clearSemanticTimer();
        for (const pendingRequest of pending.values()) {
          pendingRequest.reject(new Error('codex process closed'));
        }
        pending.clear();
        try {
          child.stdin.end();
        } catch {
          // Best effort.
        }
        await childExit;
      }

      if (stderr.trim() && finalStatus !== 'completed') {
        finalError = `${finalError ?? 'codex failed'}\n${stderr.trim()}`;
      }

      return {
        status: finalStatus,
        output: outputParts.join(''),
        error: finalError,
        providerSessionId: threadId,
        durationMs: Date.now() - startedAt,
        usage: usage ? { [CODEX_USAGE_KEY]: usage } : undefined,
      };
    },
  };
}

export const codexBackendFactory: LlmBackendFactory = createCodexBackend;
