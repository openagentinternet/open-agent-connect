"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleBuzzRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const handleBuzzRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname !== '/api/buzz/post') {
        return false;
    }
    if (req.method !== 'POST') {
        context.sendMethodNotAllowed(['POST']);
        return true;
    }
    const input = await context.readJsonBody();
    const result = handlers.buzz?.post
        ? await handlers.buzz.post(input)
        : (0, commandResult_1.commandFailed)('not_implemented', 'Buzz post handler is not configured.');
    context.sendJson(200, result);
    return true;
};
exports.handleBuzzRoutes = handleBuzzRoutes;
