"use strict";
/**
 * App Session (browser.app.session.*) shared types.
 *
 * Implements the docs/09 host contract from
 * https://github.com/openagentinternet/llm-play-chinese-chess
 * (Agent-Game-v2). The daemon is the owner of sessions, grants and leases;
 * this module only defines the data contracts plus the stable bridge error
 * codes used by every browser.app.session.* method.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_AGENT_GAME_PROTOCOL_PATHS = exports.APP_SESSION_TYPE = exports.AGENT_GAME_PROTOCOL = void 0;
exports.createAppSessionError = createAppSessionError;
exports.isAppSessionError = isAppSessionError;
exports.AGENT_GAME_PROTOCOL = 'agent-game/1';
exports.APP_SESSION_TYPE = 'agent-game';
/** Default protocol paths a session grant may write (docs/09 5.1). */
exports.DEFAULT_AGENT_GAME_PROTOCOL_PATHS = [
    '/protocols/simplegroupjoin',
    '/protocols/simplegroupchat',
];
function createAppSessionError(code, message, details) {
    return { code, message, ...(details ? { details } : {}) };
}
function isAppSessionError(value) {
    return Boolean(value
        && typeof value === 'object'
        && typeof value.code === 'string'
        && typeof value.message === 'string');
}
