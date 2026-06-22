import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter, LlmTokenUsage } from '../types';
import { buildProcessEnv, filterBlockedArgs, shutdownChildProcess, stringifyError, type LlmBackend, type LlmBackendFactory } from './backend';
import { extractUsage, getString, hasArg, isRecord, resolveJsonProcessError, runJsonLineProcess, stringifyContent, usageRecordHasTokens } from './jsonProcess';

const DEFAULT_ZCODE_PROTOCOL_TIMEOUT_MS = 1_200_000;
const ZCODE_API_KEY_ENV_NAMES = ['ZCODE_API_KEY', 'Z_AI_API_KEY', 'ZAI_API_KEY', 'BIGMODEL_API_KEY'];

interface ZCodeProtocolMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingProtocolRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function buildZCodePrompt(request: LlmExecutionRequest): string {
  return request.systemPrompt
    ? `${request.systemPrompt}\n\n${request.prompt}`
    : request.prompt;
}

function buildZCodeArgs(request: LlmExecutionRequest): string[] {
  const args = ['--prompt', buildZCodePrompt(request), '--json', '--no-browser'];
  if (request.cwd) args.push('--cwd', request.cwd);
  if (!hasArg(request.extraArgs, '--mode')) args.push('--mode', 'yolo');
  if (request.resumeSessionId) args.push('--resume', request.resumeSessionId);
  args.push(...filterBlockedArgs(request.extraArgs, {
    '--prompt': { takesValue: true },
    '-p': { takesValue: true },
    '--json': { takesValue: false },
    '--no-browser': { takesValue: false },
    '--cwd': { takesValue: true },
    '--resume': { takesValue: true },
  }));
  return args;
}

function emitText(text: string, emitter: LlmEventEmitter): string {
  if (!text) return '';
  emitter.emit({ type: 'text', content: text });
  return text;
}

function emitAssistantBlock(block: Record<string, unknown>, emitter: LlmEventEmitter): string {
  const blockType = getString(block.type) ?? '';
  if (blockType === 'output_text' || blockType === 'text') {
    return emitText(String(block.text ?? block.content ?? ''), emitter);
  }
  if (blockType === 'thinking' || blockType === 'thought') {
    const thinking = String(block.thinking ?? block.text ?? block.content ?? '');
    if (thinking) emitter.emit({ type: 'thinking', content: thinking });
    return '';
  }
  if (blockType === 'tool_use' || blockType === 'tool_call') {
    emitter.emit({
      type: 'tool_use',
      tool: String(block.name ?? block.tool_name ?? block.tool ?? 'tool'),
      callId: String(block.id ?? block.tool_id ?? block.callId ?? 'tool'),
      input: isRecord(block.input) ? block.input : {},
    });
  }
  return '';
}

function emitAssistantContent(value: unknown, emitter: LlmEventEmitter): string {
  if (typeof value === 'string') {
    return emitText(value, emitter);
  }
  if (!Array.isArray(value)) return '';
  let output = '';
  for (const block of value) {
    if (isRecord(block)) {
      output += emitAssistantBlock(block, emitter);
    } else if (typeof block === 'string') {
      output += emitText(block, emitter);
    }
  }
  return output;
}

function addUsageToRecord(usageByModel: Record<string, LlmTokenUsage>, model: string, value: LlmTokenUsage | undefined): boolean {
  if (!value || !usageRecordHasTokens(value)) return false;
  const current = usageByModel[model] ?? { inputTokens: 0, outputTokens: 0 };
  current.inputTokens += value.inputTokens;
  current.outputTokens += value.outputTokens;
  if (value.cacheReadTokens) current.cacheReadTokens = (current.cacheReadTokens ?? 0) + value.cacheReadTokens;
  if (value.cacheWriteTokens) current.cacheWriteTokens = (current.cacheWriteTokens ?? 0) + value.cacheWriteTokens;
  usageByModel[model] = current;
  return true;
}

function isMissingModelConfigError(error: string | undefined): boolean {
  return Boolean(error && /Model config is missing/i.test(error) && /zcode\/cli\/config\.json|explicit model provider/i.test(error));
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function getHomeDir(env: NodeJS.ProcessEnv): string {
  return getString(env.HOME) ?? getString(env.USERPROFILE) ?? os.homedir();
}

function getProviderOptions(provider: Record<string, unknown>): Record<string, unknown> {
  return readRecord(provider.options);
}

function getProviderApiFormat(kind: string): string | undefined {
  switch (kind) {
    case 'anthropic':
      return 'anthropic-messages';
    case 'openai':
      return 'openai-chat-completions';
    case 'gemini':
      return 'gemini-generate-content';
    default:
      return undefined;
  }
}

function resolveInlineApiKey(
  provider: Record<string, unknown>,
  options: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> | undefined {
  const direct = getString(options.apiKey) ?? getString(provider.apiKey);
  if (direct) return { source: 'inline', value: direct };

  const configuredEnvName = getString(options.apiKeyEnv) ?? getString(provider.apiKeyEnv);
  const envName = configuredEnvName ?? ZCODE_API_KEY_ENV_NAMES.find((key) => Boolean(env[key]));
  const envValue = envName ? getString(env[envName]) : undefined;
  return envValue ? { source: 'inline', value: envValue } : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function getRecordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function buildZCodeProtocolModelEntry(modelId: string, value: unknown): Record<string, unknown> {
  const model = readRecord(value);
  const limit = readRecord(model.limit);
  const modalities = readRecord(model.modalities);
  const inputModalities = Array.isArray(modalities.input) ? modalities.input : [];
  const supportsImages = inputModalities.includes('image');
  return compactRecord({
    modelId,
    label: getString(model.name) ?? getString(model.label) ?? modelId,
    description: getString(model.description),
    contextWindow: getNumber(model.contextWindow) ?? getNumber(limit.context),
    maxOutputTokens: getNumber(model.maxOutputTokens) ?? getNumber(limit.output),
    supportsImages: supportsImages || undefined,
    supportsTools: true,
    supportsStructuredOutput: true,
    providerOptions: getRecordOrUndefined(model.providerOptions),
    disabledReason: getString(model.disabledReason),
  });
}

function chooseZCodeProvider(entries: Array<[string, Record<string, unknown>]>): [string, Record<string, unknown>] | undefined {
  const enabled = entries.filter(([, provider]) => provider.enabled !== false);
  const candidates = enabled.length ? enabled : entries;
  const preferredIds = ['builtin:zai-coding-plan', 'builtin:zai', 'zai', 'builtin:bigmodel'];
  for (const id of preferredIds) {
    const match = candidates.find(([providerId]) => providerId === id);
    if (match) return match;
  }
  return candidates[0];
}

async function loadZCodeV2RuntimeModel(
  request: LlmExecutionRequest,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown> | undefined> {
  const configPath = path.join(getHomeDir(env), '.zcode', 'v2', 'config.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    return undefined;
  }

  const config = readRecord(parsed);
  const providerMap = readRecord(config.provider);
  const providerEntries = Object.entries(providerMap)
    .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]));
  const selected = chooseZCodeProvider(providerEntries);
  if (!selected) return undefined;

  const [providerId, provider] = selected;
  const options = getProviderOptions(provider);
  const models = readRecord(provider.models);
  const modelEntries = Object.entries(models)
    .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]));
  const requestedModel = request.model && models[request.model] ? request.model : undefined;
  const modelId = requestedModel ?? modelEntries[0]?.[0] ?? request.model;
  if (!modelId) return undefined;

  const modelList = modelEntries.length
    ? modelEntries.map(([entryModelId, model]) => buildZCodeProtocolModelEntry(entryModelId, model))
    : [buildZCodeProtocolModelEntry(modelId, {})];
  const kind = getString(provider.kind) ?? getString(options.kind) ?? 'anthropic';
  const apiKey = resolveInlineApiKey(provider, options, env);
  const apiKeyRequired = getBoolean(options.apiKeyRequired) ?? getBoolean(provider.apiKeyRequired);

  return compactRecord({
    revision: `oac-zcode-v2:${providerId}:${modelId}`,
    generatedAt: Date.now(),
    model: compactRecord({
      providerId,
      modelId,
      variant: getString(readRecord(models[modelId]).variant),
    }),
    provider: compactRecord({
      providerId,
      kind,
      apiFormat: getString(provider.apiFormat) ?? getString(options.apiFormat) ?? getProviderApiFormat(kind),
      label: getString(provider.name) ?? getString(provider.label) ?? providerId,
      source: getString(provider.source) ?? 'zcode-v2-config',
      baseURL: getString(options.baseURL) ?? getString(options.baseUrl) ?? getString(provider.baseURL),
      apiKey,
      apiKeyRequired,
      headers: getRecordOrUndefined(options.headers) ?? getRecordOrUndefined(provider.headers),
      providerOptions: getRecordOrUndefined(options.providerOptions) ?? getRecordOrUndefined(provider.providerOptions),
      modelsDevProviderId: getString(provider.modelsDevProviderId),
      models: modelList,
    }),
    thoughtLevel: getString(config.thoughtLevel),
  });
}

function extractProtocolSessionId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const session = readRecord(value.session);
  return getString(session.sessionId) ?? getString(value.sessionId);
}

function extractProtocolEventSeq(value: unknown): number {
  if (!isRecord(value)) return 0;
  const runtime = readRecord(value.runtime);
  return getNumber(runtime.eventSeq) ?? getNumber(value.eventSeq) ?? 0;
}

function getProtocolEvents(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) return [];
  const events = value.events;
  return Array.isArray(events) ? events.filter(isRecord) : [];
}

function getProtocolErrorMessage(error: unknown, fallback: string): string {
  if (!isRecord(error)) return stringifyContent(error) || fallback;
  const data = readRecord(error.data);
  return String(data.message ?? error.message ?? error.name ?? fallback);
}

function buildPermissionResponse(params: unknown): Record<string, unknown> {
  const options = isRecord(params) && Array.isArray(params.options) ? params.options : [];
  for (const option of options) {
    if (!isRecord(option)) continue;
    const response = readRecord(option.response);
    if (response.decision === 'allow' || response.decision === 'accept') return response;
  }
  return { decision: 'allow', reason: 'OAC ZCode bridge' };
}

function writeProtocolResponse(childStdin: NodeJS.WritableStream, id: number | string, result: Record<string, unknown>): void {
  childStdin.write(`${JSON.stringify({ id, result })}\n`);
}

async function runZCodeProtocolFallback(
  binaryPath: string,
  env: Record<string, string> | undefined,
  request: LlmExecutionRequest,
  emitter: LlmEventEmitter,
  signal: AbortSignal,
): Promise<LlmExecutionResult | undefined> {
  const processEnv = buildProcessEnv(env, request.env);
  const runtimeModel = await loadZCodeV2RuntimeModel(request, processEnv);
  if (!runtimeModel) return undefined;

  const startedAt = Date.now();
  const child = spawn(binaryPath, ['app-server'], {
    cwd: request.cwd,
    env: processEnv,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let nextId = 1;
  const pending = new Map<number | string, PendingProtocolRequest>();
  const usageByModel: Record<string, LlmTokenUsage> = {};
  const outputParts: string[] = [];
  let stderr = '';
  let finalStatus: LlmExecutionResult['status'] = 'completed';
  let finalError: string | undefined;
  let sessionId: string | undefined = request.resumeSessionId;

  const childExit = new Promise<number | null>((resolve) => {
    child.on('close', (code) => {
      const suffix = stderr.trim() ? `\n${stderr.trim().slice(-4096)}` : '';
      for (const requestEntry of pending.values()) {
        requestEntry.reject(new Error(`zcode protocol exited while waiting for ${requestEntry.method}${suffix}`));
      }
      pending.clear();
      resolve(code);
    });
  });
  const childError = new Promise<Error>((resolve) => {
    child.once('error', (error) => resolve(error));
  });

  const writeJson = (message: ZCodeProtocolMessage) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const requestProtocol = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { method, resolve, reject });
      try {
        writeJson({ id, method, params });
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(stringifyError(error)));
      }
    });
  };

  const emitTextDelta = (text: string) => {
    if (!text) return;
    outputParts.push(text);
    emitter.emit({ type: 'text', content: text });
  };

  const emitFinalText = (text: string) => {
    if (!text) return;
    const current = outputParts.join('');
    if (!current) {
      emitTextDelta(text);
      return;
    }
    if (text.startsWith(current)) {
      emitTextDelta(text.slice(current.length));
      return;
    }
    outputParts.splice(0, outputParts.length, text);
  };

  const handleAgentRequest = (message: ZCodeProtocolMessage) => {
    if (message.id === undefined || !message.method) return;
    if (message.method === 'interaction/requestPermission') {
      writeProtocolResponse(child.stdin, message.id, buildPermissionResponse(message.params));
      return;
    }
    if (message.method === 'interaction/requestUserInput') {
      writeProtocolResponse(child.stdin, message.id, { action: 'decline', reason: 'OAC ZCode bridge' });
      return;
    }
    if (message.method === 'interaction/requestProviderRuntimeHeaders') {
      writeProtocolResponse(child.stdin, message.id, { headersApplied: false });
      return;
    }
    writeProtocolResponse(child.stdin, message.id, {});
  };

  child.stdout.setEncoding('utf8');
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let message: ZCodeProtocolMessage;
    try {
      message = JSON.parse(line) as ZCodeProtocolMessage;
    } catch {
      emitter.emit({ type: 'log', level: 'debug', message: line });
      return;
    }

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pendingRequest = pending.get(message.id);
      if (!pendingRequest) return;
      pending.delete(message.id);
      if (message.error) {
        pendingRequest.reject(new Error(getProtocolErrorMessage(message.error, `${pendingRequest.method} failed`)));
      } else {
        pendingRequest.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      handleAgentRequest(message);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
    if (stderr.length > 8192) stderr = stderr.slice(-8192);
  });

  const timeoutMs = request.timeout ?? DEFAULT_ZCODE_PROTOCOL_TIMEOUT_MS;
  let timeoutHandle: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      finalStatus = 'timeout';
      finalError = `zcode protocol timed out after ${timeoutMs}ms`;
      try {
        child.kill('SIGTERM');
      } catch {
        // Best effort.
      }
      reject(new Error(finalError));
    }, timeoutMs);
  });
  const abort = new Promise<never>((_, reject) => {
    abortHandler = () => {
      finalStatus = 'cancelled';
      finalError = 'zcode protocol execution cancelled';
      try {
        child.kill('SIGTERM');
      } catch {
        // Best effort.
      }
      reject(new Error(finalError));
    };
    if (signal.aborted) {
      abortHandler();
      return;
    }
    signal.addEventListener('abort', abortHandler, { once: true });
  });

  const closeSession = async () => {
    if (!sessionId) return;
    try {
      await requestProtocol('session/close', { sessionId });
    } catch {
      // Best effort.
    }
  };

  const runTurn = async () => {
    const workspacePath = request.cwd ?? process.cwd();
    const createResult = await requestProtocol('session/create', {
      workspace: {
        workspacePath,
        workspaceKey: workspacePath,
      },
      mode: 'yolo',
      persistence: 'deferred',
      runtimeModel,
    });
    sessionId = extractProtocolSessionId(createResult) ?? sessionId;
    let afterSeq = extractProtocolEventSeq(createResult);
    emitter.emit({ type: 'status', status: 'running', sessionId });

    await requestProtocol('session/send', {
      sessionId,
      content: buildZCodePrompt(request),
      runtimeModel,
    });

    const model = readRecord(runtimeModel.model);
    const modelId = getString(model.modelId) ?? 'zcode';
    while (finalStatus === 'completed') {
      const eventsResult = await requestProtocol('session/events', { sessionId, afterSeq });
      const events = getProtocolEvents(eventsResult);
      if (events.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      for (const event of events) {
        afterSeq = Math.max(afterSeq, getNumber(event.seq) ?? afterSeq);
        const type = getString(event.type) ?? '';
        const payload = readRecord(event.payload);
        if (type === 'model.streaming' || type === 'turn.text_delta') {
          emitTextDelta(String(payload.delta ?? payload.text ?? payload.content ?? ''));
          continue;
        }
        if (type === 'turn.completed') {
          emitFinalText(String(payload.response ?? payload.output ?? payload.text ?? ''));
          addUsageToRecord(usageByModel, modelId, extractUsage(payload.usage ?? payload.tokenUsage ?? payload.stats));
          return;
        }
        if (type === 'turn.failed' || type === 'turn.error') {
          finalStatus = 'failed';
          finalError = String(payload.message ?? payload.error ?? 'zcode protocol turn failed');
          emitter.emit({ type: 'error', message: finalError });
          return;
        }
      }
    }
  };

  try {
    await Promise.race([
      runTurn(),
      timeout,
      abort,
      childError.then((error) => {
        throw error;
      }),
    ]);
  } catch (error) {
    if (finalStatus === 'completed') finalStatus = 'failed';
    finalError = finalError ?? stringifyError(error);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (abortHandler) signal.removeEventListener('abort', abortHandler);
    await closeSession();
    await shutdownChildProcess(child, childExit, {
      terminate: finalStatus !== 'completed',
      graceMs: finalStatus === 'completed' ? 2_000 : 250,
    });
  }

  if (stderr.trim() && finalStatus !== 'completed') {
    finalError = `${finalError ?? 'zcode protocol failed'}\n${stderr.trim().slice(-4096)}`;
  }

  return {
    status: finalStatus,
    output: outputParts.join(''),
    error: finalError,
    providerSessionId: sessionId,
    durationMs: Date.now() - startedAt,
    usage: Object.keys(usageByModel).length ? usageByModel : undefined,
  };
}

export function createZCodeBackend(binaryPath: string, env?: Record<string, string>): LlmBackend {
  return {
    provider: 'zcode',
    async execute(request: LlmExecutionRequest, emitter: LlmEventEmitter, signal: AbortSignal): Promise<LlmExecutionResult> {
      const args = buildZCodeArgs(request);
      let output = '';
      let resultOutput: string | undefined;
      let sessionId: string | undefined = request.resumeSessionId;
      let protocolStatus: LlmExecutionResult['status'] = 'completed';
      let protocolError: string | undefined;
      const resultUsage: Record<string, LlmTokenUsage> = {};

      const processResult = await runJsonLineProcess({
        label: 'zcode',
        binaryPath,
        args,
        cwd: request.cwd,
        env,
        requestEnv: request.env,
        timeoutMs: request.timeout,
        signal,
        emitter,
        jsonStreams: ['stdout'],
        normalizeStreamPrefixes: true,
        onJson(message) {
          const type = getString(message.type) ?? getString(message.event) ?? '';
          const subtype = getString(message.subtype) ?? '';
          if (type === 'system/init' || type === 'init' || (type === 'system' && subtype === 'init')) {
            sessionId = getString(message.session_id) ?? getString(message.sessionId) ?? getString(message.id) ?? sessionId;
            emitter.emit({ type: 'status', status: 'running', sessionId });
            return;
          }
          if (type === 'system/error' || (type === 'system' && subtype === 'error') || type === 'error') {
            protocolStatus = 'failed';
            protocolError = String(message.message ?? message.error ?? message.detail ?? 'zcode error');
            emitter.emit({ type: 'error', message: protocolError });
            return;
          }
          if (type === 'assistant.message' || type === 'assistant' || (type === 'message' && message.role === 'assistant')) {
            const assistantMessage = isRecord(message.message) ? message.message : {};
            output += emitAssistantContent(
              message.content ?? assistantMessage.content ?? message.text ?? assistantMessage.text,
              emitter,
            );
            return;
          }
          if (type === 'text' || type === 'output_text' || type === 'delta') {
            output += emitText(String(message.text ?? message.content ?? message.delta ?? ''), emitter);
            return;
          }
          if (type === 'thinking' || type === 'thought') {
            const thinking = String(message.thinking ?? message.text ?? message.content ?? '');
            if (thinking) emitter.emit({ type: 'thinking', content: thinking });
            return;
          }
          if (type === 'tool_use' || type === 'tool_call') {
            const rawParameters = message.parameters ?? message.input ?? message.arguments;
            emitter.emit({
              type: 'tool_use',
              tool: String(message.tool_name ?? message.name ?? message.tool ?? 'tool'),
              callId: String(message.tool_id ?? message.id ?? message.callId ?? 'tool'),
              input: isRecord(rawParameters) ? rawParameters : {},
            });
            return;
          }
          if (type === 'tool_result') {
            emitter.emit({
              type: 'tool_result',
              tool: String(message.tool_name ?? message.name ?? message.tool ?? 'tool'),
              callId: String(message.tool_id ?? message.tool_use_id ?? message.id ?? message.callId ?? 'tool'),
              output: stringifyContent(message.output ?? message.result ?? message.content),
            });
            return;
          }
          if (type === 'result' || type === 'finish' || type === 'completed' || (type === 'system' && subtype === 'result')) {
            sessionId = getString(message.session_id) ?? getString(message.sessionId) ?? sessionId;
            const candidateOutput = typeof message.result === 'string'
              ? message.result
              : stringifyContent(message.output ?? message.text ?? message.content);
            if (!output) resultOutput = candidateOutput;
            const model = getString(message.model) ?? 'zcode';
            addUsageToRecord(resultUsage, model, extractUsage(message.usage ?? message.stats ?? message.token_usage));
            if (message.is_error === true || message.status === 'error' || message.status === 'failed' || message.subtype === 'error') {
              protocolStatus = 'failed';
              protocolError = candidateOutput || String(message.error ?? message.detail ?? 'zcode result failed');
            }
          }
        },
      });

      if (processResult.status === 'failed' && isMissingModelConfigError(processResult.error)) {
        const fallbackResult = await runZCodeProtocolFallback(binaryPath, env, request, emitter, signal);
        if (fallbackResult) {
          return {
            ...fallbackResult,
            durationMs: processResult.durationMs + fallbackResult.durationMs,
          };
        }
      }

      const status = processResult.status === 'completed' ? protocolStatus : processResult.status;
      return {
        status,
        output: resultOutput || output,
        error: resolveJsonProcessError(processResult, protocolStatus, protocolError),
        providerSessionId: sessionId,
        durationMs: processResult.durationMs,
        usage: Object.keys(resultUsage).length ? resultUsage : undefined,
      };
    },
  };
}

export const zcodeBackendFactory: LlmBackendFactory = createZCodeBackend;
