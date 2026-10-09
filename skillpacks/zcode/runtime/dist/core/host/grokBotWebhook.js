"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROK_BOT_WEBHOOK_TIMEOUT_MS = void 0;
exports.postGrokBotWebhook = postGrokBotWebhook;
exports.deliverGrokBotPrivateChat = deliverGrokBotPrivateChat;
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const grokBotBinding_1 = require("./grokBotBinding");
exports.GROK_BOT_WEBHOOK_TIMEOUT_MS = 15_000;
function toIsoTimestamp(timestamp) {
    // Chain timestamps have appeared in both seconds and milliseconds.
    const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
    return new Date(ms).toISOString();
}
function buildPrivateChatPayload(input) {
    const slug = node_path_1.default.basename((0, paths_1.resolveMetabotPaths)(input.homeDir).profileRoot);
    return {
        type: 'metaweb-private-chat',
        host: 'grok-bot',
        slug,
        fromGlobalMetaId: input.message.fromGlobalMetaId,
        text: input.message.content,
        contentType: input.message.contentType ?? 'text',
        messageId: input.message.messagePinId,
        receivedAt: toIsoTimestamp(input.message.timestamp),
    };
}
async function postGrokBotWebhook(input) {
    const webhook = input.binding.webhook;
    if (!webhook) {
        return { ok: false, error: 'webhook not configured' };
    }
    const headers = { 'content-type': 'application/json' };
    if (webhook.secret) {
        headers.authorization = `Bearer ${webhook.secret}`;
    }
    let response;
    try {
        response = await input.fetchImpl(webhook.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(input.payload),
            signal: AbortSignal.timeout(input.timeoutMs),
            redirect: 'error',
        });
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    // A 2xx only means the Grok Bot routine started a turn, per the platform's
    // webhook semantics; the reply itself lands on-chain later, if the user
    // approves it. Non-2xx is a real delivery failure.
    if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
    }
    return { ok: true };
}
/**
 * Deliver one inbound on-chain private-chat message to the Grok Bot assistant
 * bound to this profile, through the routine webhook recorded in the profile's
 * binding. Returns 'not_configured' when no webhook exists (the caller should
 * fall back to the normal local reply path); a single attempt is made
 * otherwise and the outcome is recorded on the binding ledger — no retries.
 */
async function deliverGrokBotPrivateChat(input) {
    const filePath = (0, grokBotBinding_1.grokBotBindingPathForProfile)(input.homeDir);
    const binding = await (0, grokBotBinding_1.readGrokBotBinding)(filePath);
    if (!binding.webhook) {
        return 'not_configured';
    }
    const now = input.now ?? (() => new Date());
    const result = await postGrokBotWebhook({
        binding,
        payload: buildPrivateChatPayload(input),
        fetchImpl: input.fetchImpl ?? fetch,
        timeoutMs: input.timeoutMs ?? exports.GROK_BOT_WEBHOOK_TIMEOUT_MS,
    });
    await (0, grokBotBinding_1.recordGrokBotWebhookDelivery)(filePath, {
        at: now().toISOString(),
        status: result.ok ? 'ok' : 'failed',
        kind: 'private-chat',
        error: result.ok ? null : result.error,
    });
    return result.ok ? 'delivered' : 'failed';
}
