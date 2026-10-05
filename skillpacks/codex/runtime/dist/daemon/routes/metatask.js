"use strict";
/**
 * /api/metatask/* routes. Thin dispatch onto handlers.metatask; every response
 * is a MetabotCommandResult JSON body with HTTP 200 (the result envelope
 * carries success/failure), matching the grouptask route style. The board and
 * task shapes are the shared data contract for both UIs (DSH plugin panel +
 * src/ui tracking page) and the CLI read verbs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMetaTaskRoutes = void 0;
const POST_VERBS = {
    '/api/metatask/refresh': 'refresh',
    '/api/metatask/draft': 'draft',
    '/api/metatask/claim': 'claim',
    '/api/metatask/submit': 'submit',
    '/api/metatask/verify': 'verify',
    '/api/metatask/release': 'release',
    '/api/metatask/publish': 'publish',
    '/api/metatask/publish-spec': 'publishSpec',
    '/api/metatask/amend': 'amend',
};
const GET_VERBS = {
    '/api/metatask/board': 'board',
    '/api/metatask/task': 'task',
    '/api/metatask/replay': 'replay',
};
function queryToInput(url) {
    const input = {};
    url.searchParams.forEach((value, key) => {
        input[key] = value;
    });
    return input;
}
const handleMetaTaskRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (!url.pathname.startsWith('/api/metatask/')) {
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
    const handler = handlers.metatask?.[verb];
    if (!handler) {
        context.sendJson(501, {
            ok: false,
            code: 'not_implemented',
            message: `MetaTask handler is not configured: ${String(verb)}`,
        });
        return true;
    }
    const input = postVerb ? await context.readJsonBody() : queryToInput(url);
    const result = await handler(input);
    context.sendJson(200, result);
    return true;
};
exports.handleMetaTaskRoutes = handleMetaTaskRoutes;
