"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.traeBackendFactory = void 0;
exports.createTraeBackend = createTraeBackend;
const node_child_process_1 = require("node:child_process");
const node_readline_1 = __importDefault(require("node:readline"));
const backend_1 = require("./backend");
function buildTraeArgs(request) {
    const args = ['chat', request.prompt, '--mode', 'agent', '--reuse-window'];
    args.push(...(0, backend_1.filterBlockedArgs)(request.extraArgs, {
        '-m': { takesValue: true },
        '--mode': { takesValue: true },
        '-r': { takesValue: false },
        '--reuse-window': { takesValue: false },
        '-n': { takesValue: false },
        '--new-window': { takesValue: false },
    }));
    return args;
}
function createTraeBackend(binaryPath, env) {
    return {
        provider: 'trae',
        async execute(request, emitter, signal) {
            const startedAt = Date.now();
            const child = (0, node_child_process_1.spawn)(binaryPath, buildTraeArgs(request), {
                cwd: request.cwd,
                env: (0, backend_1.buildProcessEnv)(env, request.env),
                shell: false,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let output = '';
            let stderrTail = '';
            let status = 'completed';
            let errorMessage;
            const childExit = new Promise((resolve) => {
                child.on('close', (code) => resolve(code));
            });
            const childError = new Promise((resolve) => {
                child.once('error', (error) => resolve(error));
            });
            const stdoutDone = new Promise((resolve) => {
                child.stdout.setEncoding('utf8');
                const rl = node_readline_1.default.createInterface({ input: child.stdout });
                rl.on('line', (line) => {
                    const text = line.trimEnd();
                    if (!text)
                        return;
                    output += output ? `\n${text}` : text;
                    emitter.emit({ type: 'text', content: text });
                });
                rl.on('close', () => resolve());
            });
            const stderrDone = new Promise((resolve) => {
                child.stderr.setEncoding('utf8');
                const rl = node_readline_1.default.createInterface({ input: child.stderr });
                rl.on('line', (line) => {
                    const text = line.trimEnd();
                    if (!text)
                        return;
                    stderrTail += `${text}\n`;
                    if (stderrTail.length > 4096)
                        stderrTail = stderrTail.slice(-4096);
                    emitter.emit({ type: 'log', level: 'error', message: text });
                });
                rl.on('close', () => resolve());
            });
            const timeoutMs = request.timeout ?? 1_200_000;
            let timeoutHandle;
            const timeout = new Promise((resolve) => {
                timeoutHandle = setTimeout(() => {
                    status = 'timeout';
                    errorMessage = `trae timed out after ${timeoutMs}ms`;
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
                    errorMessage = 'trae execution cancelled';
                    resolve();
                    return;
                }
                signal.addEventListener('abort', () => {
                    status = 'cancelled';
                    errorMessage = 'trae execution cancelled';
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
                const completion = await Promise.race([
                    Promise.all([stdoutDone, stderrDone, childExit]).then(([, , code]) => ({ type: 'exit', code })),
                    timeout.then(() => ({ type: 'terminal' })),
                    abort.then(() => ({ type: 'terminal' })),
                    childError.then((error) => ({ type: 'error', error })),
                ]);
                if (completion.type === 'error') {
                    status = 'failed';
                    errorMessage = (0, backend_1.stringifyError)(completion.error);
                }
                else if (completion.type === 'exit' && completion.code !== 0 && status === 'completed') {
                    status = 'failed';
                    errorMessage = `trae exited with code ${completion.code ?? 'unknown'}`;
                }
            }
            finally {
                if (timeoutHandle)
                    clearTimeout(timeoutHandle);
                await (0, backend_1.shutdownChildProcess)(child, childExit, {
                    terminate: status !== 'completed',
                    graceMs: status === 'completed' ? 2_000 : 250,
                });
            }
            if (status === 'completed' && !output.trim()) {
                status = 'failed';
                errorMessage = 'trae chat exited without returning text output. The installed Trae CLI may have opened the editor chat UI instead of providing a non-interactive response.';
            }
            if (stderrTail.trim() && status !== 'completed') {
                errorMessage = `${errorMessage ?? 'trae failed'}\n${stderrTail.trim()}`;
            }
            return {
                status,
                output,
                error: errorMessage,
                durationMs: Date.now() - startedAt,
            };
        },
    };
}
exports.traeBackendFactory = createTraeBackend;
