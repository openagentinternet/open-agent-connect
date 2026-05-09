"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleConfigRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const handleConfigRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname !== '/api/config') {
        return false;
    }
    if (req.method === 'GET') {
        const result = handlers.config?.get
            ? await handlers.config.get()
            : (0, commandResult_1.commandFailed)('not_implemented', 'Config get handler is not configured.');
        context.sendJson(result.ok ? 200 : 400, result);
        return true;
    }
    if (req.method === 'PUT') {
        const input = await context.readJsonBody();
        const result = handlers.config?.set
            ? await handlers.config.set(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Config set handler is not configured.');
        context.sendJson(result.ok ? 200 : 400, result);
        return true;
    }
    context.sendMethodNotAllowed(['GET', 'PUT']);
    return true;
};
exports.handleConfigRoutes = handleConfigRoutes;
