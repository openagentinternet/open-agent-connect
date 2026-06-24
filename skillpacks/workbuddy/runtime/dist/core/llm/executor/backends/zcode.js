"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.zcodeBackendFactory = void 0;
exports.createZCodeBackend = createZCodeBackend;
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_readline_1 = __importDefault(require("node:readline"));
const backend_1 = require("./backend");
const jsonProcess_1 = require("./jsonProcess");
const DEFAULT_ZCODE_PROTOCOL_TIMEOUT_MS = 1_200_000;
const ZCODE_API_KEY_ENV_NAMES = ['ZCODE_API_KEY', 'Z_AI_API_KEY', 'ZAI_API_KEY', 'BIGMODEL_API_KEY'];
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
function isMissingModelConfigError(error) {
    return Boolean(error && /Model config is missing/i.test(error) && /zcode\/cli\/config\.json|explicit model provider/i.test(error));
}
function getNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function compactRecord(value) {
    for (const key of Object.keys(value)) {
        if (value[key] === undefined)
            delete value[key];
    }
    return value;
}
function readRecord(value) {
    return (0, jsonProcess_1.isRecord)(value) ? value : {};
}
function getHomeDir(env) {
    return (0, jsonProcess_1.getString)(env.HOME) ?? (0, jsonProcess_1.getString)(env.USERPROFILE) ?? node_os_1.default.homedir();
}
function getProviderOptions(provider) {
    return readRecord(provider.options);
}
function getProviderApiFormat(kind) {
    switch (kind) {
        case 'anthropic':
            return 'anthropic-messages';
        case 'openai':
            return 'openai-chat-completions';
        case 'gemini':
            return 'gemini-generate-content';
        default:
            return undefined;
    }
}
function resolveInlineApiKey(provider, options, env) {
    const direct = (0, jsonProcess_1.getString)(options.apiKey) ?? (0, jsonProcess_1.getString)(provider.apiKey);
    if (direct)
        return { source: 'inline', value: direct };
    const configuredEnvName = (0, jsonProcess_1.getString)(options.apiKeyEnv) ?? (0, jsonProcess_1.getString)(provider.apiKeyEnv);
    const envName = configuredEnvName ?? ZCODE_API_KEY_ENV_NAMES.find((key) => Boolean(env[key]));
    const envValue = envName ? (0, jsonProcess_1.getString)(env[envName]) : undefined;
    return envValue ? { source: 'inline', value: envValue } : undefined;
}
function getBoolean(value) {
    return typeof value === 'boolean' ? value : undefined;
}
function getRecordOrUndefined(value) {
    return (0, jsonProcess_1.isRecord)(value) ? value : undefined;
}
function buildZCodeProtocolModelEntry(modelId, value) {
    const model = readRecord(value);
    const limit = readRecord(model.limit);
    const modalities = readRecord(model.modalities);
    const inputModalities = Array.isArray(modalities.input) ? modalities.input : [];
    const supportsImages = inputModalities.includes('image');
    return compactRecord({
        modelId,
        label: (0, jsonProcess_1.getString)(model.name) ?? (0, jsonProcess_1.getString)(model.label) ?? modelId,
        description: (0, jsonProcess_1.getString)(model.description),
        contextWindow: getNumber(model.contextWindow) ?? getNumber(limit.context),
        maxOutputTokens: getNumber(model.maxOutputTokens) ?? getNumber(limit.output),
        supportsImages: supportsImages || undefined,
        supportsTools: true,
        supportsStructuredOutput: true,
        providerOptions: getRecordOrUndefined(model.providerOptions),
        disabledReason: (0, jsonProcess_1.getString)(model.disabledReason),
    });
}
function chooseZCodeProvider(entries) {
    const enabled = entries.filter(([, provider]) => provider.enabled !== false);
    const candidates = enabled.length ? enabled : entries;
    const preferredIds = ['builtin:zai-coding-plan', 'builtin:zai', 'zai', 'builtin:bigmodel'];
    for (const id of preferredIds) {
        const match = candidates.find(([providerId]) => providerId === id);
        if (match)
            return match;
    }
    return candidates[0];
}
async function loadZCodeV2RuntimeModel(request, env) {
    const configPath = node_path_1.default.join(getHomeDir(env), '.zcode', 'v2', 'config.json');
    let parsed;
    try {
        parsed = JSON.parse(await (0, promises_1.readFile)(configPath, 'utf8'));
    }
    catch {
        return undefined;
    }
    const config = readRecord(parsed);
    const providerMap = readRecord(config.provider);
    const providerEntries = Object.entries(providerMap)
        .filter((entry) => (0, jsonProcess_1.isRecord)(entry[1]));
    const selected = chooseZCodeProvider(providerEntries);
    if (!selected)
        return undefined;
    const [providerId, provider] = selected;
    const options = getProviderOptions(provider);
    const models = readRecord(provider.models);
    const modelEntries = Object.entries(models)
        .filter((entry) => (0, jsonProcess_1.isRecord)(entry[1]));
    const requestedModel = request.model && models[request.model] ? request.model : undefined;
    const modelId = requestedModel ?? modelEntries[0]?.[0] ?? request.model;
    if (!modelId)
        return undefined;
    const modelList = modelEntries.length
        ? modelEntries.map(([entryModelId, model]) => buildZCodeProtocolModelEntry(entryModelId, model))
        : [buildZCodeProtocolModelEntry(modelId, {})];
    const kind = (0, jsonProcess_1.getString)(provider.kind) ?? (0, jsonProcess_1.getString)(options.kind) ?? 'anthropic';
    const apiKey = resolveInlineApiKey(provider, options, env);
    const apiKeyRequired = getBoolean(options.apiKeyRequired) ?? getBoolean(provider.apiKeyRequired);
    return compactRecord({
        revision: `oac-zcode-v2:${providerId}:${modelId}`,
        generatedAt: Date.now(),
        model: compactRecord({
            providerId,
            modelId,
            variant: (0, jsonProcess_1.getString)(readRecord(models[modelId]).variant),
        }),
        provider: compactRecord({
            providerId,
            kind,
            apiFormat: (0, jsonProcess_1.getString)(provider.apiFormat) ?? (0, jsonProcess_1.getString)(options.apiFormat) ?? getProviderApiFormat(kind),
            label: (0, jsonProcess_1.getString)(provider.name) ?? (0, jsonProcess_1.getString)(provider.label) ?? providerId,
            source: (0, jsonProcess_1.getString)(provider.source) ?? 'zcode-v2-config',
            baseURL: (0, jsonProcess_1.getString)(options.baseURL) ?? (0, jsonProcess_1.getString)(options.baseUrl) ?? (0, jsonProcess_1.getString)(provider.baseURL),
            apiKey,
            apiKeyRequired,
            headers: getRecordOrUndefined(options.headers) ?? getRecordOrUndefined(provider.headers),
            providerOptions: getRecordOrUndefined(options.providerOptions) ?? getRecordOrUndefined(provider.providerOptions),
            modelsDevProviderId: (0, jsonProcess_1.getString)(provider.modelsDevProviderId),
            models: modelList,
        }),
        thoughtLevel: (0, jsonProcess_1.getString)(config.thoughtLevel),
    });
}
function extractProtocolSessionId(value) {
    if (!(0, jsonProcess_1.isRecord)(value))
        return undefined;
    const session = readRecord(value.session);
    return (0, jsonProcess_1.getString)(session.sessionId) ?? (0, jsonProcess_1.getString)(value.sessionId);
}
function extractProtocolEventSeq(value) {
    if (!(0, jsonProcess_1.isRecord)(value))
        return 0;
    const runtime = readRecord(value.runtime);
    return getNumber(runtime.eventSeq) ?? getNumber(value.eventSeq) ?? 0;
}
function getProtocolEvents(value) {
    if (Array.isArray(value)) {
        return value.filter(jsonProcess_1.isRecord);
    }
    if (!(0, jsonProcess_1.isRecord)(value))
        return [];
    const events = value.events;
    return Array.isArray(events) ? events.filter(jsonProcess_1.isRecord) : [];
}
function getProtocolErrorMessage(error, fallback) {
    if (!(0, jsonProcess_1.isRecord)(error))
        return (0, jsonProcess_1.stringifyContent)(error) || fallback;
    const data = readRecord(error.data);
    return String(data.message ?? error.message ?? error.name ?? fallback);
}
function buildPermissionResponse(params) {
    const options = (0, jsonProcess_1.isRecord)(params) && Array.isArray(params.options) ? params.options : [];
    for (const option of options) {
        if (!(0, jsonProcess_1.isRecord)(option))
            continue;
        const response = readRecord(option.response);
        if (response.decision === 'allow' || response.decision === 'accept')
            return response;
    }
    return { decision: 'allow', reason: 'OAC ZCode bridge' };
}
function writeProtocolResponse(childStdin, id, result) {
    childStdin.write(`${JSON.stringify({ id, result })}\n`);
}
async function runZCodeProtocolFallback(binaryPath, env, request, emitter, signal) {
    const processEnv = (0, backend_1.buildProcessEnv)(env, request.env);
    const runtimeModel = await loadZCodeV2RuntimeModel(request, processEnv);
    if (!runtimeModel)
        return undefined;
    const startedAt = Date.now();
    const child = (0, node_child_process_1.spawn)(binaryPath, ['app-server'], {
        cwd: request.cwd,
        env: processEnv,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let nextId = 1;
    const pending = new Map();
    const usageByModel = {};
    const outputParts = [];
    let stderr = '';
    let finalStatus = 'completed';
    let finalError;
    let sessionId = request.resumeSessionId;
    const childExit = new Promise((resolve) => {
        child.on('close', (code) => {
            const suffix = stderr.trim() ? `\n${stderr.trim().slice(-4096)}` : '';
            for (const requestEntry of pending.values()) {
                requestEntry.reject(new Error(`zcode protocol exited while waiting for ${requestEntry.method}${suffix}`));
            }
            pending.clear();
            resolve(code);
        });
    });
    const childError = new Promise((resolve) => {
        child.once('error', (error) => resolve(error));
    });
    const writeJson = (message) => {
        child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const requestProtocol = (method, params) => {
        const id = nextId;
        nextId += 1;
        return new Promise((resolve, reject) => {
            pending.set(id, { method, resolve, reject });
            try {
                writeJson({ id, method, params });
            }
            catch (error) {
                pending.delete(id);
                reject(error instanceof Error ? error : new Error((0, backend_1.stringifyError)(error)));
            }
        });
    };
    const emitTextDelta = (text) => {
        if (!text)
            return;
        outputParts.push(text);
        emitter.emit({ type: 'text', content: text });
    };
    const emitFinalText = (text) => {
        if (!text)
            return;
        const current = outputParts.join('');
        if (!current) {
            emitTextDelta(text);
            return;
        }
        if (text.startsWith(current)) {
            emitTextDelta(text.slice(current.length));
            return;
        }
        outputParts.splice(0, outputParts.length, text);
    };
    const handleAgentRequest = (message) => {
        if (message.id === undefined || !message.method)
            return;
        if (message.method === 'interaction/requestPermission') {
            writeProtocolResponse(child.stdin, message.id, buildPermissionResponse(message.params));
            return;
        }
        if (message.method === 'interaction/requestUserInput') {
            writeProtocolResponse(child.stdin, message.id, { action: 'decline', reason: 'OAC ZCode bridge' });
            return;
        }
        if (message.method === 'interaction/requestProviderRuntimeHeaders') {
            writeProtocolResponse(child.stdin, message.id, { headersApplied: false });
            return;
        }
        writeProtocolResponse(child.stdin, message.id, {});
    };
    child.stdout.setEncoding('utf8');
    const rl = node_readline_1.default.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
        if (!line.trim())
            return;
        let message;
        try {
            message = JSON.parse(line);
        }
        catch {
            emitter.emit({ type: 'log', level: 'debug', message: line });
            return;
        }
        if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
            const pendingRequest = pending.get(message.id);
            if (!pendingRequest)
                return;
            pending.delete(message.id);
            if (message.error) {
                pendingRequest.reject(new Error(getProtocolErrorMessage(message.error, `${pendingRequest.method} failed`)));
            }
            else {
                pendingRequest.resolve(message.result);
            }
            return;
        }
        if (message.id !== undefined && message.method) {
            handleAgentRequest(message);
        }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
        stderr += chunk;
        if (stderr.length > 8192)
            stderr = stderr.slice(-8192);
    });
    const timeoutMs = request.timeout ?? DEFAULT_ZCODE_PROTOCOL_TIMEOUT_MS;
    let timeoutHandle;
    let abortHandler;
    const timeout = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
            finalStatus = 'timeout';
            finalError = `zcode protocol timed out after ${timeoutMs}ms`;
            try {
                child.kill('SIGTERM');
            }
            catch {
                // Best effort.
            }
            reject(new Error(finalError));
        }, timeoutMs);
    });
    const abort = new Promise((_, reject) => {
        abortHandler = () => {
            finalStatus = 'cancelled';
            finalError = 'zcode protocol execution cancelled';
            try {
                child.kill('SIGTERM');
            }
            catch {
                // Best effort.
            }
            reject(new Error(finalError));
        };
        if (signal.aborted) {
            abortHandler();
            return;
        }
        signal.addEventListener('abort', abortHandler, { once: true });
    });
    const closeSession = async () => {
        if (!sessionId)
            return;
        try {
            await requestProtocol('session/close', { sessionId });
        }
        catch {
            // Best effort.
        }
    };
    const runTurn = async () => {
        const workspacePath = request.cwd ?? process.cwd();
        const createResult = await requestProtocol('session/create', {
            workspace: {
                workspacePath,
                workspaceKey: workspacePath,
            },
            mode: 'yolo',
            persistence: 'deferred',
            runtimeModel,
        });
        sessionId = extractProtocolSessionId(createResult) ?? sessionId;
        let afterSeq = extractProtocolEventSeq(createResult);
        emitter.emit({ type: 'status', status: 'running', sessionId });
        await requestProtocol('session/send', {
            sessionId,
            content: buildZCodePrompt(request),
            runtimeModel,
        });
        const model = readRecord(runtimeModel.model);
        const modelId = (0, jsonProcess_1.getString)(model.modelId) ?? 'zcode';
        while (finalStatus === 'completed') {
            const eventsResult = await requestProtocol('session/events', { sessionId, afterSeq });
            const events = getProtocolEvents(eventsResult);
            if (events.length === 0) {
                await new Promise((resolve) => setTimeout(resolve, 250));
                continue;
            }
            for (const event of events) {
                afterSeq = Math.max(afterSeq, getNumber(event.seq) ?? afterSeq);
                const type = (0, jsonProcess_1.getString)(event.type) ?? '';
                const payload = readRecord(event.payload);
                if (type === 'model.streaming' || type === 'turn.text_delta') {
                    emitTextDelta(String(payload.delta ?? payload.text ?? payload.content ?? ''));
                    continue;
                }
                if (type === 'turn.completed') {
                    emitFinalText(String(payload.response ?? payload.output ?? payload.text ?? ''));
                    addUsageToRecord(usageByModel, modelId, (0, jsonProcess_1.extractUsage)(payload.usage ?? payload.tokenUsage ?? payload.stats));
                    return;
                }
                if (type === 'turn.failed' || type === 'turn.error') {
                    finalStatus = 'failed';
                    finalError = String(payload.message ?? payload.error ?? 'zcode protocol turn failed');
                    emitter.emit({ type: 'error', message: finalError });
                    return;
                }
            }
        }
    };
    try {
        await Promise.race([
            runTurn(),
            timeout,
            abort,
            childError.then((error) => {
                throw error;
            }),
        ]);
    }
    catch (error) {
        if (finalStatus === 'completed')
            finalStatus = 'failed';
        finalError = finalError ?? (0, backend_1.stringifyError)(error);
    }
    finally {
        if (timeoutHandle)
            clearTimeout(timeoutHandle);
        if (abortHandler)
            signal.removeEventListener('abort', abortHandler);
        await closeSession();
        await (0, backend_1.shutdownChildProcess)(child, childExit, {
            terminate: finalStatus !== 'completed',
            graceMs: finalStatus === 'completed' ? 2_000 : 250,
        });
    }
    if (stderr.trim() && finalStatus !== 'completed') {
        finalError = `${finalError ?? 'zcode protocol failed'}\n${stderr.trim().slice(-4096)}`;
    }
    return {
        status: finalStatus,
        output: outputParts.join(''),
        error: finalError,
        providerSessionId: sessionId,
        durationMs: Date.now() - startedAt,
        usage: Object.keys(usageByModel).length ? usageByModel : undefined,
    };
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
            if (processResult.status === 'failed' && isMissingModelConfigError(processResult.error)) {
                const fallbackResult = await runZCodeProtocolFallback(binaryPath, env, request, emitter, signal);
                if (fallbackResult) {
                    return {
                        ...fallbackResult,
                        durationMs: processResult.durationMs + fallbackResult.durationMs,
                    };
                }
            }
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
