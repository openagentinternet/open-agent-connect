"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleTraceRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const TRACE_ROUTE_PREFIX = '/api/trace/';
function serializeWatchNdjsonAsSse(ndjson) {
    const lines = ndjson
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
    return `retry: 3000\n\n${lines.map((line) => `event: trace-status\ndata: ${line}\n\n`).join('')}`;
}
const handleTraceRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (!url.pathname.startsWith(TRACE_ROUTE_PREFIX)) {
        return false;
    }
    if (req.method !== 'GET') {
        context.sendMethodNotAllowed(['GET']);
        return true;
    }
    const routeSuffix = decodeURIComponent(url.pathname.slice(TRACE_ROUTE_PREFIX.length)).trim();
    // GET /api/trace/sessions — list all A2A sessions across all local MetaBot profiles
    if (routeSuffix === 'sessions') {
        const result = handlers.trace?.listSessions
            ? await handlers.trace.listSessions()
            : (0, commandResult_1.commandFailed)('not_implemented', 'Trace session list handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    // GET /api/trace/sessions/{sessionId} — get a specific session with transcript
    if (routeSuffix.startsWith('sessions/')) {
        const sessionId = routeSuffix.slice('sessions/'.length).trim();
        if (!sessionId) {
            context.sendJson(400, (0, commandResult_1.commandFailed)('missing_session_id', 'Session ID is required.'));
            return true;
        }
        const result = handlers.trace?.getSession
            ? await handlers.trace.getSession({ sessionId })
            : (0, commandResult_1.commandFailed)('not_implemented', 'Trace session detail handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (routeSuffix.endsWith('/events')) {
        const traceId = routeSuffix.slice(0, -'/events'.length).trim();
        const result = handlers.trace?.watchTrace
            ? await handlers.trace.watchTrace({ traceId })
            : '';
        if (!result) {
            context.sendJson(404, (0, commandResult_1.commandFailed)('trace_not_found', `Trace event stream not found: ${traceId}`));
            return true;
        }
        context.sendText(200, serializeWatchNdjsonAsSse(result), 'text/event-stream; charset=utf-8');
        return true;
    }
    if (routeSuffix.endsWith('/watch')) {
        const traceId = routeSuffix.slice(0, -'/watch'.length).trim();
        const result = handlers.trace?.watchTrace
            ? await handlers.trace.watchTrace({ traceId })
            : '';
        if (!result) {
            context.sendJson(404, (0, commandResult_1.commandFailed)('trace_not_found', `Trace watch not found: ${traceId}`));
            return true;
        }
        context.sendText(200, result, 'application/x-ndjson; charset=utf-8');
        return true;
    }
    const traceId = routeSuffix;
    const result = handlers.trace?.getTrace
        ? await handlers.trace.getTrace({ traceId })
        : (0, commandResult_1.commandFailed)('not_implemented', 'Trace handler is not configured.');
    context.sendJson(200, result);
    return true;
};
exports.handleTraceRoutes = handleTraceRoutes;
