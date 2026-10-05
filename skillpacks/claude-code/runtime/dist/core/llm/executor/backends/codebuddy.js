"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeBuddyBackendFactory = void 0;
exports.createCodeBuddyBackend = createCodeBuddyBackend;
const node_child_process_1 = require("node:child_process");
const node_readline_1 = __importDefault(require("node:readline"));
const backend_1 = require("./backend");
const jsonProcess_1 = require("./jsonProcess");
const DEFAULT_TIMEOUT_MS = 1_200_000;
/**
 * CodeBuddy's background task system pushes task_notification frames after
 * the backend closes stdin post-result, where nothing can observe them. The
 * CLI documents this variable to disable the background path in headless mode
 * (https://www.codebuddy.ai/docs/cli/headless); it is forced for every spawn,
 * including the WorkBuddy fork which ships the same CLI core.
 */
const CODEBUDDY_DISABLE_BACKGROUND_TASKS_ENV = 'CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS';
function buildCodeBuddyArgs(request) {
    const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'bypassPermissions',
        // AskUserQuestion / EnterPlanMode / ExitPlanMode are exempt from
        // bypassPermissions and stall headless turns waiting for a confirmation
        // nobody can give; one value per flag use because the CLI matches each
        // entry against the tool name exactly (multica GitHub #6012).
        '--disallowedTools',
        'AskUserQuestion',
        'EnterPlanMode',
        'ExitPlanMode',
    ];
    if (request.model) {
        args.push('--model', request.model);
    }
    if (request.maxTurns && request.maxTurns > 0) {
        args.push('--max-turns', String(request.maxTurns));
    }
    if (request.systemPrompt) {
        args.push('--append-system-prompt', request.systemPrompt);
    }
    if (request.resumeSessionId) {
        args.push('--resume', request.resumeSessionId);
    }
    args.push(...(0, backend_1.filterBlockedArgs)(request.extraArgs, {
        '-p': { takesValue: false },
        '--print': { takesValue: false },
        '--output-format': { takesValue: true },
        '--input-format': { takesValue: true },
        '--permission-mode': { takesValue: true },
        '--disallowedTools': { takesValue: true },
        '--dangerously-skip-permissions': { takesValue: false },
        '--system-prompt': { takesValue: true },
        '--append-system-prompt': { takesValue: true },
        '--model': { takesValue: true },
        '--max-turns': { takesValue: true },
        '--resume': { takesValue: true },
        '-r': { takesValue: true },
    }));
    return args;
}
/**
 * Stream-json user message carrying the prompt on stdin, matching the Claude
 * Code input format CodeBuddy implements. Stdin stays open after the write so
 * control_request frames can be answered on the same stream.
 */
function buildCodeBuddyUserMessage(prompt) {
    return {
        type: 'user',
        message: {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
        },
    };
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
function extractCodeBuddyStepUsage(value) {
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
function createCodeBuddyBackend(binaryPath, env) {
    return {
        provider: 'codebuddy',
        async execute(request, emitter, signal) {
            const startedAt = Date.now();
            const args = buildCodeBuddyArgs(request);
            const child = (0, node_child_process_1.spawn)(binaryPath, args, {
                cwd: request.cwd,
                env: {
                    ...(0, backend_1.buildProcessEnv)(env, request.env),
                    [CODEBUDDY_DISABLE_BACKGROUND_TASKS_ENV]: '1',
                },
                shell: false,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdinOpen = true;
            let output = '';
            let resultOutput;
            let stderr = '';
            let sessionId = request.resumeSessionId;
            let status = 'completed';
            let errorMessage;
            const stepUsage = {};
            const resultUsage = {};
            let hasResultUsage = false;
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk) => {
                stderr += chunk;
                if (stderr.length > 4096)
                    stderr = stderr.slice(-4096);
            });
            const childExit = new Promise((resolve) => {
                child.on('close', (code) => resolve(code));
            });
            const childError = new Promise((resolve) => {
                child.once('error', (error) => resolve(error));
            });
            // A CLI that exits before reading its prompt closes the pipe; the exit
            // path reports the failure, so swallow the async EPIPE instead of
            // crashing the daemon.
            child.stdin.on('error', () => {
                stdinOpen = false;
            });
            const writeJsonLine = (message) => {
                if (!stdinOpen || child.stdin.destroyed || child.stdin.writableEnded) {
                    emitter.emit({ type: 'log', level: 'debug', message: 'codebuddy stdin is closed; skipping control response.' });
                    return;
                }
                child.stdin.write(`${JSON.stringify(message)}\n`);
            };
            const closeStdin = () => {
                if (!stdinOpen)
                    return;
                stdinOpen = false;
                try {
                    child.stdin.end();
                }
                catch {
                    // Best effort.
                }
            };
            const stdoutDone = new Promise((resolve) => {
                child.stdout.setEncoding('utf8');
                const rl = node_readline_1.default.createInterface({ input: child.stdout });
                rl.on('line', (rawLine) => {
                    const line = (0, jsonProcess_1.stripStreamPrefix)(rawLine);
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
                    const type = (0, jsonProcess_1.getString)(message.type) ?? '';
                    const subtype = (0, jsonProcess_1.getString)(message.subtype) ?? '';
                    if (type === 'control_request') {
                        const controlRequest = (0, jsonProcess_1.isRecord)(message.request) ? message.request : {};
                        const requestId = typeof message.request_id === 'string' ? message.request_id : '';
                        const input = (0, jsonProcess_1.isRecord)(controlRequest.input) ? controlRequest.input : {};
                        try {
                            writeJsonLine({
                                type: 'control_response',
                                response: {
                                    subtype: 'success',
                                    request_id: requestId,
                                    response: {
                                        behavior: 'allow',
                                        updatedInput: input,
                                    },
                                },
                            });
                        }
                        catch (error) {
                            status = 'failed';
                            errorMessage = (0, backend_1.stringifyError)(error);
                            emitter.emit({ type: 'error', message: errorMessage });
                        }
                        return;
                    }
                    if (type === 'system/init' || (type === 'system' && subtype === 'init')) {
                        sessionId = (0, jsonProcess_1.getString)(message.session_id) ?? (0, jsonProcess_1.getString)(message.sessionId) ?? sessionId;
                        emitter.emit({ type: 'status', status: 'running', sessionId });
                        return;
                    }
                    if (type === 'system/error' || (type === 'system' && subtype === 'error') || type === 'error') {
                        status = 'failed';
                        errorMessage = String(message.message ?? message.error ?? message.detail ?? 'codebuddy error');
                        emitter.emit({ type: 'error', message: errorMessage });
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
                    if (type === 'user') {
                        // Claude-style tool_result frames: CodeBuddy is a Claude Code fork
                        // and reports tool outcomes through user messages.
                        const userMessage = (0, jsonProcess_1.isRecord)(message.message) ? message.message : {};
                        const content = Array.isArray(userMessage.content) ? userMessage.content : [];
                        for (const block of content) {
                            if (!(0, jsonProcess_1.isRecord)(block) || block.type !== 'tool_result')
                                continue;
                            emitter.emit({
                                type: 'tool_result',
                                callId: String(block.tool_use_id ?? block.id ?? 'tool'),
                                output: (0, jsonProcess_1.stringifyContent)(block.content),
                            });
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
                        const model = (0, jsonProcess_1.getString)(message.model) ?? 'codebuddy';
                        addUsageToRecord(stepUsage, model, extractCodeBuddyStepUsage(part.tokens ?? part.usage ?? message.usage));
                        return;
                    }
                    if (type === 'result' || (type === 'system' && subtype === 'result')) {
                        sessionId = (0, jsonProcess_1.getString)(message.session_id) ?? (0, jsonProcess_1.getString)(message.sessionId) ?? sessionId;
                        const candidateOutput = typeof message.result === 'string'
                            ? message.result
                            : (0, jsonProcess_1.stringifyContent)(message.output ?? message.text);
                        if (!output)
                            resultOutput = candidateOutput;
                        const model = (0, jsonProcess_1.getString)(message.model) ?? 'codebuddy';
                        hasResultUsage = addUsageToRecord(resultUsage, model, (0, jsonProcess_1.extractUsage)(message.usage ?? message.stats)) || hasResultUsage;
                        if (message.is_error === true || message.status === 'error' || message.subtype === 'error') {
                            status = 'failed';
                            errorMessage = candidateOutput || String(message.error ?? message.detail ?? 'codebuddy result failed');
                        }
                        closeStdin();
                        return;
                    }
                });
                rl.on('close', () => resolve());
            });
            const timeoutMs = request.timeout ?? DEFAULT_TIMEOUT_MS;
            let timeoutHandle;
            const timeout = new Promise((resolve) => {
                timeoutHandle = setTimeout(() => {
                    status = 'timeout';
                    errorMessage = `codebuddy timed out after ${timeoutMs}ms`;
                    try {
                        child.kill('SIGTERM');
                    }
                    catch {
                        // Best effort.
                    }
                    resolve();
                }, timeoutMs);
            });
            const abort = new Promise((resolve) => {
                if (signal.aborted) {
                    status = 'cancelled';
                    errorMessage = 'codebuddy execution cancelled';
                    resolve();
                    return;
                }
                signal.addEventListener('abort', () => {
                    status = 'cancelled';
                    errorMessage = 'codebuddy execution cancelled';
                    try {
                        child.kill('SIGTERM');
                    }
                    catch {
                        // Best effort.
                    }
                    resolve();
                }, { once: true });
            });
            try {
                writeJsonLine(buildCodeBuddyUserMessage(request.prompt));
                const completion = await Promise.race([
                    Promise.all([stdoutDone, childExit]).then(([, exitCode]) => ({ type: 'exit', exitCode })),
                    timeout.then(() => ({ type: 'terminal' })),
                    abort.then(() => ({ type: 'terminal' })),
                    childError.then((error) => ({ type: 'error', error })),
                ]);
                if (completion.type === 'error') {
                    status = 'failed';
                    errorMessage = (0, backend_1.stringifyError)(completion.error);
                }
                else if (completion.type === 'exit' && completion.exitCode !== 0 && status === 'completed') {
                    status = 'failed';
                    errorMessage = `codebuddy exited with code ${completion.exitCode ?? 'unknown'}`;
                }
            }
            catch (error) {
                if (status === 'completed') {
                    status = 'failed';
                    errorMessage = (0, backend_1.stringifyError)(error);
                }
            }
            finally {
                if (timeoutHandle)
                    clearTimeout(timeoutHandle);
                closeStdin();
                await (0, backend_1.shutdownChildProcess)(child, childExit, {
                    terminate: status !== 'completed',
                    graceMs: status === 'completed' ? 2_000 : 250,
                });
            }
            if (stderr.trim() && status !== 'completed') {
                errorMessage = `${errorMessage ?? 'codebuddy failed'}\n${stderr.trim()}`;
            }
            const usage = hasResultUsage ? resultUsage : stepUsage;
            return {
                status,
                output: resultOutput || output,
                error: errorMessage,
                providerSessionId: sessionId,
                durationMs: Date.now() - startedAt,
                usage: Object.keys(usage).length ? usage : undefined,
            };
        },
    };
}
exports.codeBuddyBackendFactory = createCodeBuddyBackend;
