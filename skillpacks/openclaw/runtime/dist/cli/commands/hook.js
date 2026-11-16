"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHookCommand = runHookCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const hooks_1 = require("../../core/sessions/hooks");
const STDIN_READ_LIMIT_MS = 3_000;
const HOOK_TIMEOUT_MS = 8_000;
const HOOK_PAYLOAD_MAX_BYTES = 512 * 1024;
const VALID_EVENTS = [
    'session-start',
    'user-prompt-submit',
    'post-tool-use',
    'stop',
    'session-end',
    'status',
];
function readStdinBounded(stdin, limitMs) {
    return new Promise((resolve) => {
        const chunks = [];
        let total = 0;
        let settled = false;
        const finish = (value) => {
            if (!settled) {
                settled = true;
                resolve(value);
            }
        };
        const timer = setTimeout(() => finish(Buffer.concat(chunks).toString('utf8')), limitMs);
        stdin.on('data', (chunk) => {
            total += chunk.length;
            if (total <= HOOK_PAYLOAD_MAX_BYTES) {
                chunks.push(chunk);
            }
        });
        stdin.on('end', () => {
            clearTimeout(timer);
            finish(Buffer.concat(chunks).toString('utf8'));
        });
        stdin.on('error', () => {
            clearTimeout(timer);
            finish(Buffer.concat(chunks).toString('utf8'));
        });
    });
}
/**
 * `metabot hook <event>` — the turn-tier hook handler (local session
 * adapters P4a), installed into host hook configs by `metabot sessions
 * wire`. Registers/refreshes the session from the hook payload and, on a
 * mail-taking event, prints the framed inbox mail as the host's
 * additionalContext dialect. Hooks must NEVER break their host: every
 * failure exits 0 silently, and the whole run is bounded.
 */
async function runHookCommand(args, context) {
    const event = args[0];
    const agentArg = (() => {
        const index = args.indexOf('--agent');
        return index >= 0 ? args[index + 1] : undefined;
    })();
    if (!event || !VALID_EVENTS.includes(event)) {
        // Unknown event: stay silent so a misconfigured hook never spams a host.
        return Object.assign((0, commandResult_1.commandSuccess)({ handled: false, reason: 'unknown_event' }), { __rawStdoutHandled: true });
    }
    const sessions = context.dependencies.sessions;
    if (!sessions?.register || !sessions?.inboxCheck) {
        return Object.assign((0, commandResult_1.commandSuccess)({ handled: false, reason: 'not_implemented' }), { __rawStdoutHandled: true });
    }
    const rawPayload = await readStdinBounded(context.stdin, STDIN_READ_LIMIT_MS);
    let payload = null;
    const trimmed = rawPayload.trim().replace(/^\uFEFF/, '');
    if (trimmed) {
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                payload = parsed;
            }
        }
        catch {
            payload = null;
        }
    }
    const result = await Promise.race([
        (0, hooks_1.runHook)({
            agent: agentArg ?? '',
            event: event,
            payload,
            env: context.env,
            pid: process.pid,
            backend: {
                registerSession: async (input) => await sessions.register(input),
                inboxCheck: async (hookInput) => await sessions.inboxCheck(hookInput),
            },
        }),
        new Promise((resolve) => setTimeout(() => resolve(null), HOOK_TIMEOUT_MS)),
    ]).catch(() => null);
    if (result) {
        // Printed means delivered: the host has the mail in front of the model.
        context.stdout.write(`${result.output}\n`);
    }
    return Object.assign((0, commandResult_1.commandSuccess)({ handled: Boolean(result), sessionKey: result?.sessionKey ?? null, mailIds: result?.mailIds ?? [] }), { __rawStdoutHandled: true });
}
