"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.geminiBackendFactory = void 0;
exports.createGeminiBackend = createGeminiBackend;
const backend_1 = require("./backend");
const jsonProcess_1 = require("./jsonProcess");
function buildGeminiArgs(request) {
    const args = ['-p', request.prompt, '--yolo', '-o', 'stream-json'];
    if (request.model)
        args.push('-m', request.model);
    if (request.resumeSessionId)
        args.push('-r', request.resumeSessionId);
    args.push(...(0, backend_1.filterBlockedArgs)(request.extraArgs, {
        '-p': { takesValue: true },
        '--yolo': { takesValue: false },
        '-o': { takesValue: true },
        '-m': { takesValue: true },
        '-r': { takesValue: true },
    }));
    return args;
}
function createGeminiBackend(binaryPath, env) {
    return {
        provider: 'gemini',
        async execute(request, emitter, signal) {
            const args = buildGeminiArgs(request);
            let output = '';
            let sessionId = request.resumeSessionId;
            let protocolStatus = 'completed';
            let protocolError;
            const usage = {};
            const processResult = await (0, jsonProcess_1.runJsonLineProcess)({
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
                    const type = (0, jsonProcess_1.getString)(message.type) ?? '';
                    if (type === 'init') {
                        sessionId = (0, jsonProcess_1.getString)(message.session_id) ?? (0, jsonProcess_1.getString)(message.sessionId) ?? sessionId;
                        emitter.emit({ type: 'status', status: 'running', sessionId });
                        return;
                    }
                    if (type === 'message') {
                        if (message.role !== 'assistant')
                            return;
                        const text = (0, jsonProcess_1.stringifyContent)(message.content ?? message.text);
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
                            input: (0, jsonProcess_1.isRecord)(rawParameters) ? rawParameters : {},
                        });
                        return;
                    }
                    if (type === 'tool_result') {
                        emitter.emit({
                            type: 'tool_result',
                            tool: String(message.tool_name ?? message.name ?? message.tool ?? 'tool'),
                            callId: String(message.tool_id ?? message.tool_use_id ?? message.id ?? message.callId ?? 'tool'),
                            output: (0, jsonProcess_1.stringifyContent)(message.output ?? message.result ?? message.content),
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
                            const error = (0, jsonProcess_1.isRecord)(message.error) ? message.error : {};
                            protocolStatus = 'failed';
                            protocolError = String(error.message ?? message.message ?? message.error ?? protocolError ?? 'gemini result failed');
                        }
                        const stats = (0, jsonProcess_1.isRecord)(message.stats) ? message.stats : {};
                        const models = (0, jsonProcess_1.isRecord)(stats.models) ? stats.models : {};
                        for (const [model, modelUsage] of Object.entries(models)) {
                            const normalized = (0, jsonProcess_1.extractUsage)(modelUsage);
                            if (normalized)
                                usage[model] = normalized;
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
exports.geminiBackendFactory = createGeminiBackend;
