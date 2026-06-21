import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter, LlmTokenUsage } from '../types';
import { filterBlockedArgs, type LlmBackend, type LlmBackendFactory } from './backend';
import { extractUsage, getString, hasArg, isRecord, resolveJsonProcessError, runJsonLineProcess, stringifyContent, usageRecordHasTokens } from './jsonProcess';

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
