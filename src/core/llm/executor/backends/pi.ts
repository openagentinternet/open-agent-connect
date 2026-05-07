import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LlmExecutionRequest, LlmExecutionResult, LlmEventEmitter, LlmTokenUsage } from '../types';
import { filterBlockedArgs, type LlmBackend, type LlmBackendFactory } from './backend';
import { extractUsage, getString, isRecord, resolveJsonProcessError, runJsonLineProcess, stringifyContent } from './jsonProcess';

const PI_TOOLS = 'read,bash,edit,write,grep,find,ls';

function resolveHome(env: Record<string, string> | undefined, requestEnv: Record<string, string> | undefined): string {
  return requestEnv?.HOME || env?.HOME || process.env.HOME || process.cwd();
}

async function resolveSessionPath(request: LlmExecutionRequest, env: Record<string, string> | undefined): Promise<string> {
  const sessionPath = request.resumeSessionId
    ?? path.join(
      resolveHome(env, request.env),
      '.metabot',
      'runtime',
      'pi-sessions',
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jsonl`,
  );
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  const file = await fs.open(sessionPath, 'a');
  await file.close();
  return sessionPath;
}

function splitProviderModel(model: string | undefined): { provider?: string; model?: string } {
  if (!model) return {};
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0 || slashIndex === model.length - 1) return { model };
  return {
    provider: model.slice(0, slashIndex),
    model: model.slice(slashIndex + 1),
  };
}

function buildPiArgs(request: LlmExecutionRequest, sessionPath: string): string[] {
  const args = ['-p', '--mode', 'json', '--session', sessionPath];
  const split = splitProviderModel(request.model);
  if (split.provider) args.push('--provider', split.provider);
  if (split.model) args.push('--model', split.model);
  args.push('--tools', PI_TOOLS);
  if (request.systemPrompt) args.push('--append-system-prompt', request.systemPrompt);
  args.push(...filterBlockedArgs(request.extraArgs, {
    '-p': { takesValue: false },
    '--print': { takesValue: false },
    '--mode': { takesValue: true },
    '--session': { takesValue: true },
    '--provider': { takesValue: true },
    '--model': { takesValue: true },
    '--tools': { takesValue: true },
    '--append-system-prompt': { takesValue: true },
  }));
  args.push(request.prompt);
  return args;
}

export function createPiBackend(binaryPath: string, env?: Record<string, string>): LlmBackend {
  return {
    provider: 'pi',
    async execute(request: LlmExecutionRequest, emitter: LlmEventEmitter, signal: AbortSignal): Promise<LlmExecutionResult> {
      const sessionPath = await resolveSessionPath(request, env);
      const args = buildPiArgs(request, sessionPath);
      let output = '';
      let protocolStatus: LlmExecutionResult['status'] = 'completed';
      let protocolError: string | undefined;
      const usage: Record<string, LlmTokenUsage> = {};

      const processResult = await runJsonLineProcess({
        label: 'pi',
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
          if (type === 'agent_start') {
            emitter.emit({ type: 'status', status: 'running', sessionId: sessionPath });
            return;
          }
          if (type === 'message_update') {
            const event = isRecord(message.assistantMessageEvent) ? message.assistantMessageEvent : {};
            const eventType = getString(event.type) ?? '';
            const delta = String(event.delta ?? event.text ?? '');
            if (eventType === 'text_delta' && delta) {
              output += delta;
              emitter.emit({ type: 'text', content: delta });
            } else if (eventType === 'thinking_delta' && delta) {
              emitter.emit({ type: 'thinking', content: delta });
            }
            return;
          }
          if (type === 'tool_execution_start') {
            const rawArgs = message.args ?? message.input;
            emitter.emit({
              type: 'tool_use',
              tool: String(message.toolName ?? message.name ?? message.tool ?? 'tool'),
              callId: String(message.toolCallId ?? message.id ?? message.callId ?? 'tool'),
              input: isRecord(rawArgs) ? rawArgs : {},
            });
            return;
          }
          if (type === 'tool_execution_end') {
            emitter.emit({
              type: 'tool_result',
              tool: String(message.toolName ?? message.name ?? message.tool ?? 'tool'),
              callId: String(message.toolCallId ?? message.id ?? message.callId ?? 'tool'),
              output: stringifyContent(message.result ?? message.output),
            });
            return;
          }
          if (type === 'turn_end') {
            const turnMessage = isRecord(message.message) ? message.message : {};
            const model = getString(turnMessage.model) ?? request.model ?? 'unknown';
            const normalized = extractUsage(turnMessage.usage ?? message.usage);
            if (normalized) usage[model] = normalized;
            return;
          }
          if (type === 'auto_retry_end' && message.success === false) {
            protocolStatus = 'failed';
            protocolError = String(message.finalError ?? 'pi exhausted automatic retries');
            emitter.emit({ type: 'error', message: protocolError });
            return;
          }
          if (type === 'error') {
            protocolStatus = 'failed';
            protocolError = String(message.message ?? message.error ?? 'pi error');
            emitter.emit({ type: 'error', message: protocolError });
          }
        },
      });

      const status = processResult.status === 'completed' ? protocolStatus : processResult.status;
      return {
        status,
        output,
        error: resolveJsonProcessError(processResult, protocolStatus, protocolError),
        providerSessionId: sessionPath,
        durationMs: processResult.durationMs,
        usage: Object.keys(usage).length ? usage : undefined,
      };
    },
  };
}

export const piBackendFactory: LlmBackendFactory = createPiBackend;
