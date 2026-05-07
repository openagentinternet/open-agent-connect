"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.copilotBackendFactory = void 0;
exports.createCopilotBackend = createCopilotBackend;
const backend_1 = require("./backend");
const jsonProcess_1 = require("./jsonProcess");
function buildCopilotArgs(request) {
    const args = ['-p', request.prompt, '--output-format', 'json', '--allow-all', '--no-ask-user'];
    if (request.model)
        args.push('--model', request.model);
    if (request.resumeSessionId)
        args.push('--resume', request.resumeSessionId);
    args.push(...(0, backend_1.filterBlockedArgs)(request.extraArgs, {
        '-p': { takesValue: true },
        '--output-format': { takesValue: true },
        '--allow-all': { takesValue: false },
        '--allow-all-tools': { takesValue: false },
        '--allow-all-paths': { takesValue: false },
        '--allow-all-urls': { takesValue: false },
        '--yolo': { takesValue: false },
        '--no-ask-user': { takesValue: false },
        '--model': { takesValue: true },
        '--resume': { takesValue: true },
        '--acp': { takesValue: false },
    }));
    return args;
}
function emitToolRequests(value, emitter) {
    if (!Array.isArray(value))
        return;
    for (const request of value) {
        if (!(0, jsonProcess_1.isRecord)(request))
            continue;
        const rawArguments = request.arguments ?? request.input;
        emitter.emit({
            type: 'tool_use',
            tool: String(request.name ?? request.tool ?? 'tool'),
            callId: String(request.toolCallId ?? request.id ?? request.callId ?? 'tool'),
            input: (0, jsonProcess_1.isRecord)(rawArguments) ? rawArguments : {},
        });
    }
}
function createCopilotBackend(binaryPath, env) {
    return {
        provider: 'copilot',
        async execute(request, emitter, signal) {
            const args = buildCopilotArgs(request);
            let output = '';
            let currentTurnStream = '';
            let sessionId;
            let activeModel = request.model || 'copilot';
            let protocolStatus = 'completed';
            let protocolError;
            const usage = {};
            const addOutputTokens = (model, tokens) => {
                if (!Number.isFinite(tokens) || tokens <= 0)
                    return;
                const modelUsage = usage[model] ?? { inputTokens: 0, outputTokens: 0 };
                modelUsage.outputTokens += tokens;
                usage[model] = modelUsage;
            };
            const processResult = await (0, jsonProcess_1.runJsonLineProcess)({
                label: 'copilot',
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
                    const type = (0, jsonProcess_1.getString)(message.type) ?? (0, jsonProcess_1.getString)(message.event) ?? '';
                    const data = (0, jsonProcess_1.isRecord)(message.data) ? message.data : message;
                    if (type === 'session.start') {
                        sessionId = (0, jsonProcess_1.getString)(data.sessionId) ?? (0, jsonProcess_1.getString)(data.session_id) ?? sessionId;
                        activeModel = (0, jsonProcess_1.getString)(data.selectedModel) ?? (0, jsonProcess_1.getString)(data.model) ?? activeModel;
                        emitter.emit({ type: 'status', status: 'running', sessionId });
                        return;
                    }
                    if (type === 'assistant.turn_start') {
                        emitter.emit({ type: 'status', status: 'running', sessionId });
                        return;
                    }
                    if (type === 'assistant.reasoning' || type === 'assistant.reasoning_delta') {
                        const text = String(data.deltaContent ?? data.content ?? data.delta ?? data.reasoningText ?? data.text ?? '');
                        if (text)
                            emitter.emit({ type: 'thinking', content: text });
                        return;
                    }
                    if (type === 'assistant.message_delta') {
                        const text = String(data.deltaContent ?? data.delta ?? data.text ?? data.content ?? '');
                        if (text) {
                            output += text;
                            currentTurnStream += text;
                            emitter.emit({ type: 'text', content: text });
                        }
                        return;
                    }
                    if (type === 'assistant.message') {
                        const text = (0, jsonProcess_1.stringifyContent)(data.content ?? data.message ?? data.text);
                        if (text) {
                            const previousOutput = currentTurnStream && output.endsWith(currentTurnStream)
                                ? output.slice(0, -currentTurnStream.length)
                                : output;
                            output = previousOutput;
                            if (output && !output.endsWith('\n\n'))
                                output += '\n\n';
                            output += text;
                            currentTurnStream = '';
                        }
                        if (typeof data.reasoningText === 'string') {
                            emitter.emit({ type: 'thinking', content: data.reasoningText });
                        }
                        if (typeof data.outputTokens === 'number') {
                            addOutputTokens(activeModel, data.outputTokens);
                        }
                        emitToolRequests(data.toolRequests, emitter);
                        return;
                    }
                    if (type === 'tool.execution_complete') {
                        const failed = data.success === false || data.status === 'failed' || data.error === true;
                        const error = (0, jsonProcess_1.isRecord)(data.error) ? data.error : {};
                        const result = (0, jsonProcess_1.isRecord)(data.result) ? data.result : {};
                        activeModel = (0, jsonProcess_1.getString)(data.model) ?? activeModel;
                        emitter.emit({
                            type: 'tool_result',
                            tool: String(data.toolName ?? data.name ?? data.tool ?? 'tool'),
                            callId: String(data.toolCallId ?? data.callId ?? data.id ?? 'tool'),
                            output: failed
                                ? `Error: ${(0, jsonProcess_1.stringifyContent)(data.errorText ?? error.message ?? data.output)}`
                                : (0, jsonProcess_1.stringifyContent)(result.content ?? data.output ?? data.result),
                        });
                        return;
                    }
                    if (type === 'session.warning') {
                        emitter.emit({ type: 'log', level: 'warning', message: String(data.message ?? 'copilot warning') });
                        return;
                    }
                    if (type === 'session.error') {
                        protocolStatus = 'failed';
                        protocolError = String(data.message ?? data.error ?? 'copilot error');
                        emitter.emit({ type: 'error', message: protocolError });
                        return;
                    }
                    if (type === 'result') {
                        sessionId = (0, jsonProcess_1.getString)(message.sessionId) ?? (0, jsonProcess_1.getString)(message.session_id) ?? (0, jsonProcess_1.getString)(data.sessionId) ?? sessionId;
                        const status = (0, jsonProcess_1.getString)(message.status) ?? (0, jsonProcess_1.getString)(data.status);
                        if (status === 'failed' || status === 'error' || Number(message.exitCode ?? data.exitCode ?? 0) !== 0) {
                            protocolStatus = 'failed';
                            protocolError = String(data.error ?? data.message ?? message.error ?? message.message ?? 'copilot result failed');
                        }
                    }
                },
            });
            const status = processResult.status === 'completed' ? protocolStatus : processResult.status;
            return {
                status,
                output,
                error: (0, jsonProcess_1.resolveJsonProcessError)(processResult, protocolStatus, protocolError),
                providerSessionId: sessionId,
                durationMs: processResult.durationMs,
                usage: Object.keys(usage).length ? usage : undefined,
            };
        },
    };
}
exports.copilotBackendFactory = createCopilotBackend;
