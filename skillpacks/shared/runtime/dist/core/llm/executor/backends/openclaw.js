"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openClawBackendFactory = void 0;
exports.createOpenClawBackend = createOpenClawBackend;
const backend_1 = require("./backend");
const jsonProcess_1 = require("./jsonProcess");
function createSessionId() {
    return `oac-openclaw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function buildOpenClawArgs(request, sessionId) {
    const args = ['agent', '--local', '--json', '--session-id', sessionId];
    const extraArgs = (0, backend_1.filterBlockedArgs)(request.extraArgs, {
        '--message': { takesValue: true },
        '--session-id': { takesValue: true },
        '--json': { takesValue: false },
        '--local': { takesValue: false },
        '--model': { takesValue: true },
        '--system-prompt': { takesValue: true },
    });
    if (request.model && !(0, jsonProcess_1.hasArg)(extraArgs, '--agent')) {
        args.push('--agent', request.model);
    }
    args.push(...extraArgs);
    args.push('--message', request.systemPrompt ? `${request.systemPrompt}\n\n${request.prompt}` : request.prompt);
    return args;
}
function getToolName(message) {
    return String(message.name ?? message.tool ?? message.tool_name ?? 'tool');
}
function getCallId(message) {
    return String(message.id ?? message.callId ?? message.call_id ?? message.tool_use_id ?? 'tool');
}
function getErrorMessage(message, fallback) {
    const error = (0, jsonProcess_1.isRecord)(message.error) ? message.error : {};
    const errorData = (0, jsonProcess_1.isRecord)(error.data) ? error.data : {};
    const data = (0, jsonProcess_1.isRecord)(message.data) ? message.data : {};
    return String(errorData.message ?? error.message ?? error.name ?? data.message ?? message.message ?? message.error ?? message.name ?? fallback);
}
function applyLegacyOpenClawResult(message, emitter, state) {
    let appendedOutput = state.output;
    if (Array.isArray(message.payloads)) {
        for (const payload of message.payloads) {
            if (!(0, jsonProcess_1.isRecord)(payload))
                continue;
            const text = String(payload.text ?? '');
            if (text) {
                appendedOutput += text;
                emitter.emit({ type: 'text', content: text });
            }
        }
    }
    const meta = (0, jsonProcess_1.isRecord)(message.meta) ? message.meta : {};
    const agentMeta = (0, jsonProcess_1.isRecord)(meta.agentMeta) ? meta.agentMeta : {};
    state.providerSessionId = (0, jsonProcess_1.getString)(agentMeta.sessionId) ?? state.providerSessionId;
    state.usageKey = (0, jsonProcess_1.getString)(agentMeta.model) ?? state.usageKey;
    (0, jsonProcess_1.addUsage)(state.usage, agentMeta.usage);
    state.output = appendedOutput;
    state.resultOutput = appendedOutput;
    return appendedOutput;
}
function parsePrettyJsonLines(lines) {
    const trimmed = lines.map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < trimmed.length; index += 1) {
        const candidate = trimmed.slice(index).join('\n');
        if (!candidate.startsWith('{'))
            continue;
        try {
            const parsed = JSON.parse(candidate);
            return (0, jsonProcess_1.isRecord)(parsed) ? parsed : undefined;
        }
        catch {
            // Keep looking for a later JSON object start.
        }
    }
    return undefined;
}
function createOpenClawBackend(binaryPath, env) {
    return {
        provider: 'openclaw',
        async execute(request, emitter, signal) {
            const sessionId = request.resumeSessionId || createSessionId();
            const args = buildOpenClawArgs(request, sessionId);
            let output = '';
            let resultOutput;
            let providerSessionId = sessionId;
            let protocolStatus = 'completed';
            let protocolError;
            const usage = { inputTokens: 0, outputTokens: 0 };
            let usageKey = request.model || 'openclaw';
            const prettyJsonLines = [];
            const processResult = await (0, jsonProcess_1.runJsonLineProcess)({
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
                    if (stream === 'stderr')
                        prettyJsonLines.push(line);
                },
                onJson(message) {
                    const type = (0, jsonProcess_1.getString)(message.type) ?? (0, jsonProcess_1.getString)(message.event) ?? '';
                    if (!type && Array.isArray(message.payloads)) {
                        const state = { output, resultOutput, providerSessionId, usage, usageKey };
                        output = applyLegacyOpenClawResult(message, emitter, state);
                        resultOutput = state.resultOutput;
                        providerSessionId = state.providerSessionId;
                        usageKey = state.usageKey;
                        return;
                    }
                    providerSessionId = (0, jsonProcess_1.getString)(message.session_id) ?? (0, jsonProcess_1.getString)(message.sessionId) ?? providerSessionId;
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
                            input: (0, jsonProcess_1.isRecord)(message.input) ? message.input : {},
                        });
                        return;
                    }
                    if (type === 'tool_result') {
                        emitter.emit({
                            type: 'tool_result',
                            tool: getToolName(message),
                            callId: getCallId(message),
                            output: (0, jsonProcess_1.stringifyContent)(message.text ?? message.output ?? message.content ?? message.result),
                        });
                        return;
                    }
                    if (type === 'step_finish') {
                        usageKey = (0, jsonProcess_1.getString)(message.model) ?? usageKey;
                        (0, jsonProcess_1.addUsage)(usage, message.usage);
                        return;
                    }
                    if (type === 'error') {
                        protocolStatus = 'failed';
                        protocolError = getErrorMessage(message, 'openclaw error');
                        emitter.emit({ type: 'error', message: protocolError });
                        return;
                    }
                    if (type === 'result') {
                        providerSessionId = (0, jsonProcess_1.getString)(message.session_id) ?? (0, jsonProcess_1.getString)(message.sessionId) ?? providerSessionId;
                        resultOutput = typeof message.result === 'string'
                            ? message.result
                            : (0, jsonProcess_1.stringifyContent)(message.output ?? message.content);
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
            const error = (0, jsonProcess_1.resolveJsonProcessError)(processResult, protocolStatus, protocolError);
            return {
                status,
                output: resultOutput || output,
                error,
                providerSessionId,
                durationMs: processResult.durationMs,
                usage: (0, jsonProcess_1.usageRecordHasTokens)(usage) ? { [usageKey]: usage } : undefined,
            };
        },
    };
}
exports.openClawBackendFactory = createOpenClawBackend;
