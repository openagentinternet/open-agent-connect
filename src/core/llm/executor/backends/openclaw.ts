import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter, LlmTokenUsage } from '../types';
import { filterBlockedArgs, type LlmBackend, type LlmBackendFactory } from './backend';
import {
  addUsage,
  getString,
  hasArg,
  isRecord,
  resolveJsonProcessError,
  runJsonLineProcess,
  stringifyContent,
  usageRecordHasTokens,
} from './jsonProcess';

function createSessionId(): string {
  return `oac-openclaw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildOpenClawArgs(request: LlmExecutionRequest, sessionId: string): string[] {
  const args = ['agent', '--local', '--json', '--session-id', sessionId];
  const extraArgs = filterBlockedArgs(request.extraArgs, {
    '--message': { takesValue: true },
    '--session-id': { takesValue: true },
    '--json': { takesValue: false },
    '--local': { takesValue: false },
    '--model': { takesValue: true },
    '--system-prompt': { takesValue: true },
  });
  if (request.model && !hasArg(extraArgs, '--agent')) {
    args.push('--agent', request.model);
  }
  args.push(...extraArgs);
  args.push('--message', request.systemPrompt ? `${request.systemPrompt}\n\n${request.prompt}` : request.prompt);
  return args;
}

function getToolName(message: Record<string, unknown>): string {
  return String(message.name ?? message.tool ?? message.tool_name ?? 'tool');
}

function getCallId(message: Record<string, unknown>): string {
  return String(message.id ?? message.callId ?? message.call_id ?? message.tool_use_id ?? 'tool');
}

function getErrorMessage(message: Record<string, unknown>, fallback: string): string {
  const error = isRecord(message.error) ? message.error : {};
  const errorData = isRecord(error.data) ? error.data : {};
  const data = isRecord(message.data) ? message.data : {};
  return String(errorData.message ?? error.message ?? error.name ?? data.message ?? message.message ?? message.error ?? message.name ?? fallback);
}

function applyLegacyOpenClawResult(
  message: Record<string, unknown>,
  emitter: LlmEventEmitter,
  state: {
    output: string;
    resultOutput?: string;
    providerSessionId?: string;
    usage: LlmTokenUsage;
    usageKey: string;
  },
): string {
  let appendedOutput = state.output;
  if (Array.isArray(message.payloads)) {
    for (const payload of message.payloads) {
      if (!isRecord(payload)) continue;
      const text = String(payload.text ?? '');
      if (text) {
        appendedOutput += text;
        emitter.emit({ type: 'text', content: text });
      }
    }
  }
  const meta = isRecord(message.meta) ? message.meta : {};
  const agentMeta = isRecord(meta.agentMeta) ? meta.agentMeta : {};
  state.providerSessionId = getString(agentMeta.sessionId) ?? state.providerSessionId;
  state.usageKey = getString(agentMeta.model) ?? state.usageKey;
  addUsage(state.usage, agentMeta.usage);
  state.output = appendedOutput;
  state.resultOutput = appendedOutput;
  return appendedOutput;
}

function parsePrettyJsonLines(lines: string[]): Record<string, unknown> | undefined {
  const trimmed = lines.map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < trimmed.length; index += 1) {
    const candidate = trimmed.slice(index).join('\n');
    if (!candidate.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(candidate);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      // Keep looking for a later JSON object start.
    }
  }
  return undefined;
}

export function createOpenClawBackend(binaryPath: string, env?: Record<string, string>): LlmBackend {
  return {
    provider: 'openclaw',
    async execute(request: LlmExecutionRequest, emitter: LlmEventEmitter, signal: AbortSignal): Promise<LlmExecutionResult> {
      const sessionId = request.resumeSessionId || createSessionId();
      const args = buildOpenClawArgs(request, sessionId);
      let output = '';
      let resultOutput: string | undefined;
      let providerSessionId: string | undefined = sessionId;
      let protocolStatus: LlmExecutionResult['status'] = 'completed';
      let protocolError: string | undefined;
      const usage: LlmTokenUsage = { inputTokens: 0, outputTokens: 0 };
      let usageKey = request.model || 'openclaw';
      const prettyJsonLines: string[] = [];

      const processResult = await runJsonLineProcess({
        label: 'openclaw',
        binaryPath,
        args,
        cwd: request.cwd,
        env,
        requestEnv: request.env,
        timeoutMs: request.timeout,
        signal,
        emitter,
        jsonStreams: ['stderr'],
        onNonJsonLine(line, stream) {
          if (stream === 'stderr') prettyJsonLines.push(line);
        },
        onJson(message) {
          const type = getString(message.type) ?? getString(message.event) ?? '';
          if (!type && Array.isArray(message.payloads)) {
            const state = { output, resultOutput, providerSessionId, usage, usageKey };
            output = applyLegacyOpenClawResult(message, emitter, state);
            resultOutput = state.resultOutput;
            providerSessionId = state.providerSessionId;
            usageKey = state.usageKey;
            return;
          }
          providerSessionId = getString(message.session_id) ?? getString(message.sessionId) ?? providerSessionId;
          if (type === 'step_start' || type === 'lifecycle') {
            emitter.emit({ type: 'status', status: 'running', sessionId: providerSessionId });
            if (message.status === 'failed' || message.phase === 'error' || message.phase === 'failed' || message.phase === 'cancelled') {
              protocolStatus = 'failed';
              protocolError = getErrorMessage(message, 'openclaw lifecycle failed');
              emitter.emit({ type: 'error', message: protocolError });
            }
            return;
          }
          if (type === 'text' || type === 'message_text') {
            const text = String(message.text ?? message.content ?? message.message ?? '');
            if (text) {
              output += text;
              emitter.emit({ type: 'text', content: text });
            }
            return;
          }
          if (type === 'tool_use') {
            emitter.emit({
              type: 'tool_use',
              tool: getToolName(message),
              callId: getCallId(message),
              input: isRecord(message.input) ? message.input : {},
            });
            return;
          }
          if (type === 'tool_result') {
            emitter.emit({
              type: 'tool_result',
              tool: getToolName(message),
              callId: getCallId(message),
              output: stringifyContent(message.text ?? message.output ?? message.content ?? message.result),
            });
            return;
          }
          if (type === 'step_finish') {
            usageKey = getString(message.model) ?? usageKey;
            addUsage(usage, message.usage);
            return;
          }
          if (type === 'error') {
            protocolStatus = 'failed';
            protocolError = getErrorMessage(message, 'openclaw error');
            emitter.emit({ type: 'error', message: protocolError });
            return;
          }
          if (type === 'result') {
            providerSessionId = getString(message.session_id) ?? getString(message.sessionId) ?? providerSessionId;
            resultOutput = typeof message.result === 'string'
              ? message.result
              : stringifyContent(message.output ?? message.content);
            if (message.status === 'failed' || message.status === 'error') {
              protocolStatus = 'failed';
              protocolError = resultOutput || 'openclaw result failed';
            }
          }
        },
      });

      if (!resultOutput && prettyJsonLines.length > 0) {
        const prettyResult = parsePrettyJsonLines(prettyJsonLines);
        if (prettyResult && Array.isArray(prettyResult.payloads)) {
          const state = { output, resultOutput, providerSessionId, usage, usageKey };
          output = applyLegacyOpenClawResult(prettyResult, emitter, state);
          resultOutput = state.resultOutput;
          providerSessionId = state.providerSessionId;
          usageKey = state.usageKey;
        }
      }

      const status = processResult.status === 'completed' ? protocolStatus : processResult.status;
      const error = resolveJsonProcessError(processResult, protocolStatus, protocolError);
      return {
        status,
        output: resultOutput || output,
        error,
        providerSessionId,
        durationMs: processResult.durationMs,
        usage: usageRecordHasTokens(usage) ? { [usageKey]: usage } : undefined,
      };
    },
  };
}

export const openClawBackendFactory: LlmBackendFactory = createOpenClawBackend;
