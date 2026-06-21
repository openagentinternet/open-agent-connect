"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PROCESS_TIMEOUT_MS = void 0;
exports.isRecord = isRecord;
exports.getString = getString;
exports.numberFromKeys = numberFromKeys;
exports.extractUsage = extractUsage;
exports.addUsage = addUsage;
exports.usageRecordHasTokens = usageRecordHasTokens;
exports.resolveJsonProcessError = resolveJsonProcessError;
exports.stringifyContent = stringifyContent;
exports.hasArg = hasArg;
exports.runJsonLineProcess = runJsonLineProcess;
const node_child_process_1 = require("node:child_process");
const node_readline_1 = __importDefault(require("node:readline"));
const backend_1 = require("./backend");
exports.DEFAULT_PROCESS_TIMEOUT_MS = 1_200_000;
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function getString(value) {
    return typeof value === 'string' ? value : undefined;
}
function numberFromKeys(source, keys) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
    }
    return 0;
}
function extractUsage(value) {
    if (!isRecord(value))
        return undefined;
    const cache = isRecord(value.cache) ? value.cache : {};
    const usage = {
        inputTokens: numberFromKeys(value, ['inputTokens', 'input_tokens', 'input', 'prompt_tokens']),
        outputTokens: numberFromKeys(value, ['outputTokens', 'output_tokens', 'output', 'completion_tokens']),
        cacheReadTokens: numberFromKeys(cache, ['read']) || numberFromKeys(value, ['cacheReadTokens', 'cacheRead', 'cache_read_tokens', 'cache_read_input_tokens', 'cache_read', 'cached_input_tokens', 'cachedInputTokens', 'cached']) || undefined,
        cacheWriteTokens: numberFromKeys(cache, ['write']) || numberFromKeys(value, ['cacheWriteTokens', 'cacheWrite', 'cacheCreationInputTokens', 'cache_write_tokens', 'cache_write_input_tokens', 'cache_creation_input_tokens', 'cache_write']) || undefined,
    };
    return usage.inputTokens || usage.outputTokens || usage.cacheReadTokens || usage.cacheWriteTokens
        ? usage
        : undefined;
}
function addUsage(target, value) {
    const usage = extractUsage(value);
    if (!usage)
        return;
    target.inputTokens += usage.inputTokens;
    target.outputTokens += usage.outputTokens;
    if (usage.cacheReadTokens)
        target.cacheReadTokens = (target.cacheReadTokens ?? 0) + usage.cacheReadTokens;
    if (usage.cacheWriteTokens)
        target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + usage.cacheWriteTokens;
}
function usageRecordHasTokens(usage) {
    return Boolean(usage.inputTokens || usage.outputTokens || usage.cacheReadTokens || usage.cacheWriteTokens);
}
function resolveJsonProcessError(processResult, protocolStatus, protocolError) {
    if (protocolError && protocolStatus === 'failed' && processResult.status !== 'timeout' && processResult.status !== 'cancelled') {
        return protocolError;
    }
    return processResult.error ?? protocolError;
}
function stringifyContent(value) {
    if (typeof value === 'string')
        return value;
    if (value === undefined || value === null)
        return '';
    if (Array.isArray(value)) {
        return value.map((entry) => {
            if (typeof entry === 'string')
                return entry;
            if (isRecord(entry) && typeof entry.text === 'string')
                return entry.text;
            return JSON.stringify(entry);
        }).join('');
    }
    return JSON.stringify(value);
}
function hasArg(args, flag) {
    return Boolean(args?.some((arg) => arg === flag || arg.startsWith(`${flag}=`)));
}
function stripStreamPrefix(line) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('stdout:'))
        return trimmed.slice('stdout:'.length).trimStart();
    if (trimmed.startsWith('stderr:'))
        return trimmed.slice('stderr:'.length).trimStart();
    return line;
}
async function runJsonLineProcess(input) {
    const startedAt = Date.now();
    const child = (0, node_child_process_1.spawn)(input.binaryPath, input.args, {
        cwd: input.cwd,
        env: (0, backend_1.buildProcessEnv)(input.env, input.requestEnv),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let finalStatus = 'completed';
    let finalError;
    let stderrTail = '';
    const childExit = new Promise((resolve) => {
        child.on('close', (code) => resolve(code));
    });
    const childError = new Promise((resolve) => {
        child.once('error', (error) => resolve(error));
    });
    const consumeStream = (stream, streamName) => new Promise((resolve) => {
        const parseJson = input.jsonStreams.includes(streamName);
        stream.setEncoding('utf8');
        const rl = node_readline_1.default.createInterface({ input: stream });
        rl.on('line', (rawLine) => {
            const line = input.normalizeStreamPrefixes ? stripStreamPrefix(rawLine) : rawLine;
            if (streamName === 'stderr' && !parseJson) {
                stderrTail += `${line}\n`;
                if (stderrTail.length > 4096)
                    stderrTail = stderrTail.slice(-4096);
            }
            if (!line.trim())
                return;
            if (!parseJson) {
                input.emitter.emit({ type: 'log', level: streamName === 'stderr' ? 'error' : 'debug', message: line });
                return;
            }
            try {
                input.onJson(JSON.parse(line), streamName);
            }
            catch (error) {
                if (error instanceof SyntaxError) {
                    input.onNonJsonLine?.(line, streamName);
                    input.emitter.emit({ type: 'log', level: 'debug', message: line });
                    return;
                }
                finalStatus = 'failed';
                finalError = (0, backend_1.stringifyError)(error);
                input.emitter.emit({ type: 'error', message: finalError });
            }
        });
        rl.on('close', () => resolve());
    });
    const stdoutDone = consumeStream(child.stdout, 'stdout');
    const stderrDone = consumeStream(child.stderr, 'stderr');
    const timeoutMs = input.timeoutMs ?? exports.DEFAULT_PROCESS_TIMEOUT_MS;
    let timeoutHandle;
    const timeout = new Promise((resolve) => {
        timeoutHandle = setTimeout(() => {
            finalStatus = 'timeout';
            finalError = `${input.label} timed out after ${timeoutMs}ms`;
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
        if (input.signal.aborted) {
            finalStatus = 'cancelled';
            finalError = `${input.label} execution cancelled`;
            resolve();
            return;
        }
        input.signal.addEventListener('abort', () => {
            finalStatus = 'cancelled';
            finalError = `${input.label} execution cancelled`;
            try {
                child.kill('SIGTERM');
            }
            catch {
                // Best effort.
            }
            resolve();
        }, { once: true });
    });
    let exitCode = null;
    try {
        const completion = await Promise.race([
            Promise.all([stdoutDone, stderrDone, childExit]).then(([, , code]) => ({ type: 'exit', code })),
            timeout.then(() => ({ type: 'terminal' })),
            abort.then(() => ({ type: 'terminal' })),
            childError.then((error) => ({ type: 'error', error })),
        ]);
        if (completion.type === 'error') {
            finalStatus = 'failed';
            finalError = (0, backend_1.stringifyError)(completion.error);
        }
        else if (completion.type === 'exit') {
            exitCode = completion.code;
            if (completion.code !== 0 && finalStatus === 'completed') {
                finalStatus = 'failed';
                finalError = `${input.label} exited with code ${completion.code ?? 'unknown'}`;
            }
        }
    }
    finally {
        if (timeoutHandle)
            clearTimeout(timeoutHandle);
        await (0, backend_1.shutdownChildProcess)(child, childExit, {
            terminate: finalStatus !== 'completed',
            graceMs: finalStatus === 'completed' ? 2_000 : 250,
        });
    }
    if (stderrTail.trim() && finalStatus !== 'completed') {
        finalError = `${finalError ?? `${input.label} failed`}\n${stderrTail.trim()}`;
    }
    return {
        status: finalStatus,
        error: finalError,
        durationMs: Date.now() - startedAt,
        exitCode,
    };
}
