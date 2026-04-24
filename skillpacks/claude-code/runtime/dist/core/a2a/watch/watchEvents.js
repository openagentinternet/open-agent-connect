"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTerminalTraceWatchStatus = isTerminalTraceWatchStatus;
const TERMINAL_TRACE_WATCH_STATUSES = new Set([
    'completed',
    'manual_action_required',
    'remote_failed',
    'network_unavailable',
    'local_runtime_error',
    'no_service_found',
    'delegation_declined',
    'delegation_expired',
]);
function isTerminalTraceWatchStatus(status) {
    return TERMINAL_TRACE_WATCH_STATUSES.has(status);
}
