import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter, LlmTokenUsage } from '../types';
import { filterBlockedArgs, type LlmBackend, type LlmBackendFactory } from './backend';
import { addUsage, getString, isRecord, resolveJsonProcessError, runJsonLineProcess, stringifyContent, usageRecordHasTokens } from './jsonProcess';

function buildOpenCodeArgs(request: LlmExecutionRequest): string[] {
  const args = ['run', '--format', 'json'];
  if (request.model) args.push('--model', request.model);
  if (request.systemPrompt) args.push('--prompt', request.systemPrompt);
  if (request.resumeSessionId) args.push('--session', request.resumeSessionId);
  args.push(...filterBlockedArgs(request.extraArgs, {
    '--format': { takesValue: true },
    '--model': { takesValue: true },
    '--prompt': { takesValue: true },
    '--session': { takesValue: true },
  }));
  args.push(request.prompt);
  return args;
}

function getPart(message: Record<string, unknown>): Record<string, unknown> {
  return isRecord(message.part) ? message.part : message;
}

function getOpenCodeErrorMessage(message: Record<string, unknown>): string {
  const error = isRecord(message.error) ? message.error : {};
  const errorData = isRecord(error.data) ? error.data : {};
  return String(errorData.message ?? error.message ?? error.name ?? message.message ?? 'unknown opencode error');
}

export function createOpenCodeBackend(binaryPath: string, env?: Record<string, string>): LlmBackend {
  return {
    provider: 'opencode',
    async execute(request: LlmExecutionRequest, emitter: LlmEventEmitter, signal: AbortSignal): Promise<LlmExecutionResult> {
      const args = buildOpenCodeArgs(request);
      let output = '';
      let sessionId: string | undefined = request.resumeSessionId;
      let protocolStatus: LlmExecutionResult['status'] = 'completed';
      let protocolError: string | undefined;
      const usage: LlmTokenUsage = { inputTokens: 0, outputTokens: 0 };
      const usageKey = request.model || 'unknown';

      const processResult = await runJsonLineProcess({
        label: 'opencode',
        binaryPath,
        args,
        cwd: request.cwd,
        env,
        requestEnv: { ...request.env, OPENCODE_PERMISSION: '{"*":"allow"}' },
        timeoutMs: request.timeout,
        signal,
        emitter,
        jsonStreams: ['stdout'],
        onJson(message) {
          const type = getString(message.type) ?? getString(message.event) ?? '';
          sessionId = getString(message.sessionID) ?? getString(message.sessionId) ?? getString(message.session_id) ?? sessionId;
          if (type === 'step_start') {
            emitter.emit({ type: 'status', status: 'running', sessionId });
            return;
          }
          if (type === 'text') {
            const part = getPart(message);
            const text = String(part.text ?? message.text ?? '');
            if (text) {
              output += text;
              emitter.emit({ type: 'text', content: text });
            }
            return;
          }
          if (type === 'tool_use') {
            const part = getPart(message);
            const callId = String(part.callID ?? part.callId ?? part.id ?? 'tool');
            const tool = String(part.tool ?? part.name ?? 'tool');
            const state = isRecord(part.state) ? part.state : {};
            const input = isRecord(state.input)
              ? state.input
              : isRecord(part.input)
                ? part.input
                : {};
            emitter.emit({
              type: 'tool_use',
              tool,
              callId,
              input,
            });
            if (state.status === 'completed') {
              emitter.emit({
                type: 'tool_result',
                tool,
                callId,
                output: stringifyContent(state.output ?? state.result),
              });
            }
            return;
          }
          if (type === 'step_finish') {
            const part = getPart(message);
            addUsage(usage, part.tokens ?? part.usage ?? message.usage);
            return;
          }
          if (type === 'error') {
            protocolStatus = 'failed';
            protocolError = getOpenCodeErrorMessage(message);
            emitter.emit({ type: 'error', message: protocolError });
          }
        },
      });

      const status = processResult.status === 'completed' ? protocolStatus : processResult.status;
      return {
        status,
        output,
        error: resolveJsonProcessError(processResult, protocolStatus, protocolError),
        providerSessionId: sessionId,
        durationMs: processResult.durationMs,
        usage: usageRecordHasTokens(usage) ? { [usageKey]: usage } : undefined,
      };
    },
  };
}

export const opencodeBackendFactory: LlmBackendFactory = createOpenCodeBackend;
