"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNodeLoomCommandRunner = createNodeLoomCommandRunner;
const node_child_process_1 = require("node:child_process");
function createNodeLoomCommandRunner() {
    return {
        run(input) {
            const startedAt = Date.now();
            return new Promise((resolve) => {
                const child = (0, node_child_process_1.spawn)(input.command, input.args, {
                    cwd: input.cwd,
                    env: input.env,
                    shell: input.shell ?? false,
                });
                const stdoutChunks = [];
                const stderrChunks = [];
                let settled = false;
                let timedOut = false;
                let timeoutMessage = '';
                let timeout;
                let escalationTimeout;
                const clearTimers = () => {
                    if (timeout) {
                        clearTimeout(timeout);
                        timeout = undefined;
                    }
                    if (escalationTimeout) {
                        clearTimeout(escalationTimeout);
                        escalationTimeout = undefined;
                    }
                };
                const appendStderr = (stderr, suffix) => {
                    if (!suffix) {
                        return stderr;
                    }
                    return stderr && !stderr.endsWith('\n') ? `${stderr}\n${suffix}` : `${stderr}${suffix}`;
                };
                const finish = (exitCode, stderrSuffix = '') => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimers();
                    const stdout = Buffer.concat(stdoutChunks).toString('utf8');
                    let stderr = Buffer.concat(stderrChunks).toString('utf8');
                    stderr = appendStderr(stderr, stderrSuffix);
                    stderr = appendStderr(stderr, timedOut ? timeoutMessage : '');
                    resolve({
                        command: input.command,
                        args: input.args,
                        cwd: input.cwd,
                        exitCode,
                        stdout,
                        stderr,
                        durationMs: Date.now() - startedAt,
                    });
                };
                const timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : undefined;
                timeout = timeoutMs
                    ? setTimeout(() => {
                        timedOut = true;
                        timeoutMessage = `Command timed out after ${timeoutMs}ms.`;
                        child.kill('SIGTERM');
                        escalationTimeout = setTimeout(() => {
                            child.kill('SIGKILL');
                        }, Math.min(timeoutMs, 1000));
                    }, timeoutMs)
                    : undefined;
                child.stdout.on('data', (chunk) => {
                    stdoutChunks.push(chunk);
                });
                child.stderr.on('data', (chunk) => {
                    stderrChunks.push(chunk);
                });
                child.on('error', (error) => {
                    finish(timedOut ? 124 : -1, error.message);
                });
                child.on('close', (code) => {
                    finish(timedOut ? 124 : code ?? -1);
                });
            });
        },
    };
}
