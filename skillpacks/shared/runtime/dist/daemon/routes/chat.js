"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleChatRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const handleChatRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname !== '/api/chat/private') {
        return false;
    }
    if (req.method !== 'POST') {
        context.sendMethodNotAllowed(['POST']);
        return true;
    }
    const input = await context.readJsonBody();
    const result = handlers.chat?.private
        ? await handlers.chat.private(input)
        : (0, commandResult_1.commandFailed)('not_implemented', 'Chat private handler is not configured.');
    context.sendJson(200, result);
    return true;
};
exports.handleChatRoutes = handleChatRoutes;
