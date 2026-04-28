"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pollTraceUntilComplete = pollTraceUntilComplete;
const CLI_POLL_TIMEOUT_MS = 300_000;
const CLI_POLL_INTERVAL_MS = 3_000;
function extractPublicStatus(result) {
    if (typeof result === 'object' && result !== null &&
        'ok' in result && result.ok === true &&
        'data' in result) {
        const data = result.data;
        if (typeof data === 'object' && data !== null && 'sessions' in data) {
            const sessions = data.sessions;
            if (Array.isArray(sessions) && sessions.length > 0) {
                const first = sessions[0];
                if (typeof first === 'object' && first !== null && 'publicStatus' in first) {
                    return String(first.publicStatus);
                }
            }
        }
    }
    return null;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function pollTraceUntilComplete(input) {
    const timeoutMs = input.timeoutMs ?? CLI_POLL_TIMEOUT_MS;
    const intervalMs = input.intervalMs ?? CLI_POLL_INTERVAL_MS;
    const tracePath = `/api/trace/${encodeURIComponent(input.traceId)}`;
    input.stderr.write(`Waiting for response...\n`);
    input.stderr.write(`Track progress: ${input.localUiUrl}\n`);
    const deadline = Date.now() + timeoutMs;
    let lastStatus = null;
    let consecutiveErrors = 0;
    while (Date.now() < deadline) {
        try {
            const result = await input.requestFn('GET', tracePath);
            consecutiveErrors = 0;
            const status = extractPublicStatus(result);
            if (status && status !== lastStatus) {
                lastStatus = status;
                if (status !== 'requesting_remote') {
                    input.stderr.write(`Status: ${status}\n`);
                }
            }
            if (status === 'completed') {
                const data = result.data;
                input.stderr.write(`Response received. View full trace: ${input.localUiUrl}\n`);
                return { completed: true, trace: data };
            }
        }
        catch {
            consecutiveErrors++;
            if (consecutiveErrors > 10) {
                input.stderr.write(`Unable to reach daemon. View trace in browser: ${input.localUiUrl}\n`);
                return { completed: false };
            }
        }
        await sleep(intervalMs);
    }
    input.stderr.write(`Provider has not responded yet. Continue tracking: ${input.localUiUrl}\n`);
    return { completed: false };
}
