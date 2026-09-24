"use strict";
/**
 * /api/dream/* routes. Thin dispatch onto handlers.dream; every response is a
 * MetabotCommandResult JSON body with HTTP 200, matching the schedule route
 * style. Reads are GET (query string), the manual run is POST (JSON body).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDreamRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const GET_VERBS = {
    '/api/dream/status': 'status',
    '/api/dream/due': 'due',
    '/api/dream/summaries': 'summaries',
    '/api/dream/self-identity': 'selfIdentity',
    '/api/dream/capabilities': 'capabilities',
};
const POST_VERBS = {
    '/api/dream/run': 'run',
};
function queryToInput(url) {
    const input = {};
    url.searchParams.forEach((value, key) => {
        input[key] = value;
    });
    return input;
}
const handleDreamRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (!url.pathname.startsWith('/api/dream/')) {
        return false;
    }
    const postVerb = POST_VERBS[url.pathname];
    const getVerb = GET_VERBS[url.pathname];
    if (!postVerb && !getVerb) {
        context.sendJson(200, (0, commandResult_1.commandFailed)('unknown_command', `Unknown dream route: ${url.pathname}`));
        return true;
    }
    const expectedMethod = postVerb ? 'POST' : 'GET';
    if (req.method !== expectedMethod) {
        context.sendMethodNotAllowed([expectedMethod]);
        return true;
    }
    const verb = (postVerb ?? getVerb);
    const handler = handlers.dream?.[verb];
    if (!handler) {
        context.sendJson(501, {
            ok: false,
            code: 'not_implemented',
            message: `Dream handler is not configured: ${String(verb)}`,
        });
        return true;
    }
    const input = postVerb ? await context.readJsonBody() : queryToInput(url);
    if (postVerb && typeof input.date === 'string' && input.date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(input.date.trim())) {
        context.sendJson(200, (0, commandResult_1.commandFailed)('invalid_flag', 'date must be YYYY-MM-DD.'));
        return true;
    }
    const dispatch = handler;
    const result = await dispatch(input);
    context.sendJson(200, result);
    return true;
};
exports.handleDreamRoutes = handleDreamRoutes;
