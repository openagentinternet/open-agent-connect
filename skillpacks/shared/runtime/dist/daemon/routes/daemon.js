"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDaemonRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const handleDaemonRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname === '/api/daemon/status') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const result = handlers.daemon?.getStatus
            ? await handlers.daemon.getStatus()
            : (0, commandResult_1.commandFailed)('not_implemented', 'Daemon status handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/doctor') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const result = handlers.daemon?.doctor
            ? await handlers.daemon.doctor()
            : (0, commandResult_1.commandFailed)('not_implemented', 'Doctor handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    return false;
};
exports.handleDaemonRoutes = handleDaemonRoutes;
