"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleConversationRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readOptionalNumber(value) {
    if (value == null || value.trim() === '')
        return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return undefined;
    return Math.floor(parsed);
}
function readLimit(value, fallback = 50) {
    const parsed = readOptionalNumber(value);
    if (!parsed || parsed <= 0)
        return fallback;
    return Math.min(100, Math.max(1, parsed));
}
function sendCommandResult(context, result) {
    context.sendJson(result.ok ? 200 : 400, result);
}
function requireLocal(context) {
    const local = normalizeText(context.url.searchParams.get('local'));
    if (!local) {
        context.sendJson(400, (0, commandResult_1.commandFailed)('missing_local', 'local query parameter is required.'));
        return null;
    }
    return local;
}
function sseEventName(event) {
    const record = event && typeof event === 'object' && !Array.isArray(event)
        ? event
        : {};
    return normalizeText(record.type) || 'conversation-update';
}
async function streamConversationEvents(context, local) {
    const handler = context.handlers.conversations?.streamEvents;
    if (!handler) {
        context.sendJson(501, (0, commandResult_1.commandFailed)('not_implemented', 'Conversation event handler is not configured.'));
        return;
    }
    const { req, res } = context;
    const abortController = new AbortController();
    const stream = await handler({ local, signal: abortController.signal });
    let closed = false;
    req.on('close', () => {
        closed = true;
        abortController.abort();
    });
    res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    for await (const event of stream) {
        if (closed)
            break;
        res.write(`event: ${sseEventName(event)}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    if (!closed)
        res.end();
}
const handleConversationRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname !== '/api/conversations'
        && url.pathname !== '/api/conversations/messages'
        && url.pathname !== '/api/conversations/events') {
        return false;
    }
    if (req.method !== 'GET') {
        context.sendMethodNotAllowed(['GET']);
        return true;
    }
    if (url.pathname === '/api/conversations') {
        const local = requireLocal(context);
        if (!local)
            return true;
        const result = handlers.conversations?.list
            ? await handlers.conversations.list({
                local,
                limit: readLimit(url.searchParams.get('limit')),
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'Conversation list handler is not configured.');
        sendCommandResult(context, result);
        return true;
    }
    if (url.pathname === '/api/conversations/messages') {
        const local = requireLocal(context);
        if (!local)
            return true;
        const peer = normalizeText(url.searchParams.get('peer'));
        if (!peer) {
            context.sendJson(400, (0, commandResult_1.commandFailed)('missing_peer', 'peer query parameter is required.'));
            return true;
        }
        const before = readOptionalNumber(url.searchParams.get('before'));
        const after = readOptionalNumber(url.searchParams.get('after'));
        const result = handlers.conversations?.messages
            ? await handlers.conversations.messages({
                local,
                peer,
                ...(before !== undefined ? { before } : {}),
                ...(after !== undefined ? { after } : {}),
                limit: readLimit(url.searchParams.get('limit')),
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'Conversation messages handler is not configured.');
        sendCommandResult(context, result);
        return true;
    }
    if (url.pathname === '/api/conversations/events') {
        const local = requireLocal(context);
        if (!local)
            return true;
        await streamConversationEvents(context, local);
        return true;
    }
    return false;
};
exports.handleConversationRoutes = handleConversationRoutes;
