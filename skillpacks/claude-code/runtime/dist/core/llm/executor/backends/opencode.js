"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.opencodeBackendFactory = void 0;
exports.createOpenCodeBackend = createOpenCodeBackend;
const backend_1 = require("./backend");
const jsonProcess_1 = require("./jsonProcess");
function buildOpenCodeArgs(request) {
    const args = ['run', '--format', 'json'];
    if (request.model)
        args.push('--model', request.model);
    if (request.systemPrompt)
        args.push('--prompt', request.systemPrompt);
    if (request.resumeSessionId)
        args.push('--session', request.resumeSessionId);
    args.push(...(0, backend_1.filterBlockedArgs)(request.extraArgs, {
        '--format': { takesValue: true },
        '--model': { takesValue: true },
        '--prompt': { takesValue: true },
        '--session': { takesValue: true },
    }));
    args.push(request.prompt);
    return args;
}
function getPart(message) {
    return (0, jsonProcess_1.isRecord)(message.part) ? message.part : message;
}
function getOpenCodeErrorMessage(message) {
    const error = (0, jsonProcess_1.isRecord)(message.error) ? message.error : {};
    const errorData = (0, jsonProcess_1.isRecord)(error.data) ? error.data : {};
    return String(errorData.message ?? error.message ?? error.name ?? message.message ?? 'unknown opencode error');
}
function createOpenCodeBackend(binaryPath, env) {
    return {
        provider: 'opencode',
        async execute(request, emitter, signal) {
            const args = buildOpenCodeArgs(request);
            let output = '';
            let sessionId = request.resumeSessionId;
            let protocolStatus = 'completed';
            let protocolError;
            const usage = { inputTokens: 0, outputTokens: 0 };
            const usageKey = request.model || 'unknown';
            const processResult = await (0, jsonProcess_1.runJsonLineProcess)({
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
                    const type = (0, jsonProcess_1.getString)(message.type) ?? (0, jsonProcess_1.getString)(message.event) ?? '';
                    sessionId = (0, jsonProcess_1.getString)(message.sessionID) ?? (0, jsonProcess_1.getString)(message.sessionId) ?? (0, jsonProcess_1.getString)(message.session_id) ?? sessionId;
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
                        const state = (0, jsonProcess_1.isRecord)(part.state) ? part.state : {};
                        const input = (0, jsonProcess_1.isRecord)(state.input)
                            ? state.input
                            : (0, jsonProcess_1.isRecord)(part.input)
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
                                output: (0, jsonProcess_1.stringifyContent)(state.output ?? state.result),
                            });
                        }
                        return;
                    }
                    if (type === 'step_finish') {
                        const part = getPart(message);
                        (0, jsonProcess_1.addUsage)(usage, part.tokens ?? part.usage ?? message.usage);
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
                error: (0, jsonProcess_1.resolveJsonProcessError)(processResult, protocolStatus, protocolError),
                providerSessionId: sessionId,
                durationMs: processResult.durationMs,
                usage: (0, jsonProcess_1.usageRecordHasTokens)(usage) ? { [usageKey]: usage } : undefined,
            };
        },
    };
}
exports.opencodeBackendFactory = createOpenCodeBackend;
