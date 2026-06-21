"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleIdentityRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const handleIdentityRoutes = async (context) => {
    const { req, url, handlers } = context;
    // POST /api/identity/create
    if (url.pathname === '/api/identity/create') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.identity?.create
            ? await handlers.identity.create({
                name: typeof input.name === 'string' ? input.name : '',
                ...(typeof input.host === 'string' ? { host: input.host } : {}),
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'Identity create handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    // GET /api/identity/profiles
    if (url.pathname === '/api/identity/profiles' && req.method === 'GET') {
        const result = handlers.identity?.listProfiles
            ? await handlers.identity.listProfiles()
            : (0, commandResult_1.commandFailed)('not_implemented', 'Identity list profiles handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    return false;
};
exports.handleIdentityRoutes = handleIdentityRoutes;
