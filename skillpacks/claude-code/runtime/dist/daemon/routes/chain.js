"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleChainRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const handleChainRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname !== '/api/chain/write') {
        return false;
    }
    if (req.method !== 'POST') {
        context.sendMethodNotAllowed(['POST']);
        return true;
    }
    const input = await context.readJsonBody();
    const result = handlers.chain?.write
        ? await handlers.chain.write(input)
        : (0, commandResult_1.commandFailed)('not_implemented', 'Chain write handler is not configured.');
    context.sendJson(200, result);
    return true;
};
exports.handleChainRoutes = handleChainRoutes;
