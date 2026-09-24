"use strict";
/**
 * /api/kb/* routes — knowledge-base management plus the nightly study-job
 * surface (enqueue/status/retry, drained by the daemon nightly tick). Thin
 * dispatch onto handlers.kb; every response is a MetabotCommandResult JSON
 * body with HTTP 200, matching the schedule route style. `study/status` is
 * the DSH `metaweb_study_status` equivalent: it lists this bot's study jobs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleKbRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const GET_VERBS = {
    '/api/kb/list': 'list',
    '/api/kb/study/status': 'studyList',
};
const POST_VERBS = {
    '/api/kb/create': 'create',
    '/api/kb/update': 'update',
    '/api/kb/remove': 'remove',
    '/api/kb/query': 'query',
    '/api/kb/add-document': 'addDocument',
    '/api/kb/learn': 'learn',
    '/api/kb/study/enqueue': 'studyEnqueue',
    '/api/kb/study/retry': 'studyRetry',
};
function queryToInput(url) {
    const input = {};
    url.searchParams.forEach((value, key) => {
        input[key] = value;
    });
    return input;
}
function readNumber(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 'invalid';
}
function validateInput(verb, input) {
    const trimmed = (key) => (typeof input[key] === 'string' ? input[key].trim() : '');
    if ((verb === 'update' || verb === 'remove') && !trimmed('id')) {
        return { code: 'missing_id', message: 'id is required.' };
    }
    if (verb === 'create' && !trimmed('name')) {
        return { code: 'missing_name', message: 'name is required.' };
    }
    if (verb === 'query' && !trimmed('text')) {
        return { code: 'missing_text', message: 'text is required.' };
    }
    if (verb === 'addDocument' && !trimmed('title')) {
        return { code: 'missing_title', message: 'title is required.' };
    }
    if (verb === 'addDocument' && typeof input.content !== 'string') {
        return { code: 'missing_content', message: 'content is required.' };
    }
    if (verb === 'studyEnqueue' && !trimmed('topic')) {
        return { code: 'missing_topic', message: 'topic is required.' };
    }
    if (verb === 'query') {
        for (const key of ['topK', 'minScore']) {
            const value = readNumber(input[key]);
            if (value === 'invalid') {
                return { code: 'invalid_flag', message: `${key} must be a number.` };
            }
        }
    }
    return undefined;
}
const handleKbRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (!url.pathname.startsWith('/api/kb/')) {
        return false;
    }
    const postVerb = POST_VERBS[url.pathname];
    const getVerb = GET_VERBS[url.pathname];
    if (!postVerb && !getVerb) {
        context.sendJson(200, (0, commandResult_1.commandFailed)('unknown_command', `Unknown kb route: ${url.pathname}`));
        return true;
    }
    const expectedMethod = postVerb ? 'POST' : 'GET';
    if (req.method !== expectedMethod) {
        context.sendMethodNotAllowed([expectedMethod]);
        return true;
    }
    const verb = (postVerb ?? getVerb);
    const handler = handlers.kb?.[verb];
    if (!handler) {
        context.sendJson(501, {
            ok: false,
            code: 'not_implemented',
            message: `Kb handler is not configured: ${String(verb)}`,
        });
        return true;
    }
    const input = postVerb ? await context.readJsonBody() : queryToInput(url);
    const invalid = validateInput(verb, input);
    if (invalid) {
        context.sendJson(200, (0, commandResult_1.commandFailed)(invalid.code, invalid.message));
        return true;
    }
    const dispatch = handler;
    const result = await dispatch(input);
    context.sendJson(200, result);
    return true;
};
exports.handleKbRoutes = handleKbRoutes;
