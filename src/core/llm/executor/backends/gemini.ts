import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter, LlmTokenUsage } from '../types';
import { filterBlockedArgs, type LlmBackend, type LlmBackendFactory } from './backend';
import { extractUsage, getString, isRecord, resolveJsonProcessError, runJsonLineProcess, stringifyContent } from './jsonProcess';

function buildGeminiArgs(request: LlmExecutionRequest): string[] {
  const args = ['-p', request.prompt, '--yolo', '-o', 'stream-json'];
  if (request.model) args.push('-m', request.model);
  if (request.resumeSessionId) args.push('-r', request.resumeSessionId);
  args.push(...filterBlockedArgs(request.extraArgs, {
    '-p': { takesValue: true },
    '--yolo': { takesValue: false },
    '-o': { takesValue: true },
    '-m': { takesValue: true },
    '-r': { takesValue: true },
  }));
  return args;
}

export function createGeminiBackend(binaryPath: string, env?: Record<string, string>): LlmBackend {
  return {
    provider: 'gemini',
    async execute(request: LlmExecutionRequest, emitter: LlmEventEmitter, signal: AbortSignal): Promise<LlmExecutionResult> {
      const args = buildGeminiArgs(request);
      let output = '';
      let sessionId: string | undefined = request.resumeSessionId;
      let protocolStatus: LlmExecutionResult['status'] = 'completed';
      let protocolError: string | undefined;
      const usage: Record<string, LlmTokenUsage> = {};

      const processResult = await runJsonLineProcess({
        label: 'gemini',
        binaryPath,
        args,
        cwd: request.cwd,
        env,
        requestEnv: request.env,
        timeoutMs: request.timeout,
        signal,
        emitter,
        jsonStreams: ['stdout'],
        onJson(message) {
          const type = getString(message.type) ?? '';
          if (type === 'init') {
            sessionId = getString(message.session_id) ?? getString(message.sessionId) ?? sessionId;
            emitter.emit({ type: 'status', status: 'running', sessionId });
            return;
          }
          if (type === 'message') {
            if (message.role !== 'assistant') return;
            const text = stringifyContent(message.content ?? message.text);
            if (text) {
              output += text;
              emitter.emit({ type: 'text', content: text });
            }
            return;
          }
          if (type === 'tool_use') {
            const rawParameters = message.parameters ?? message.input;
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
          if (type === 'error') {
            protocolError = String(message.message ?? message.error ?? 'gemini error');
            emitter.emit({ type: 'error', message: protocolError });
            return;
          }
          if (type === 'result') {
            if (message.status === 'error' || message.status === 'failed') {
              const error = isRecord(message.error) ? message.error : {};
              protocolStatus = 'failed';
              protocolError = String(error.message ?? message.message ?? message.error ?? protocolError ?? 'gemini result failed');
            }
            const stats = isRecord(message.stats) ? message.stats : {};
            const models = isRecord(stats.models) ? stats.models : {};
            for (const [model, modelUsage] of Object.entries(models)) {
              const normalized = extractUsage(modelUsage);
              if (normalized) usage[model] = normalized;
            }
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
        usage: Object.keys(usage).length ? usage : undefined,
      };
    },
  };
}

export const geminiBackendFactory: LlmBackendFactory = createGeminiBackend;
