"use strict";
/**
 * /api/schedule/* routes. Thin dispatch onto handlers.schedule; every
 * response is a MetabotCommandResult JSON body with HTTP 200, matching the
 * grouptask/chat route style. The heartbeat verb is the host lease — it is
 * in-memory only, so the daemon process owns it and it never reaches disk.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleScheduleRoutes = void 0;
const POST_VERBS = {
    '/api/schedule/heartbeat': 'heartbeat',
    '/api/schedule/claim': 'claim',
    '/api/schedule/complete': 'complete',
};
const GET_VERBS = {
    '/api/schedule/due': 'due',
    '/api/schedule/list': 'list',
    '/api/schedule/show': 'show',
    '/api/schedule/runs': 'runs',
};
function queryToInput(url) {
    const input = {};
    url.searchParams.forEach((value, key) => {
        input[key] = value;
    });
    return input;
}
const handleScheduleRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (!url.pathname.startsWith('/api/schedule/')) {
        return false;
    }
    const postVerb = POST_VERBS[url.pathname];
    const getVerb = GET_VERBS[url.pathname];
    if (!postVerb && !getVerb) {
        return false;
    }
    const expectedMethod = postVerb ? 'POST' : 'GET';
    if (req.method !== expectedMethod) {
        context.sendMethodNotAllowed([expectedMethod]);
        return true;
    }
    const verb = (postVerb ?? getVerb);
    const handler = handlers.schedule?.[verb];
    if (!handler) {
        context.sendJson(501, {
            ok: false,
            code: 'not_implemented',
            message: `Schedule handler is not configured: ${String(verb)}`,
        });
        return true;
    }
    const input = postVerb ? await context.readJsonBody() : queryToInput(url);
    const result = await handler(input);
    context.sendJson(200, result);
    return true;
};
exports.handleScheduleRoutes = handleScheduleRoutes;
