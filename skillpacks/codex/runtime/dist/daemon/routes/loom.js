"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleLoomRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
function queryObject(url) {
    const input = {};
    for (const [key, value] of url.searchParams.entries()) {
        input[key] = value;
    }
    if (url.searchParams.has('refresh')) {
        input.refresh = url.searchParams.get('refresh') === 'true';
    }
    if (url.searchParams.has('limit')) {
        const rawLimit = url.searchParams.get('limit') ?? '';
        const parsed = Number.parseInt(rawLimit, 10);
        input.limit = Number.isInteger(parsed) && String(parsed) === rawLimit.trim() ? parsed : rawLimit;
    }
    return input;
}
function decodePathSegment(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return '';
    }
}
const handleLoomRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname === '/api/loom/dashboard') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const result = handlers.loom?.getDashboard
            ? await handlers.loom.getDashboard(queryObject(url))
            : (0, commandResult_1.commandFailed)('not_implemented', 'Loom dashboard handler not configured.');
        context.sendJson(result.ok ? 200 : 400, result);
        return true;
    }
    const taskMatch = url.pathname.match(/^\/api\/loom\/tasks\/([^/]+)$/);
    if (taskMatch) {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const taskPinId = decodePathSegment(taskMatch[1]).trim();
        if (!taskPinId) {
            context.sendJson(400, (0, commandResult_1.commandFailed)('invalid_task_pin_id', 'Loom task pin id is required.'));
            return true;
        }
        const result = handlers.loom?.getTaskDetail
            ? await handlers.loom.getTaskDetail({
                ...queryObject(url),
                taskPinId,
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'Loom task detail handler not configured.');
        context.sendJson(result.ok ? 200 : result.code === 'loom_dashboard_task_not_found' ? 404 : 400, result);
        return true;
    }
    if (url.pathname === '/api/loom/refresh') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const body = await context.readJsonBody();
        const result = handlers.loom?.refresh
            ? await handlers.loom.refresh(body)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Loom refresh handler not configured.');
        context.sendJson(result.ok ? 200 : 400, result);
        return true;
    }
    return false;
};
exports.handleLoomRoutes = handleLoomRoutes;
