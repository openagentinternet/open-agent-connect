"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commandFailed = exports.commandManualActionRequired = exports.commandWaiting = exports.commandAwaitingConfirmation = exports.commandSuccess = void 0;
const commandSuccess = (data) => ({
    ok: true,
    state: 'success',
    data
});
exports.commandSuccess = commandSuccess;
const commandAwaitingConfirmation = (data) => ({
    ok: true,
    state: 'awaiting_confirmation',
    data,
});
exports.commandAwaitingConfirmation = commandAwaitingConfirmation;
const commandWaiting = (code, message, pollAfterMs) => ({
    ok: false,
    state: 'waiting',
    code,
    message,
    pollAfterMs
});
exports.commandWaiting = commandWaiting;
const commandManualActionRequired = (code, message, localUiUrl) => ({
    ok: false,
    state: 'manual_action_required',
    code,
    message,
    localUiUrl
});
exports.commandManualActionRequired = commandManualActionRequired;
const commandFailed = (code, message) => ({
    ok: false,
    state: 'failed',
    code,
    message
});
exports.commandFailed = commandFailed;
