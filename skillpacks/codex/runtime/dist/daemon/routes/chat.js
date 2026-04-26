"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleChatRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readOptionalNumber(value) {
    if (value == null || value.trim() === '')
        return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return undefined;
    return Math.floor(numeric);
}
function sendConversationResult(context, result) {
    if (result.ok && result.state === 'success') {
        const data = result.data && typeof result.data === 'object'
            ? result.data
            : {};
        context.sendJson(200, {
            ok: true,
            ...data,
        });
        return;
    }
    context.sendJson(400, {
        ok: false,
        code: normalizeText(result.code) || 'conversation_failed',
        message: normalizeText(result.message) || 'Failed to load private chat conversation.',
    });
}
const handleChatRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname === '/api/chat/private/conversation') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const peer = normalizeText(url.searchParams.get('peer'));
        if (!peer) {
            context.sendJson(400, {
                ok: false,
                code: 'missing_peer',
                message: 'peer query parameter is required.',
            });
            return true;
        }
        const handler = handlers.chat?.privateConversation;
        if (!handler) {
            context.sendJson(501, {
                ok: false,
                code: 'not_implemented',
                message: 'Private chat conversation handler is not configured.',
            });
            return true;
        }
        const result = await handler({
            peer,
            afterIndex: readOptionalNumber(url.searchParams.get('afterIndex')),
            limit: readOptionalNumber(url.searchParams.get('limit')),
        });
        sendConversationResult(context, result);
        return true;
    }
    if (url.pathname !== '/api/chat/private') {
        return false;
    }
    if (req.method !== 'POST') {
        context.sendMethodNotAllowed(['POST']);
        return true;
    }
    const input = await context.readJsonBody();
    const result = handlers.chat?.private
        ? await handlers.chat.private(input)
        : (0, commandResult_1.commandFailed)('not_implemented', 'Chat private handler is not configured.');
    context.sendJson(200, result);
    return true;
};
exports.handleChatRoutes = handleChatRoutes;
