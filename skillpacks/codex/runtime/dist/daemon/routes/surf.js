"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSurfRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
/** `/api/surf/*` — the MetaWeb surf HTTP surface (status/run/enable/disable/budget). */
const handleSurfRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (!url.pathname.startsWith('/api/surf/')) {
        return false;
    }
    if (req.method !== 'POST') {
        context.sendMethodNotAllowed(['POST']);
        return true;
    }
    const verb = url.pathname.slice('/api/surf/'.length);
    const input = await context.readJsonBody();
    const group = handlers.surf;
    if (!group?.status || !group.run || !group.enable || !group.disable || !group.budget) {
        context.sendJson(200, (0, commandResult_1.commandFailed)('not_implemented', 'Surf handlers are not configured.'));
        return true;
    }
    switch (verb) {
        case 'status': {
            context.sendJson(200, await group.status(input));
            return true;
        }
        case 'run': {
            context.sendJson(200, await group.run(input));
            return true;
        }
        case 'enable': {
            context.sendJson(200, await group.enable(input));
            return true;
        }
        case 'disable': {
            context.sendJson(200, await group.disable(input));
            return true;
        }
        case 'budget': {
            context.sendJson(200, await group.budget(input));
            return true;
        }
        default:
            context.sendJson(200, (0, commandResult_1.commandFailed)('unknown_command', `Unknown surf route: ${verb}`));
            return true;
    }
};
exports.handleSurfRoutes = handleSurfRoutes;
