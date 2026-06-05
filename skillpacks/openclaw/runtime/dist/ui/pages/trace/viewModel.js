"use strict";
// View models for the A2A Trace page session list and session detail
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSessionListViewModel = buildSessionListViewModel;
exports.buildSessionDetailViewModel = buildSessionDetailViewModel;
const deliveryArtifacts_1 = require("../../../core/a2a/deliveryArtifacts");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeNullableText(value) {
    const normalized = normalizeText(value);
    return normalized || null;
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
function coerceDeliveryArtifact(value) {
    return (0, deliveryArtifacts_1.normalizeDeliveryArtifacts)({ artifacts: [value] })[0] ?? null;
}
function collectDeliveryArtifacts(item, metadata) {
    const deliveryPayload = coerceObject(metadata?.deliveryPayload);
    const sources = [
        item.artifacts,
        metadata?.deliveryArtifacts,
        deliveryPayload?.artifacts,
    ];
    const seen = new Set();
    const artifacts = [];
    for (const source of sources) {
        for (const entry of Array.isArray(source) ? source : []) {
            const artifact = coerceDeliveryArtifact(entry);
            if (!artifact || seen.has(artifact.uri)) {
                continue;
            }
            seen.add(artifact.uri);
            artifacts.push(artifact);
        }
    }
    return artifacts;
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
function normalizeBoolean(value) {
    if (value === true || value === 1)
        return true;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'true' || normalized === '1' || normalized === 'yes';
    }
    return false;
}
function isZeroAmount(value) {
    const text = normalizeText(value);
    if (!text)
        return false;
    const numeric = Number(text);
    return Number.isFinite(numeric) && numeric === 0;
}
function buildRefundHref(orderId) {
    return orderId ? `/ui/refund?orderId=${encodeURIComponent(orderId)}` : '/ui/refund';
}
function resolveRefundAction(input) {
    const record = input.record;
    const order = coerceObject(record.order);
    const refund = coerceObject(record.refund);
    const source = order ?? refund ?? record;
    const orderRole = normalizeText(source.role) || (input.role === 'provider' ? 'seller' : '');
    const status = normalizeText(source.status) || normalizeText(record.refundStatus) || normalizeText(record.status);
    const blockingReason = normalizeText(source.refundBlockingReason)
        || normalizeText(source.blockingReason)
        || normalizeText(record.refundBlockingReason)
        || normalizeText(record.blockingReason);
    const refundRequestPinId = normalizeText(source.refundRequestPinId)
        || normalizeText(record.refundRequestPinId)
        || null;
    const refundFinalizePinId = normalizeText(source.refundFinalizePinId)
        || normalizeText(record.refundFinalizePinId)
        || null;
    const paymentTxid = normalizeText(source.paymentTxid) || normalizeText(record.paymentTxid);
    const paymentAmount = normalizeText(source.paymentAmount) || normalizeText(record.paymentAmount);
    const orderId = normalizeText(source.id)
        || normalizeText(source.serviceOrderPinId)
        || normalizeText(source.orderReference)
        || normalizeText(record.refundOrderId)
        || normalizeText(record.orderId)
        || normalizeText(record.serviceOrderPinId)
        || null;
    const refundFrom = normalizeText(source.localMetabotSlug)
        || normalizeText(record.localMetabotSlug)
        || normalizeText(record.refundFrom)
        || null;
    const unsupported = blockingReason === 'refund_settlement_unsupported';
    const refunded = status === 'refunded' || Boolean(refundFinalizePinId);
    const explicitRequired = normalizeBoolean(record.refundActionRequired)
        || normalizeBoolean(record.manualActionRequired)
        || normalizeBoolean(source.manualActionRequired);
    const explicitConfirmable = normalizeBoolean(record.refundConfirmable)
        || normalizeBoolean(source.refundConfirmable);
    const pendingRequest = orderRole === 'seller'
        && status === 'refund_pending'
        && Boolean(refundRequestPinId);
    const failedPaidOrder = orderRole === 'seller'
        && status === 'failed'
        && Boolean(paymentTxid)
        && !isZeroAmount(paymentAmount);
    const retryableBlocker = orderRole === 'seller'
        && Boolean(blockingReason)
        && !unsupported;
    const refundActionRequired = !unsupported
        && !refunded
        && (explicitRequired || pendingRequest || failedPaidOrder || retryableBlocker);
    const refundConfirmable = !unsupported
        && !refunded
        && (explicitConfirmable || (refundActionRequired && Boolean(refundRequestPinId)));
    return {
        refundActionRequired,
        refundConfirmable,
        refundOrderId: orderId,
        refundStatus: status || null,
        refundRequestPinId,
        refundFinalizePinId,
        refundFrom,
        refundHref: refundActionRequired ? buildRefundHref(orderId) : null,
    };
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
        const peerName = normalizeText(record.peerName);
        const servicePinId = normalizeText(record.servicePinId);
        const isStale = ACTIVE_STATES.has(state) && updatedAt > 0 && (now - updatedAt) > STALE_THRESHOLD_MS;
        const refundAction = resolveRefundAction({ record, role });
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
            peerName,
            servicePinId,
            stateTone: refundAction.refundActionRequired ? 'manual' : isStale ? 'timeout' : getStateTone(state),
            stateLabel: refundAction.refundActionRequired ? 'Refund Required' : isStale ? 'Timeout' : getStateLabel(state),
            timeAgoMs: now - updatedAt,
            ...refundAction,
        };
    })
        .filter((item) => item !== null);
}
function buildSessionDetailViewModel(payload) {
    const session = coerceObject(payload.session);
    if (!session)
        return null;
    const a2a = coerceObject(payload.a2a);
    const sessionId = normalizeText(session.sessionId)
        || normalizeText(payload.sessionId)
        || normalizeText(a2a?.sessionId)
        || normalizeText(session.id);
    const traceId = normalizeText(session.traceId) || normalizeText(payload.traceId);
    const role = (normalizeText(session.role) || 'caller');
    const state = (normalizeText(session.state) || normalizeText(a2a?.publicStatus));
    const createdAt = normalizeTimestamp(session.createdAt);
    const updatedAt = normalizeTimestamp(session.updatedAt);
    const callerGlobalMetaId = normalizeText(session.callerGlobalMetaId) || normalizeText(a2a?.callerGlobalMetaId);
    const providerGlobalMetaId = normalizeText(session.providerGlobalMetaId) || normalizeText(a2a?.providerGlobalMetaId);
    const servicePinId = normalizeText(session.servicePinId) || normalizeText(a2a?.servicePinId);
    const localMetabotName = normalizeText(payload.localMetabotName);
    const localMetabotGlobalMetaId = normalizeText(payload.localMetabotGlobalMetaId);
    const peerGlobalMetaId = normalizeText(payload.peerGlobalMetaId);
    const peerName = normalizeText(payload.peerName) || normalizeText(session.peerName);
    const refundAction = resolveRefundAction({
        record: {
            ...session,
            ...(payload.order ? { order: payload.order } : {}),
        },
        role,
    });
    const topLevelItems = coerceArray(payload.transcriptItems);
    const inspector = coerceObject(payload.inspector);
    const rawItems = topLevelItems.length
        ? topLevelItems
        : coerceArray(inspector?.transcriptItems);
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
        const deliveryArtifacts = collectDeliveryArtifacts(item, metadata);
        return {
            id,
            sessionId,
            taskRunId,
            timestamp,
            type,
            sender,
            content,
            metadata,
            deliveryArtifacts,
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
        peerName,
        servicePinId,
        callerGlobalMetaId,
        providerGlobalMetaId,
        messages,
        ...refundAction,
    };
}
