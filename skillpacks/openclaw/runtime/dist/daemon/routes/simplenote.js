"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSimpleNoteRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const handleSimpleNoteRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname !== '/api/simplenote/post') {
        return false;
    }
    if (req.method !== 'POST') {
        context.sendMethodNotAllowed(['POST']);
        return true;
    }
    const input = await context.readJsonBody();
    const result = handlers.simplenote?.post
        ? await handlers.simplenote.post(input)
        : (0, commandResult_1.commandFailed)('not_implemented', 'SimpleNote post handler is not configured.');
    context.sendJson(200, result);
    return true;
};
exports.handleSimpleNoteRoutes = handleSimpleNoteRoutes;
