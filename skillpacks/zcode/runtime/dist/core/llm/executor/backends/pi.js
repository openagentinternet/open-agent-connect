"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.piBackendFactory = void 0;
exports.createPiBackend = createPiBackend;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const backend_1 = require("./backend");
const jsonProcess_1 = require("./jsonProcess");
const PI_TOOLS = 'read,bash,edit,write,grep,find,ls';
function resolveHome(env, requestEnv) {
    return requestEnv?.HOME || env?.HOME || process.env.HOME || process.cwd();
}
async function resolveSessionPath(request, env) {
    const sessionPath = request.resumeSessionId
        ?? node_path_1.default.join(resolveHome(env, request.env), '.metabot', 'runtime', 'pi-sessions', `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jsonl`);
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(sessionPath), { recursive: true });
    const file = await node_fs_1.promises.open(sessionPath, 'a');
    await file.close();
    return sessionPath;
}
function splitProviderModel(model) {
    if (!model)
        return {};
    const slashIndex = model.indexOf('/');
    if (slashIndex <= 0 || slashIndex === model.length - 1)
        return { model };
    return {
        provider: model.slice(0, slashIndex),
        model: model.slice(slashIndex + 1),
    };
}
function buildPiArgs(request, sessionPath) {
    const args = ['-p', '--mode', 'json', '--session', sessionPath];
    const split = splitProviderModel(request.model);
    if (split.provider)
        args.push('--provider', split.provider);
    if (split.model)
        args.push('--model', split.model);
    args.push('--tools', PI_TOOLS);
    if (request.systemPrompt)
        args.push('--append-system-prompt', request.systemPrompt);
    args.push(...(0, backend_1.filterBlockedArgs)(request.extraArgs, {
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
function createPiBackend(binaryPath, env) {
    return {
        provider: 'pi',
        async execute(request, emitter, signal) {
            const sessionPath = await resolveSessionPath(request, env);
            const args = buildPiArgs(request, sessionPath);
            let output = '';
            let protocolStatus = 'completed';
            let protocolError;
            const usage = {};
            const processResult = await (0, jsonProcess_1.runJsonLineProcess)({
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
                    const type = (0, jsonProcess_1.getString)(message.type) ?? '';
                    if (type === 'agent_start') {
                        emitter.emit({ type: 'status', status: 'running', sessionId: sessionPath });
                        return;
                    }
                    if (type === 'message_update') {
                        const event = (0, jsonProcess_1.isRecord)(message.assistantMessageEvent) ? message.assistantMessageEvent : {};
                        const eventType = (0, jsonProcess_1.getString)(event.type) ?? '';
                        const delta = String(event.delta ?? event.text ?? '');
                        if (eventType === 'text_delta' && delta) {
                            output += delta;
                            emitter.emit({ type: 'text', content: delta });
                        }
                        else if (eventType === 'thinking_delta' && delta) {
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
                            input: (0, jsonProcess_1.isRecord)(rawArgs) ? rawArgs : {},
                        });
                        return;
                    }
                    if (type === 'tool_execution_end') {
                        emitter.emit({
                            type: 'tool_result',
                            tool: String(message.toolName ?? message.name ?? message.tool ?? 'tool'),
                            callId: String(message.toolCallId ?? message.id ?? message.callId ?? 'tool'),
                            output: (0, jsonProcess_1.stringifyContent)(message.result ?? message.output),
                        });
                        return;
                    }
                    if (type === 'turn_end') {
                        const turnMessage = (0, jsonProcess_1.isRecord)(message.message) ? message.message : {};
                        const model = (0, jsonProcess_1.getString)(turnMessage.model) ?? request.model ?? 'unknown';
                        const normalized = (0, jsonProcess_1.extractUsage)(turnMessage.usage ?? message.usage);
                        if (normalized)
                            usage[model] = normalized;
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
                error: (0, jsonProcess_1.resolveJsonProcessError)(processResult, protocolStatus, protocolError),
                providerSessionId: sessionPath,
                durationMs: processResult.durationMs,
                usage: Object.keys(usage).length ? usage : undefined,
            };
        },
    };
}
exports.piBackendFactory = createPiBackend;
