"use strict";
/**
 * Codex push adapter (local session adapters P3).
 *
 * Hands the framed message to the official `codex queue --thread <id>
 * --message <text>` — the delivery path that works for live and offline
 * threads alike: on a resumed thread the queued message starts the turn.
 * A missing binary or a rejected queue is a failed push; the router falls
 * back to the mail queue (the session sees the message at its next
 * check_inbox). Runs with the session's CODEX_HOME when one is known.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushToCodexQueue = pushToCodexQueue;
const node_child_process_1 = require("node:child_process");
const QUEUE_TIMEOUT_MS = 15_000;
function defaultRun(file, args, options) {
    return new Promise((resolve, reject) => {
        (0, node_child_process_1.execFile)(file, args, options, (error) => {
            if (error) {
                reject(error);
            }
            else {
                resolve();
            }
        });
    });
}
async function pushToCodexQueue(input) {
    const run = input.run ?? defaultRun;
    const env = input.codexHome
        ? { ...process.env, CODEX_HOME: input.codexHome }
        : { ...process.env };
    await run(input.codexBin ?? 'codex', ['queue', '--thread', input.threadId, '--message', input.framedText], { timeout: QUEUE_TIMEOUT_MS, env });
}
