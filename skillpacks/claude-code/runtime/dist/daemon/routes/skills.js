"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSkillRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const handleSkillRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname === '/api/skills/publish') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.skills?.publish
            ? await handlers.skills.publish(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Skills publish handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    return false;
};
exports.handleSkillRoutes = handleSkillRoutes;
