"use strict";
// View models for the A2A Trace page session list and session detail
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSessionListViewModel = buildSessionListViewModel;
exports.buildSessionDetailViewModel = buildSessionDetailViewModel;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function coerceArray(value) {
    return Array.isArray(value)
        ? value.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
        : [];
}
function coerceObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    return value;
}
function normalizeTimestamp(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return 0;
    if (value >= 1_000_000_000 && value < 1_000_000_000_000)
        return value * 1000;
    return value;
}
const ACTIVE_STATES = new Set(['requesting_remote', 'remote_received', 'remote_executing']);
const STALE_THRESHOLD_MS = 15 * 60 * 1000;
function getStateTone(state) {
    switch (state) {
        case 'completed': return 'completed';
        case 'remote_failed': return 'failure';
        case 'timeout': return 'timeout';
        case 'manual_action_required': return 'manual';
        case 'requesting_remote':
        case 'remote_received':
        case 'remote_executing': return 'active';
        default: return 'neutral';
    }
}
function getStateLabel(state) {
    switch (state) {
        case 'discovered': return 'Discovered';
        case 'awaiting_confirmation': return 'Awaiting Confirmation';
        case 'requesting_remote': return 'Requesting';
        case 'remote_received': return 'Received';
        case 'remote_executing': return 'Executing';
        case 'completed': return 'Completed';
        case 'manual_action_required': return 'Manual Action';
        case 'remote_failed': return 'Failed';
        case 'timeout': return 'Timeout';
        default: return state;
    }
}
function getMessageTone(sender, role, type) {
    if (sender === 'system')
        return 'system';
    if (type === 'tool_use' || type === 'tool_result')
        return 'tool';
    if (sender === role)
        return 'local';
    return 'peer';
}
function buildSessionListViewModel(rawSessions, now = Date.now()) {
    return rawSessions
        .map((entry) => {
        const record = coerceObject(entry);
        if (!record)
            return null;
        const sessionId = normalizeText(record.sessionId);
        if (!sessionId)
            return null;
        const traceId = normalizeText(record.traceId);
        const role = (normalizeText(record.role) || 'caller');
        const state = normalizeText(record.state);
        const createdAt = normalizeTimestamp(record.createdAt);
        const updatedAt = normalizeTimestamp(record.updatedAt);
        const localMetabotName = normalizeText(record.localMetabotName);
        const localMetabotGlobalMetaId = normalizeText(record.localMetabotGlobalMetaId);
        const peerGlobalMetaId = normalizeText(record.peerGlobalMetaId);
        const servicePinId = normalizeText(record.servicePinId);
        const isStale = ACTIVE_STATES.has(state) && updatedAt > 0 && (now - updatedAt) > STALE_THRESHOLD_MS;
        return {
            sessionId,
            traceId,
            role,
            state,
            createdAt,
            updatedAt,
            localMetabotName,
            localMetabotGlobalMetaId,
            peerGlobalMetaId,
            servicePinId,
            stateTone: isStale ? 'timeout' : getStateTone(state),
            stateLabel: isStale ? 'Timeout' : getStateLabel(state),
            timeAgoMs: now - updatedAt,
        };
    })
        .filter((item) => item !== null);
}
function buildSessionDetailViewModel(payload) {
    const session = coerceObject(payload.session);
    if (!session)
        return null;
    const sessionId = normalizeText(session.sessionId);
    const traceId = normalizeText(session.traceId);
    const role = (normalizeText(session.role) || 'caller');
    const state = normalizeText(session.state);
    const createdAt = normalizeTimestamp(session.createdAt);
    const updatedAt = normalizeTimestamp(session.updatedAt);
    const callerGlobalMetaId = normalizeText(session.callerGlobalMetaId);
    const providerGlobalMetaId = normalizeText(session.providerGlobalMetaId);
    const servicePinId = normalizeText(session.servicePinId);
    const localMetabotName = normalizeText(payload.localMetabotName);
    const localMetabotGlobalMetaId = normalizeText(payload.localMetabotGlobalMetaId);
    const peerGlobalMetaId = normalizeText(payload.peerGlobalMetaId);
    const rawItems = coerceArray(payload.transcriptItems);
    const messages = rawItems
        .map((item) => {
        const id = normalizeText(item.id);
        if (!id)
            return null;
        const type = normalizeText(item.type) || 'message';
        const sender = (normalizeText(item.sender) || 'system');
        const content = normalizeText(item.content);
        const timestamp = normalizeTimestamp(item.timestamp);
        const taskRunId = normalizeText(item.taskRunId) || null;
        const metadata = coerceObject(item.metadata);
        return {
            id,
            sessionId,
            taskRunId,
            timestamp,
            type,
            sender,
            content,
            metadata,
            tone: getMessageTone(sender, role, type),
        };
    })
        .filter((m) => m !== null)
        .sort((a, b) => a.timestamp - b.timestamp);
    return {
        sessionId,
        traceId,
        role,
        state,
        createdAt,
        updatedAt,
        localMetabotName,
        localMetabotGlobalMetaId,
        peerGlobalMetaId,
        servicePinId,
        callerGlobalMetaId,
        providerGlobalMetaId,
        messages,
    };
}
