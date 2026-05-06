"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterBlockedArgs = filterBlockedArgs;
exports.buildProcessEnv = buildProcessEnv;
exports.stringifyError = stringifyError;
exports.shutdownChildProcess = shutdownChildProcess;
const DEFAULT_SHUTDOWN_GRACE_MS = 250;
const DEFAULT_SHUTDOWN_KILL_WAIT_MS = 1_000;
function filterBlockedArgs(args, blocked) {
    if (!args || args.length === 0)
        return [];
    const filtered = [];
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        const eqIndex = arg.indexOf('=');
        const key = eqIndex >= 0 ? arg.slice(0, eqIndex) : arg;
        const spec = blocked[key];
        if (!spec) {
            filtered.push(arg);
            continue;
        }
        if (spec.takesValue && eqIndex < 0 && i + 1 < args.length) {
            i += 1;
        }
    }
    return filtered;
}
function buildProcessEnv(baseEnv, requestEnv) {
    return {
        ...process.env,
        ...(baseEnv ?? {}),
        ...(requestEnv ?? {}),
    };
}
function stringifyError(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === 'string')
        return error;
    return JSON.stringify(error);
}
function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
function isChildRunning(child) {
    return child.exitCode === null && child.signalCode === null;
}
async function shutdownChildProcess(child, childExit, options = {}) {
    const graceMs = options.graceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
    const killWaitMs = options.killWaitMs ?? DEFAULT_SHUTDOWN_KILL_WAIT_MS;
    if (options.terminate && isChildRunning(child)) {
        try {
            child.kill('SIGTERM');
        }
        catch {
            // Best effort.
        }
    }
    const exitedDuringGrace = await Promise.race([
        childExit.then(() => true),
        delay(graceMs).then(() => false),
    ]);
    if (exitedDuringGrace)
        return;
    if (isChildRunning(child)) {
        try {
            child.kill('SIGKILL');
        }
        catch {
            // Best effort.
        }
    }
    await Promise.race([
        childExit,
        delay(killWaitMs),
    ]);
}
