"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleQandaRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const handleQandaRoutes = async (context) => {
    const { req, url } = context;
    const verbMatch = /^\/api\/qanda\/(question|answer|like)$/.exec(url.pathname);
    if (!verbMatch) {
        return false;
    }
    if (req.method !== 'POST') {
        context.sendMethodNotAllowed(['POST']);
        return true;
    }
    const verb = verbMatch[1];
    const handler = context.handlers.qanda?.[verb];
    const result = handler
        ? await handler(await context.readJsonBody())
        : (0, commandResult_1.commandFailed)('not_implemented', `Q&A ${verb} handler is not configured.`);
    context.sendJson(200, result);
    return true;
};
exports.handleQandaRoutes = handleQandaRoutes;
