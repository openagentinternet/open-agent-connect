"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleProtocolRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const handleProtocolRoutes = async (context) => {
    const { req, url } = context;
    const verbMatch = /^\/api\/protocol\/(publish|update)$/.exec(url.pathname);
    if (!verbMatch) {
        return false;
    }
    if (req.method !== 'POST') {
        context.sendMethodNotAllowed(['POST']);
        return true;
    }
    const verb = verbMatch[1];
    const handler = context.handlers.protocol?.[verb];
    const result = handler
        ? await handler(await context.readJsonBody())
        : (0, commandResult_1.commandFailed)('not_implemented', `Protocol ${verb} handler is not configured.`);
    context.sendJson(200, result);
    return true;
};
exports.handleProtocolRoutes = handleProtocolRoutes;
