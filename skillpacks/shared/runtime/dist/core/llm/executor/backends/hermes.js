"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hermesBackendFactory = void 0;
exports.createHermesBackend = createHermesBackend;
const acp_1 = require("./acp");
function buildHermesBackend(binaryPath, env, request) {
    return (0, acp_1.createAcpBackend)({
        provider: 'hermes',
        binaryPath,
        env,
        baseArgs: ['acp'],
        blockedArgs: {
            acp: { takesValue: false },
        },
        forcedEnv: {
            HERMES_YOLO_MODE: '1',
        },
        resumeMethod: 'session/resume',
        includeModelInNewSession: Boolean(request.model),
        gateNotificationsUntilPrompt: true,
    });
}
function createHermesBackend(binaryPath, env) {
    return {
        provider: 'hermes',
        execute(request, emitter, signal) {
            return buildHermesBackend(binaryPath, env, request).execute(request, emitter, signal);
        },
    };
}
exports.hermesBackendFactory = createHermesBackend;
