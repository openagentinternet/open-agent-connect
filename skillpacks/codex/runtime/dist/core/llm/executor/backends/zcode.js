"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zcodeBackendFactory = void 0;
exports.createZCodeBackend = createZCodeBackend;
const backend_1 = require("./backend");
const jsonProcess_1 = require("./jsonProcess");
function buildZCodePrompt(request) {
    return request.systemPrompt
        ? `${request.systemPrompt}\n\n${request.prompt}`
        : request.prompt;
}
function buildZCodeArgs(request) {
    const args = ['--prompt', buildZCodePrompt(request), '--json', '--no-browser'];
    if (request.cwd)
        args.push('--cwd', request.cwd);
    if (!(0, jsonProcess_1.hasArg)(request.extraArgs, '--mode'))
        args.push('--mode', 'yolo');
    if (request.resumeSessionId)
        args.push('--resume', request.resumeSessionId);
    args.push(...(0, backend_1.filterBlockedArgs)(request.extraArgs, {
        '--prompt': { takesValue: true },
        '-p': { takesValue: true },
        '--json': { takesValue: false },
        '--no-browser': { takesValue: false },
        '--cwd': { takesValue: true },
        '--resume': { takesValue: true },
    }));
    return args;
}
function emitText(text, emitter) {
    if (!text)
        return '';
    emitter.emit({ type: 'text', content: text });
    return text;
}
function emitAssistantBlock(block, emitter) {
    const blockType = (0, jsonProcess_1.getString)(block.type) ?? '';
    if (blockType === 'output_text' || blockType === 'text') {
        return emitText(String(block.text ?? block.content ?? ''), emitter);
    }
    if (blockType === 'thinking' || blockType === 'thought') {
        const thinking = String(block.thinking ?? block.text ?? block.content ?? '');
        if (thinking)
            emitter.emit({ type: 'thinking', content: thinking });
        return '';
    }
    if (blockType === 'tool_use' || blockType === 'tool_call') {
        emitter.emit({
            type: 'tool_use',
            tool: String(block.name ?? block.tool_name ?? block.tool ?? 'tool'),
            callId: String(block.id ?? block.tool_id ?? block.callId ?? 'tool'),
            input: (0, jsonProcess_1.isRecord)(block.input) ? block.input : {},
        });
    }
    return '';
}
function emitAssistantContent(value, emitter) {
    if (typeof value === 'string') {
        return emitText(value, emitter);
    }
    if (!Array.isArray(value))
        return '';
    let output = '';
    for (const block of value) {
        if ((0, jsonProcess_1.isRecord)(block)) {
            output += emitAssistantBlock(block, emitter);
        }
        else if (typeof block === 'string') {
            output += emitText(block, emitter);
        }
    }
    return output;
}
function addUsageToRecord(usageByModel, model, value) {
    if (!value || !(0, jsonProcess_1.usageRecordHasTokens)(value))
        return false;
    const current = usageByModel[model] ?? { inputTokens: 0, outputTokens: 0 };
    current.inputTokens += value.inputTokens;
    current.outputTokens += value.outputTokens;
    if (value.cacheReadTokens)
        current.cacheReadTokens = (current.cacheReadTokens ?? 0) + value.cacheReadTokens;
    if (value.cacheWriteTokens)
        current.cacheWriteTokens = (current.cacheWriteTokens ?? 0) + value.cacheWriteTokens;
    usageByModel[model] = current;
    return true;
}
function createZCodeBackend(binaryPath, env) {
    return {
        provider: 'zcode',
        async execute(request, emitter, signal) {
            const args = buildZCodeArgs(request);
            let output = '';
            let resultOutput;
            let sessionId = request.resumeSessionId;
            let protocolStatus = 'completed';
            let protocolError;
            const resultUsage = {};
            const processResult = await (0, jsonProcess_1.runJsonLineProcess)({
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
                    const type = (0, jsonProcess_1.getString)(message.type) ?? (0, jsonProcess_1.getString)(message.event) ?? '';
                    const subtype = (0, jsonProcess_1.getString)(message.subtype) ?? '';
                    if (type === 'system/init' || type === 'init' || (type === 'system' && subtype === 'init')) {
                        sessionId = (0, jsonProcess_1.getString)(message.session_id) ?? (0, jsonProcess_1.getString)(message.sessionId) ?? (0, jsonProcess_1.getString)(message.id) ?? sessionId;
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
                        const assistantMessage = (0, jsonProcess_1.isRecord)(message.message) ? message.message : {};
                        output += emitAssistantContent(message.content ?? assistantMessage.content ?? message.text ?? assistantMessage.text, emitter);
                        return;
                    }
                    if (type === 'text' || type === 'output_text' || type === 'delta') {
                        output += emitText(String(message.text ?? message.content ?? message.delta ?? ''), emitter);
                        return;
                    }
                    if (type === 'thinking' || type === 'thought') {
                        const thinking = String(message.thinking ?? message.text ?? message.content ?? '');
                        if (thinking)
                            emitter.emit({ type: 'thinking', content: thinking });
                        return;
                    }
                    if (type === 'tool_use' || type === 'tool_call') {
                        const rawParameters = message.parameters ?? message.input ?? message.arguments;
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
                    if (type === 'result' || type === 'finish' || type === 'completed' || (type === 'system' && subtype === 'result')) {
                        sessionId = (0, jsonProcess_1.getString)(message.session_id) ?? (0, jsonProcess_1.getString)(message.sessionId) ?? sessionId;
                        const candidateOutput = typeof message.result === 'string'
                            ? message.result
                            : (0, jsonProcess_1.stringifyContent)(message.output ?? message.text ?? message.content);
                        if (!output)
                            resultOutput = candidateOutput;
                        const model = (0, jsonProcess_1.getString)(message.model) ?? 'zcode';
                        addUsageToRecord(resultUsage, model, (0, jsonProcess_1.extractUsage)(message.usage ?? message.stats ?? message.token_usage));
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
                error: (0, jsonProcess_1.resolveJsonProcessError)(processResult, protocolStatus, protocolError),
                providerSessionId: sessionId,
                durationMs: processResult.durationMs,
                usage: Object.keys(resultUsage).length ? resultUsage : undefined,
            };
        },
    };
}
exports.zcodeBackendFactory = createZCodeBackend;
