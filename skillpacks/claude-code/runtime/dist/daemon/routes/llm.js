"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleLlmRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const executor_1 = require("../../core/llm/executor");
function normalizeLimit(value) {
    const parsed = value ? Number.parseInt(value, 10) : 20;
    if (!Number.isFinite(parsed) || parsed <= 0)
        return 20;
    return Math.min(100, Math.max(1, parsed));
}
function acceptsSse(header) {
    return (header ?? '').toLowerCase().includes('text/event-stream');
}
function decodeSafeSessionId(segment) {
    let sessionId;
    try {
        sessionId = decodeURIComponent(segment);
    }
    catch {
        return null;
    }
    return (0, executor_1.isSafeLlmSessionId)(sessionId) ? sessionId : null;
}
function sendInvalidSessionId(context) {
    context.sendJson(400, (0, commandResult_1.commandFailed)('invalid_llm_session_id', 'Invalid LLM session id.'));
}
async function streamEventsAsSse(context, sessionId) {
    const stream = context.handlers.llm?.streamSessionEvents
        ? await context.handlers.llm.streamSessionEvents({ sessionId })
        : null;
    if (!stream) {
        context.sendJson(404, (0, commandResult_1.commandFailed)('llm_session_stream_not_found', `LLM session stream not found: ${sessionId}`));
        return;
    }
    const { req, res } = context;
    let closed = false;
    req.on('close', () => {
        closed = true;
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
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    if (!closed)
        res.end();
}
const handleLlmRoutes = async (context) => {
    const { req, url, handlers } = context;
    // POST /api/llm/execute
    if (url.pathname === '/api/llm/execute' && req.method === 'POST') {
        const body = await context.readJsonBody();
        const result = handlers.llm?.execute
            ? await handlers.llm.execute(body)
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM execute handler not configured.');
        context.sendJson(result.ok ? 202 : 400, result);
        return true;
    }
    // GET /api/llm/sessions
    if (url.pathname === '/api/llm/sessions' && req.method === 'GET') {
        const limit = normalizeLimit(url.searchParams.get('limit'));
        const result = handlers.llm?.listSessions
            ? await handlers.llm.listSessions({ limit })
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM session list handler not configured.');
        context.sendJson(200, result);
        return true;
    }
    // POST /api/llm/sessions/:id/cancel
    const sessionCancelMatch = url.pathname.match(/^\/api\/llm\/sessions\/([^/]+)\/cancel$/);
    if (sessionCancelMatch && req.method === 'POST') {
        const sessionId = decodeSafeSessionId(sessionCancelMatch[1]);
        if (!sessionId) {
            sendInvalidSessionId(context);
            return true;
        }
        const result = handlers.llm?.cancelSession
            ? await handlers.llm.cancelSession({ sessionId })
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM session cancel handler not configured.');
        context.sendJson(200, result);
        return true;
    }
    // GET /api/llm/sessions/:id
    const sessionMatch = url.pathname.match(/^\/api\/llm\/sessions\/([^/]+)$/);
    if (sessionMatch && req.method === 'GET') {
        const sessionId = decodeSafeSessionId(sessionMatch[1]);
        if (!sessionId) {
            sendInvalidSessionId(context);
            return true;
        }
        const result = handlers.llm?.getSession
            ? await handlers.llm.getSession({ sessionId })
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM session handler not configured.');
        if (!result.ok) {
            context.sendJson(404, result);
            return true;
        }
        if (acceptsSse(req.headers.accept ?? null)) {
            await streamEventsAsSse(context, sessionId);
            return true;
        }
        context.sendJson(200, result);
        return true;
    }
    // GET /api/llm/runtimes
    if (url.pathname === '/api/llm/runtimes' && req.method === 'GET') {
        const result = handlers.llm?.listRuntimes
            ? await handlers.llm.listRuntimes()
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM runtime handler not configured.');
        context.sendJson(200, result);
        return true;
    }
    // POST /api/llm/runtimes/discover
    if (url.pathname === '/api/llm/runtimes/discover' && req.method === 'POST') {
        const result = handlers.llm?.discoverRuntimes
            ? await handlers.llm.discoverRuntimes()
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM discover handler not configured.');
        context.sendJson(200, result);
        return true;
    }
    // GET /api/llm/bindings/:slug
    const bindingsSlugMatch = url.pathname.match(/^\/api\/llm\/bindings\/([^/]+)$/);
    if (bindingsSlugMatch && req.method === 'GET') {
        const slug = decodeURIComponent(bindingsSlugMatch[1]);
        const result = handlers.llm?.listBindings
            ? await handlers.llm.listBindings({ slug })
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM bindings handler not configured.');
        context.sendJson(200, result);
        return true;
    }
    // PUT /api/llm/bindings/:slug
    if (bindingsSlugMatch && req.method === 'PUT') {
        const slug = decodeURIComponent(bindingsSlugMatch[1]);
        const body = await context.readJsonBody();
        const result = handlers.llm?.upsertBindings
            ? await handlers.llm.upsertBindings({ slug, bindings: Array.isArray(body.bindings) ? body.bindings : [] })
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM bindings handler not configured.');
        context.sendJson(200, result);
        return true;
    }
    // DELETE /api/llm/bindings/:id
    const bindingIdMatch = url.pathname.match(/^\/api\/llm\/bindings\/([^/]+)\/delete$/);
    if (bindingIdMatch && req.method === 'DELETE') {
        const bindingId = decodeURIComponent(bindingIdMatch[1]);
        const result = handlers.llm?.removeBinding
            ? await handlers.llm.removeBinding({ bindingId })
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM remove binding handler not configured.');
        context.sendJson(200, result);
        return true;
    }
    // GET /api/llm/preferred-runtime/:slug
    const preferredMatch = url.pathname.match(/^\/api\/llm\/preferred-runtime\/([^/]+)$/);
    if (preferredMatch && req.method === 'GET') {
        const slug = decodeURIComponent(preferredMatch[1]);
        const result = handlers.llm?.getPreferredRuntime
            ? await handlers.llm.getPreferredRuntime({ slug })
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM preferred runtime handler not configured.');
        context.sendJson(200, result);
        return true;
    }
    // PUT /api/llm/preferred-runtime/:slug
    if (preferredMatch && req.method === 'PUT') {
        const slug = decodeURIComponent(preferredMatch[1]);
        const body = await context.readJsonBody();
        const runtimeId = typeof body.runtimeId === 'string' ? body.runtimeId : null;
        const result = handlers.llm?.setPreferredRuntime
            ? await handlers.llm.setPreferredRuntime({ slug, runtimeId })
            : (0, commandResult_1.commandFailed)('not_implemented', 'LLM preferred runtime handler not configured.');
        context.sendJson(200, result);
        return true;
    }
    return false;
};
exports.handleLlmRoutes = handleLlmRoutes;
