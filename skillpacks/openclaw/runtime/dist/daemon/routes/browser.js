"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleBrowserRoutes = void 0;
const http_1 = require("../../browser/http");
// The POST /api/browser/tabs/open route is handled by handleBrowserApiRoutes
// below (it fans out via broadcastBrowserTabOpen from the browser module). The
// SSE route here is the daemon->page transport: each connected Browser page
// subscribes, and the POST route broadcasts open-tab events through the shared
// sink registry. ABC tabs are client-only; this carries transport only.
const handleBrowserRoutes = async (context) => {
    const { req, url } = context;
    if (url.pathname === '/api/browser/events') {
        if (req.method === 'GET') {
            await streamBrowserTabEvents(context);
            return true;
        }
        context.sendMethodNotAllowed(['GET']);
        return true;
    }
    return (0, http_1.handleBrowserApiRoutes)({
        method: context.req.method ?? 'GET',
        url: context.url,
        handlers: context.handlers.browser,
        readJsonBody: context.readJsonBody,
        sendJson: context.sendJson,
        sendMethodNotAllowed: context.sendMethodNotAllowed,
    });
};
exports.handleBrowserRoutes = handleBrowserRoutes;
async function streamBrowserTabEvents(context) {
    const { req, res } = context;
    res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    // Each SSE connection registers a sink that writes a single
    // `agent-browser:open-tab` event frame. The page-side listener (injected by
    // buildBrowserPageDefinition) consumes it and calls AgentBrowserTabs.openTab.
    const sink = (event) => {
        try {
            res.write(`event: ${event.type}\n`);
            res.write(`data: ${JSON.stringify({ uri: event.uri })}\n\n`);
        }
        catch {
            /* a closed/broken connection is unregistered on req close below */
        }
    };
    const unregister = (0, http_1.registerBrowserTabSink)(sink);
    req.on('close', () => {
        unregister();
        try {
            res.end();
        }
        catch { /* already ended */ }
    });
}
