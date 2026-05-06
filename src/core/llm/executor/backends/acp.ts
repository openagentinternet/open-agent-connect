import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter, LlmTokenUsage } from '../types';
import { buildProcessEnv, filterBlockedArgs, shutdownChildProcess, stringifyError, type BlockedArgSpec, type LlmBackend } from './backend';
import { extractUsage, getString, isRecord, stringifyContent, usageRecordHasTokens } from './jsonProcess';

const DEFAULT_ACP_TIMEOUT_MS = 1_200_000;
const ACP_USAGE_KEY_FALLBACK = 'unknown';

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingRpc {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface PendingToolCall {
  toolName: string;
  input?: Record<string, unknown>;
  argsText?: string;
  emitted: boolean;
}

export interface AcpBackendOptions {
  provider: string;
  binaryPath: string;
  env?: Record<string, string>;
  baseArgs: string[];
  blockedArgs: Record<string, BlockedArgSpec>;
  forcedEnv?: Record<string, string>;
  resumeMethod: 'session/resume' | 'session/load';
  includeModelInNewSession?: boolean;
  includeMcpServersInResume?: boolean;
  sendPromptContentAlias?: boolean;
  gateNotificationsUntilPrompt?: boolean;
  normalizeToolName?: (toolName: string) => string;
}

function combineArgs(options: AcpBackendOptions, request: LlmExecutionRequest): string[] {
  return [
    ...options.baseArgs,
    ...filterBlockedArgs(request.extraArgs, options.blockedArgs),
  ];
}

function getRpcErrorMessage(error: unknown, fallback: string): string {
  if (!isRecord(error)) return stringifyContent(error) || fallback;
  const data = isRecord(error.data) ? error.data : {};
  return String(data.message ?? error.message ?? error.name ?? fallback);
}

function extractSessionId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return getString(value.sessionId) ?? getString(value.session_id);
}

function buildUserText(request: LlmExecutionRequest): string {
  if (!request.systemPrompt) return request.prompt;
  return `${request.systemPrompt}\n\n---\n\n${request.prompt}`;
}

function updateUsage(target: LlmTokenUsage, value: LlmTokenUsage | undefined, mode: 'snapshot' | 'add'): void {
  if (!value) return;
  if (mode === 'snapshot') {
    if (value.inputTokens > target.inputTokens) target.inputTokens = value.inputTokens;
    if (value.outputTokens > target.outputTokens) target.outputTokens = value.outputTokens;
    if ((value.cacheReadTokens ?? 0) > (target.cacheReadTokens ?? 0)) target.cacheReadTokens = value.cacheReadTokens;
    if ((value.cacheWriteTokens ?? 0) > (target.cacheWriteTokens ?? 0)) target.cacheWriteTokens = value.cacheWriteTokens;
    return;
  }
  target.inputTokens += value.inputTokens;
  target.outputTokens += value.outputTokens;
  if (value.cacheReadTokens) target.cacheReadTokens = (target.cacheReadTokens ?? 0) + value.cacheReadTokens;
  if (value.cacheWriteTokens) target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + value.cacheWriteTokens;
}

function normalizeAcpUpdateType(value: string): string {
  const key = value.trim().toLowerCase().replaceAll('_', '').replaceAll('-', '');
  switch (key) {
    case 'agentmessagechunk':
      return 'agent_message_chunk';
    case 'agentthoughtchunk':
      return 'agent_thought_chunk';
    case 'toolcall':
      return 'tool_call';
    case 'toolcallupdate':
      return 'tool_call_update';
    case 'usageupdate':
      return 'usage_update';
    case 'turnend':
    case 'endturn':
      return 'turn_end';
    default:
      return '';
  }
}

function normalizeAcpUpdate(value: unknown): { type: string; data: unknown } {
  if (!isRecord(value)) return { type: '', data: value };
  const updateType = getString(value.sessionUpdate) ?? getString(value.type);
  if (updateType) return { type: normalizeAcpUpdateType(updateType), data: value };
  const entries = Object.entries(value);
  if (entries.length === 1) {
    const [key, data] = entries[0];
    return { type: normalizeAcpUpdateType(key), data };
  }
  return { type: '', data: value };
}

function textFromContent(value: unknown): string {
  if (!isRecord(value)) return '';
  const content = isRecord(value.content) ? value.content : {};
  return String(content.text ?? value.text ?? '');
}

function extractToolCallText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const pieces: string[] = [];
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    if (block.type === 'content') {
      const content = isRecord(block.content) ? block.content : {};
      const text = getString(content.text);
      if (text) pieces.push(text);
    } else if (block.type === 'diff') {
      const path = getString(block.path);
      if (path) pieces.push(`--- ${path}\n+++ ${path}`);
    }
  }
  return pieces.join('\n');
}

function parseToolArgs(argsText: string | undefined): Record<string, unknown> | undefined {
  const trimmed = argsText?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : { text: trimmed };
  } catch {
    return { text: trimmed };
  }
}

export function hermesToolNameFromTitle(title: string | undefined, kind: string | undefined): string {
  const safeTitle = title?.trim() ?? '';
  if (safeTitle === 'execute code') return 'execute_code';
  const colonIndex = safeTitle.indexOf(':');
  if (colonIndex > 0) {
    const name = safeTitle.slice(0, colonIndex).trim();
    if (name === 'terminal') return 'terminal';
    if (name === 'read') return 'read_file';
    if (name === 'write') return 'write_file';
    if (name.startsWith('patch')) return 'patch';
    if (name === 'search') return 'search_files';
    if (name === 'web search') return 'web_search';
    if (name === 'extract') return 'web_extract';
    if (name === 'delegate') return 'delegate_task';
    if (name === 'analyze image') return 'vision_analyze';
    return name;
  }
  switch (kind) {
    case 'read':
      return 'read_file';
    case 'edit':
      return 'write_file';
    case 'execute':
      return 'terminal';
    case 'search':
      return 'search_files';
    case 'fetch':
      return 'web_search';
    case 'think':
      return 'thinking';
    default:
      return safeTitle || kind || 'tool';
  }
}

function defaultProviderError(stderr: string): string | undefined {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const interesting = lines.filter((line) => (
    /HTTP\s+\d{3}/i.test(line)
    || /API call failed/i.test(line)
    || /BadRequestError|AuthenticationError|RateLimitError/i.test(line)
    || /^Error:/i.test(line)
  ));
  return interesting.join('\n') || undefined;
}

export function createAcpBackend(options: AcpBackendOptions): LlmBackend {
  return {
    provider: options.provider,
    async execute(request: LlmExecutionRequest, emitter: LlmEventEmitter, signal: AbortSignal): Promise<LlmExecutionResult> {
      const startedAt = Date.now();
      const args = combineArgs(options, request);
      const child = spawn(options.binaryPath, args, {
        cwd: request.cwd,
        env: buildProcessEnv(options.env, { ...(request.env ?? {}), ...(options.forcedEnv ?? {}) }),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let nextId = 1;
      const pending = new Map<number | string, PendingRpc>();
      const pendingTools = new Map<string, PendingToolCall>();
      const outputParts: string[] = [];
      const usage: LlmTokenUsage = { inputTokens: 0, outputTokens: 0 };
      let sessionId: string | undefined = request.resumeSessionId;
      let finalStatus: LlmExecutionResult['status'] = 'completed';
      let finalError: string | undefined;
      let stderr = '';
      let promptStarted = false;
      let sawTurnEndUsage = false;

      const childExit = new Promise<number | null>((resolve) => {
        child.on('close', (code) => resolve(code));
      });
      const childError = new Promise<Error>((resolve) => {
        child.once('error', (error) => resolve(error));
      });

      const writeJson = (message: JsonRpcMessage) => {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      };

      const requestRpc = (method: string, params: Record<string, unknown>): Promise<unknown> => {
        const id = nextId;
        nextId += 1;
        return new Promise((resolve, reject) => {
          pending.set(id, { method, resolve, reject });
          try {
            writeJson({ jsonrpc: '2.0', id, method, params });
          } catch (error) {
            pending.delete(id);
            reject(error instanceof Error ? error : new Error(stringifyError(error)));
          }
        });
      };

      const handleAgentRequest = (message: JsonRpcMessage) => {
        if (message.id === undefined) return;
        if (message.method === 'session/request_permission') {
          writeJson({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              outcome: {
                outcome: 'selected',
                optionId: 'approve_for_session',
              },
            },
          });
          return;
        }
        writeJson({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `method not found: ${message.method ?? 'unknown'}` },
        });
      };

      const emitToolUse = (callId: string, tool: string, input: Record<string, unknown> | undefined) => {
        emitter.emit({ type: 'tool_use', tool: options.normalizeToolName?.(tool) ?? tool, callId, input: input ?? {} });
      };

      const emitDeferredToolUse = (
        pendingTool: PendingToolCall | undefined,
        callId: string,
        title: string,
        kind: string,
        fallbackInput: Record<string, unknown> | undefined,
      ) => {
        if (pendingTool?.emitted) return;
        const toolName = pendingTool?.toolName ?? hermesToolNameFromTitle(title, kind);
        const input = pendingTool?.input ?? parseToolArgs(pendingTool?.argsText) ?? fallbackInput;
        emitToolUse(callId, toolName, input);
      };

      const handleToolCall = (data: unknown) => {
        if (!isRecord(data)) return;
        const callId = String(data.toolCallId ?? data.tool_call_id ?? data.id ?? 'tool');
        const title = getString(data.title) ?? getString(data.name) ?? '';
        const kind = getString(data.kind) ?? '';
        const toolName = hermesToolNameFromTitle(title, kind) || getString(data.name) || 'tool';
        const rawInput = isRecord(data.rawInput)
          ? data.rawInput
          : isRecord(data.input)
            ? data.input
            : isRecord(data.parameters)
              ? data.parameters
              : undefined;
        if (rawInput) {
          pendingTools.set(callId, { toolName, input: rawInput, emitted: true });
          emitToolUse(callId, toolName, rawInput);
          return;
        }
        pendingTools.set(callId, {
          toolName,
          argsText: extractToolCallText(data.content),
          emitted: false,
        });
      };

      const handleToolCallUpdate = (data: unknown) => {
        if (!isRecord(data)) return;
        const callId = String(data.toolCallId ?? data.tool_call_id ?? data.id ?? 'tool');
        const status = getString(data.status) ?? '';
        const pendingTool = pendingTools.get(callId);
        if (status !== 'completed' && status !== 'failed') {
          if (pendingTool && !pendingTool.emitted) {
            const text = extractToolCallText(data.content);
            if (text) pendingTool.argsText = text;
          }
          return;
        }
        pendingTools.delete(callId);
        const title = getString(data.title) ?? getString(data.name) ?? '';
        const kind = getString(data.kind) ?? '';
        const rawInput = isRecord(data.rawInput)
          ? data.rawInput
          : isRecord(data.input)
            ? data.input
            : isRecord(data.parameters)
              ? data.parameters
              : undefined;
        emitDeferredToolUse(pendingTool, callId, title, kind, rawInput);
        const output = stringifyContent(data.rawOutput ?? data.output ?? data.result) || extractToolCallText(data.content);
        emitter.emit({ type: 'tool_result', callId, output });
      };

      const handleNotification = (message: JsonRpcMessage) => {
        const method = message.method ?? '';
        if (method !== 'session/update' && method !== 'session/notification') return;
        if (!isRecord(message.params)) return;
        const update = normalizeAcpUpdate(message.params.update);
        if (!update.type) return;
        if (options.gateNotificationsUntilPrompt && !promptStarted) return;
        if (update.type === 'agent_message_chunk') {
          const text = textFromContent(update.data);
          if (text) {
            outputParts.push(text);
            emitter.emit({ type: 'text', content: text });
          }
          return;
        }
        if (update.type === 'agent_thought_chunk') {
          const text = textFromContent(update.data);
          if (text) emitter.emit({ type: 'thinking', content: text });
          return;
        }
        if (update.type === 'tool_call') {
          handleToolCall(update.data);
          return;
        }
        if (update.type === 'tool_call_update') {
          handleToolCallUpdate(update.data);
          return;
        }
        if (update.type === 'usage_update' && isRecord(update.data)) {
          updateUsage(usage, extractUsage(update.data.usage), 'snapshot');
          return;
        }
        if (update.type === 'turn_end' && isRecord(update.data)) {
          if (update.data.stopReason === 'cancelled') {
            finalStatus = 'cancelled';
            finalError = `${options.provider} cancelled the prompt`;
          }
          const turnEndUsage = extractUsage(update.data.usage);
          if (turnEndUsage) {
            sawTurnEndUsage = true;
            updateUsage(usage, turnEndUsage, 'add');
          }
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

        if (message.id !== undefined && message.method && message.result === undefined && message.error === undefined) {
          handleAgentRequest(message);
          return;
        }

        if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
          const pendingRequest = pending.get(message.id);
          if (!pendingRequest) return;
          pending.delete(message.id);
          if (message.error) {
            pendingRequest.reject(new Error(getRpcErrorMessage(message.error, `${pendingRequest.method} failed`)));
          } else {
            pendingRequest.resolve(message.result);
          }
          return;
        }

        if (message.method) handleNotification(message);
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        if (stderr.length > 8192) stderr = stderr.slice(-8192);
      });

      const timeoutMs = request.timeout ?? DEFAULT_ACP_TIMEOUT_MS;
      let timeoutHandle: NodeJS.Timeout | undefined;
      const timeout = new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          finalStatus = 'timeout';
          finalError = `${options.provider} timed out after ${timeoutMs}ms`;
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
          finalStatus = 'cancelled';
          finalError = `${options.provider} execution cancelled`;
          resolve();
          return;
        }
        signal.addEventListener('abort', () => {
          finalStatus = 'cancelled';
          finalError = `${options.provider} execution cancelled`;
          try {
            child.kill('SIGTERM');
          } catch {
            // Best effort.
          }
          resolve();
        }, { once: true });
      });

      const awaitStep = async (promise: Promise<unknown>, phase: string): Promise<unknown> => {
        const completion = await Promise.race([
          promise.then((value) => ({ type: 'value' as const, value })),
          timeout.then(() => ({ type: 'terminal' as const })),
          abort.then(() => ({ type: 'terminal' as const })),
          childError.then((error) => ({ type: 'error' as const, error })),
          childExit.then(() => ({ type: 'exit' as const })),
        ]);
        if (completion.type === 'value') return completion.value;
        if (completion.type === 'error') {
          finalStatus = 'failed';
          finalError = stringifyError(completion.error);
        } else if (completion.type === 'exit' && finalStatus === 'completed') {
          finalStatus = 'failed';
          finalError = `${options.provider} process exited before ${phase}`;
        }
        throw new Error(finalError ?? `${options.provider} ${phase} did not complete`);
      };

      try {
        await awaitStep(requestRpc('initialize', {
          protocolVersion: 1,
          clientInfo: {
            name: 'multica-agent-sdk',
            version: '0.2.0',
          },
          clientCapabilities: {},
        }), 'initialize');

        const cwd = request.cwd || '.';
        if (request.resumeSessionId) {
          const resumeParams: Record<string, unknown> = {
            cwd,
            sessionId: request.resumeSessionId,
          };
          if (options.includeMcpServersInResume) resumeParams.mcpServers = [];
          const resumed = await awaitStep(requestRpc(options.resumeMethod, resumeParams), options.resumeMethod);
          sessionId = extractSessionId(resumed) ?? request.resumeSessionId;
        } else {
          const newParams: Record<string, unknown> = {
            cwd,
            mcpServers: [],
          };
          if (options.includeModelInNewSession && request.model) newParams.model = request.model;
          const created = await awaitStep(requestRpc('session/new', newParams), 'session/new');
          sessionId = extractSessionId(created);
          if (!sessionId) throw new Error(`${options.provider} session/new returned no session ID`);
        }

        if (request.model) {
          try {
            await awaitStep(requestRpc('session/set_model', {
              sessionId,
              modelId: request.model,
            }), 'session/set_model');
          } catch (error) {
            finalStatus = 'failed';
            finalError = `${options.provider} could not switch to model "${request.model}": ${stringifyError(error)}`;
            throw error;
          }
        }

        const promptBlocks = [{ type: 'text', text: buildUserText(request) }];
        const promptParams: Record<string, unknown> = {
          sessionId,
          prompt: promptBlocks,
        };
        if (options.sendPromptContentAlias) promptParams.content = promptBlocks;
        promptStarted = true;
        const promptResult = await awaitStep(requestRpc('session/prompt', promptParams), 'session/prompt');
        if (isRecord(promptResult)) {
          if (promptResult.stopReason === 'cancelled') {
            finalStatus = 'cancelled';
            finalError = `${options.provider} cancelled the prompt`;
          }
          if (!sawTurnEndUsage) {
            updateUsage(usage, extractUsage(promptResult.usage), 'add');
          }
        }
      } catch (error) {
        if (finalStatus === 'completed') {
          finalStatus = 'failed';
          finalError = stringifyError(error);
        }
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        for (const pendingRequest of pending.values()) {
          pendingRequest.reject(new Error(`${options.provider} process closed`));
        }
        pending.clear();
        try {
          child.stdin.end();
        } catch {
          // Best effort.
        }
        await shutdownChildProcess(child, childExit, {
          terminate: finalStatus !== 'completed',
          graceMs: finalStatus === 'completed' ? 2_000 : 250,
        });
      }

      const output = outputParts.join('');
      if (finalStatus === 'completed' && !output) {
        const providerError = defaultProviderError(stderr);
        if (providerError) {
          finalStatus = 'failed';
          finalError = providerError;
        }
      }

      const usageKey = request.model || ACP_USAGE_KEY_FALLBACK;
      return {
        status: finalStatus,
        output,
        error: finalError,
        providerSessionId: sessionId,
        durationMs: Date.now() - startedAt,
        usage: usageRecordHasTokens(usage) ? { [usageKey]: usage } : undefined,
      };
    },
  };
}
