"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_SYSTEM_HOSTS = exports.SystemCommandError = void 0;
class SystemCommandError extends Error {
    code;
    manualActionRequired;
    constructor(code, message, manualActionRequired = false) {
        super(message);
        this.code = code;
        this.manualActionRequired = manualActionRequired;
    }
}
exports.SystemCommandError = SystemCommandError;
exports.SUPPORTED_SYSTEM_HOSTS = ['codex', 'claude-code', 'openclaw'];
