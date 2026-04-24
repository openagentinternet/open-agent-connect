"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleServicesRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const handleServicesRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname === '/api/services/publish') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.services?.publish
            ? await handlers.services.publish(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Services publish handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/call') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.services?.call
            ? await handlers.services.call(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Services call handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/execute') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.services?.execute
            ? await handlers.services.execute(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Services execute handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/rate') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.services?.rate
            ? await handlers.services.rate(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Services rate handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    return false;
};
exports.handleServicesRoutes = handleServicesRoutes;
