"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROK_BOT_LLM_TASK_POLL_INTERVAL_MS = exports.GROK_BOT_LLM_TASK_TIMEOUT_MS = void 0;
exports.createGrokBotWebhookCompletion = createGrokBotWebhookCompletion;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const grokBotBinding_1 = require("./grokBotBinding");
const grokBotWebhook_1 = require("./grokBotWebhook");
exports.GROK_BOT_LLM_TASK_TIMEOUT_MS = 10 * 60_000;
exports.GROK_BOT_LLM_TASK_POLL_INTERVAL_MS = 5_000;
/**
 * Passive-LLM channel for Grok Bot-bound profiles. Grok Bot exposes no local
 * LLM endpoint OAC can call, so a generation becomes a structured task: the
 * daemon POSTs an `llm-task` envelope to the assistant's routine webhook (the
 * same channel as private-chat delivery), and the assistant answers by
 * writing `<taskId>.response.json` next to the request file under
 * `.runtime/state/grok-bot-llm-tasks/`. One POST, bounded polling, no
 * retries; any failure returns null so the caller falls through its normal
 * chain unchanged.
 */
function createGrokBotWebhookCompletion(options) {
    const logWarning = options.logWarning ?? (() => undefined);
    return async (request) => {
        const paths = (0, paths_1.resolveMetabotPaths)(options.homeDir);
        const bindingPath = (0, grokBotBinding_1.grokBotBindingPathForProfile)(options.homeDir);
        let binding;
        try {
            binding = await (0, grokBotBinding_1.readGrokBotBinding)(bindingPath);
        }
        catch (error) {
            logWarning('[grok-bot llm task]', `binding unreadable: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
        if (!binding.webhook) {
            return null;
        }
        const now = options.now ?? (() => new Date());
        const taskId = (options.createTaskId ?? node_crypto_1.randomUUID)();
        const tasksRoot = paths.grokBotLlmTasksRoot;
        const requestPath = node_path_1.default.join(tasksRoot, `${taskId}.request.json`);
        const responsePath = node_path_1.default.join(tasksRoot, `${taskId}.response.json`);
        const slug = node_path_1.default.basename(paths.profileRoot);
        const createdAt = now().toISOString();
        const cleanup = async () => {
            await node_fs_1.promises.rm(requestPath, { force: true }).catch(() => undefined);
            await node_fs_1.promises.rm(responsePath, { force: true }).catch(() => undefined);
        };
        try {
            await node_fs_1.promises.mkdir(tasksRoot, { recursive: true });
            await node_fs_1.promises.writeFile(requestPath, `${JSON.stringify({
                taskId,
                type: 'llm-task',
                host: 'grok-bot',
                slug,
                system: request.system,
                prompt: request.user,
                createdAt,
            }, null, 2)}\n`, 'utf8');
            const posted = await (0, grokBotWebhook_1.postGrokBotWebhook)({
                binding,
                payload: {
                    type: 'llm-task',
                    host: 'grok-bot',
                    slug,
                    taskId,
                    system: request.system,
                    prompt: request.user,
                    responsePath,
                    createdAt,
                },
                fetchImpl: options.fetchImpl ?? fetch,
                timeoutMs: 15_000,
            });
            await (0, grokBotBinding_1.recordGrokBotWebhookDelivery)(bindingPath, {
                at: now().toISOString(),
                status: posted.ok ? 'ok' : 'failed',
                kind: 'llm-task',
                error: posted.ok ? null : posted.error,
            });
            if (!posted.ok) {
                logWarning('[grok-bot llm task]', `webhook POST failed: ${posted.error}`);
                await cleanup();
                return null;
            }
            const timeoutMs = options.timeoutMs ?? exports.GROK_BOT_LLM_TASK_TIMEOUT_MS;
            const pollIntervalMs = options.pollIntervalMs ?? exports.GROK_BOT_LLM_TASK_POLL_INTERVAL_MS;
            const deadlineMs = Date.now() + timeoutMs;
            while (Date.now() < deadlineMs) {
                let raw = null;
                try {
                    raw = await node_fs_1.promises.readFile(responsePath, 'utf8');
                }
                catch {
                    raw = null;
                }
                if (raw !== null) {
                    let response = null;
                    try {
                        const parsed = JSON.parse(raw);
                        if (parsed && parsed.taskId === taskId && (parsed.status === 'ok' || parsed.status === 'failed')) {
                            response = parsed;
                        }
                    }
                    catch {
                        response = null;
                    }
                    if (response) {
                        await cleanup();
                        if (response.status === 'ok' && typeof response.output === 'string' && response.output.trim()) {
                            return response.output;
                        }
                        logWarning('[grok-bot llm task]', response.error ?? 'task failed without an error message');
                        return null;
                    }
                    // A file with the right name but unparsable content is still being
                    // written; keep polling until the deadline.
                }
                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            }
            logWarning('[grok-bot llm task]', `timed out after ${timeoutMs}ms waiting for ${responsePath}`);
            await cleanup();
            return null;
        }
        catch (error) {
            logWarning('[grok-bot llm task]', error instanceof Error ? error.message : String(error));
            await cleanup();
            return null;
        }
    };
}
