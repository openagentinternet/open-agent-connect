"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleFileRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const handleFileRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname !== '/api/file/upload') {
        return false;
    }
    if (req.method !== 'POST') {
        context.sendMethodNotAllowed(['POST']);
        return true;
    }
    const input = await context.readJsonBody();
    const result = handlers.file?.upload
        ? await handlers.file.upload(input)
        : (0, commandResult_1.commandFailed)('not_implemented', 'File upload handler is not configured.');
    context.sendJson(200, result);
    return true;
};
exports.handleFileRoutes = handleFileRoutes;
