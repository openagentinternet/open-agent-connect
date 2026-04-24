"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleIdentityRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const handleIdentityRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname !== '/api/identity/create') {
        return false;
    }
    if (req.method !== 'POST') {
        context.sendMethodNotAllowed(['POST']);
        return true;
    }
    const input = await context.readJsonBody();
    const result = handlers.identity?.create
        ? await handlers.identity.create({
            name: typeof input.name === 'string' ? input.name : '',
        })
        : (0, commandResult_1.commandFailed)('not_implemented', 'Identity create handler is not configured.');
    context.sendJson(200, result);
    return true;
};
exports.handleIdentityRoutes = handleIdentityRoutes;
