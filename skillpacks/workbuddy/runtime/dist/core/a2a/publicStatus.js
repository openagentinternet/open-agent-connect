"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePublicStatus = resolvePublicStatus;
exports.mapPublicStatus = mapPublicStatus;
const eventMap = {
    request_sent: 'requesting_remote',
    provider_received: 'remote_received',
    provider_executing: 'remote_executing',
    provider_completed: 'completed',
    timeout: 'timeout',
    provider_failed: 'remote_failed',
    clarification_needed: 'manual_action_required',
};
/**
 * Returns both the resolved public status and the raw event label (if any) for tracing.
 */
function resolvePublicStatus(trace) {
    const event = trace?.event;
    if (typeof event === 'string' && Object.prototype.hasOwnProperty.call(eventMap, event)) {
        return {
            status: eventMap[event],
            rawEvent: event,
            mapped: true,
        };
    }
    return { status: null, rawEvent: event, mapped: false };
}
/**
 * Convenience helper for consumers that only need the status value.
 */
function mapPublicStatus(trace) {
    return resolvePublicStatus(trace).status;
}
