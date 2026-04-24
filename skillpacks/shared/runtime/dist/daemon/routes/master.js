"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMasterRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const MASTER_TRACE_PREFIX = '/api/master/trace/';
const handleMasterRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname === '/api/master/publish') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.master?.publish
            ? await handlers.master.publish(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Master publish handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/master/list') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const online = url.searchParams.get('online');
        const masterKind = url.searchParams.get('kind')?.trim() || undefined;
        const result = handlers.master?.list
            ? await handlers.master.list({
                online: online === null ? undefined : online === 'true',
                masterKind,
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'Master list handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/master/ask') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.master?.ask
            ? await handlers.master.ask(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Master ask handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/master/suggest') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.master?.suggest
            ? await handlers.master.suggest(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Master suggest handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/master/host-action') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.master?.hostAction
            ? await handlers.master.hostAction(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Master host-action handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/master/receive') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.master?.receive
            ? await handlers.master.receive(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Master receive handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname.startsWith(MASTER_TRACE_PREFIX)) {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const traceId = decodeURIComponent(url.pathname.slice(MASTER_TRACE_PREFIX.length)).trim();
        const result = handlers.master?.trace
            ? await handlers.master.trace({ traceId })
            : (0, commandResult_1.commandFailed)('not_implemented', 'Master trace handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    return false;
};
exports.handleMasterRoutes = handleMasterRoutes;
