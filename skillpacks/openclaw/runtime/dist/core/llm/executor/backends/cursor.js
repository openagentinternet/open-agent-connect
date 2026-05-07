"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cursorBackendFactory = void 0;
exports.createCursorBackend = createCursorBackend;
const backend_1 = require("./backend");
const jsonProcess_1 = require("./jsonProcess");
function buildCursorArgs(request) {
    const args = ['chat', '-p', request.prompt, '--output-format', 'stream-json', '--yolo'];
    if (request.cwd)
        args.push('--workspace', request.cwd);
    if (request.model)
        args.push('--model', request.model);
    if (request.resumeSessionId)
        args.push('--resume', request.resumeSessionId);
    args.push(...(0, backend_1.filterBlockedArgs)(request.extraArgs, {
        '-p': { takesValue: true },
        '--output-format': { takesValue: true },
        '--yolo': { takesValue: false },
        '--workspace': { takesValue: true },
        '--model': { takesValue: true },
        '--resume': { takesValue: true },
    }));
    return args;
}
function emitAssistantBlock(block, emitter) {
    const blockType = (0, jsonProcess_1.getString)(block.type) ?? '';
    if (blockType === 'output_text' || blockType === 'text') {
        const text = String(block.text ?? block.content ?? '');
        if (text)
            emitter.emit({ type: 'text', content: text });
        return text;
    }
    if (blockType === 'thinking') {
        const thinking = String(block.thinking ?? block.text ?? '');
        if (thinking)
            emitter.emit({ type: 'thinking', content: thinking });
        return '';
    }
    if (blockType === 'tool_use') {
        emitter.emit({
            type: 'tool_use',
            tool: String(block.name ?? block.tool ?? 'tool'),
            callId: String(block.id ?? block.callId ?? 'tool'),
            input: (0, jsonProcess_1.isRecord)(block.input) ? block.input : {},
        });
    }
    return '';
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
function extractCursorStepUsage(value) {
    if (!(0, jsonProcess_1.isRecord)(value))
        return undefined;
    const cache = (0, jsonProcess_1.isRecord)(value.cache) ? value.cache : {};
    const usage = {
        inputTokens: (0, jsonProcess_1.numberFromKeys)(value, ['inputTokens', 'input_tokens', 'input']),
        outputTokens: (0, jsonProcess_1.numberFromKeys)(value, ['outputTokens', 'output_tokens', 'output']),
        cacheReadTokens: (0, jsonProcess_1.numberFromKeys)(cache, ['read']) || (0, jsonProcess_1.numberFromKeys)(value, ['cacheReadTokens', 'cacheRead', 'cache_read', 'cached_input_tokens']) || undefined,
        cacheWriteTokens: (0, jsonProcess_1.numberFromKeys)(cache, ['write']) || (0, jsonProcess_1.numberFromKeys)(value, ['cacheWriteTokens', 'cacheWrite', 'cache_write']) || undefined,
    };
    return (0, jsonProcess_1.usageRecordHasTokens)(usage) ? usage : undefined;
}
function createCursorBackend(binaryPath, env) {
    return {
        provider: 'cursor',
        async execute(request, emitter, signal) {
            const args = buildCursorArgs(request);
            let output = '';
            let resultOutput;
            let sessionId = request.resumeSessionId;
            let protocolStatus = 'completed';
            let protocolError;
            const stepUsage = {};
            const resultUsage = {};
            let hasResultUsage = false;
            const processResult = await (0, jsonProcess_1.runJsonLineProcess)({
                label: 'cursor',
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
                    const type = (0, jsonProcess_1.getString)(message.type) ?? '';
                    const subtype = (0, jsonProcess_1.getString)(message.subtype) ?? '';
                    if (type === 'system/init' || (type === 'system' && subtype === 'init')) {
                        sessionId = (0, jsonProcess_1.getString)(message.session_id) ?? (0, jsonProcess_1.getString)(message.sessionId) ?? sessionId;
                        emitter.emit({ type: 'status', status: 'running', sessionId });
                        return;
                    }
                    if (type === 'system/error' || (type === 'system' && subtype === 'error') || type === 'error') {
                        protocolStatus = 'failed';
                        protocolError = String(message.message ?? message.error ?? message.detail ?? 'cursor error');
                        emitter.emit({ type: 'error', message: protocolError });
                        return;
                    }
                    if (type === 'assistant.message' || type === 'assistant') {
                        const assistantMessage = (0, jsonProcess_1.isRecord)(message.message) ? message.message : {};
                        const content = Array.isArray(message.content)
                            ? message.content
                            : Array.isArray(assistantMessage.content)
                                ? assistantMessage.content
                                : [];
                        for (const block of content) {
                            if (!(0, jsonProcess_1.isRecord)(block))
                                continue;
                            output += emitAssistantBlock(block, emitter);
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
                    if (type === 'text') {
                        const part = (0, jsonProcess_1.isRecord)(message.part) ? message.part : message;
                        const text = String(part.text ?? message.text ?? '');
                        if (text) {
                            output += text;
                            emitter.emit({ type: 'text', content: text });
                        }
                        return;
                    }
                    if (type === 'step_finish') {
                        const part = (0, jsonProcess_1.isRecord)(message.part) ? message.part : {};
                        const model = (0, jsonProcess_1.getString)(message.model) ?? 'cursor';
                        addUsageToRecord(stepUsage, model, extractCursorStepUsage(part.tokens ?? part.usage ?? message.usage));
                        return;
                    }
                    if (type === 'result') {
                        sessionId = (0, jsonProcess_1.getString)(message.session_id) ?? (0, jsonProcess_1.getString)(message.sessionId) ?? sessionId;
                        const candidateOutput = typeof message.result === 'string'
                            ? message.result
                            : (0, jsonProcess_1.stringifyContent)(message.output ?? message.text);
                        if (!output)
                            resultOutput = candidateOutput;
                        const model = (0, jsonProcess_1.getString)(message.model) ?? 'cursor';
                        hasResultUsage = addUsageToRecord(resultUsage, model, (0, jsonProcess_1.extractUsage)(message.usage)) || hasResultUsage;
                        if (message.is_error === true || message.status === 'error' || message.subtype === 'error') {
                            protocolStatus = 'failed';
                            protocolError = candidateOutput || String(message.error ?? message.detail ?? 'cursor result failed');
                        }
                    }
                },
            });
            const status = processResult.status === 'completed' ? protocolStatus : processResult.status;
            const usage = hasResultUsage ? resultUsage : stepUsage;
            return {
                status,
                output: resultOutput || output,
                error: (0, jsonProcess_1.resolveJsonProcessError)(processResult, protocolStatus, protocolError),
                providerSessionId: sessionId,
                durationMs: processResult.durationMs,
                usage: Object.keys(usage).length ? usage : undefined,
            };
        },
    };
}
exports.cursorBackendFactory = createCursorBackend;
