"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildServiceOrderObserverConversationId = buildServiceOrderObserverConversationId;
exports.buildServiceOrderFallbackPayload = buildServiceOrderFallbackPayload;
exports.buildServiceOrderEventMessage = buildServiceOrderEventMessage;
exports.buildSessionTrace = buildSessionTrace;
const node_path_1 = __importDefault(require("node:path"));
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function sanitizePathSegment(value, fallback) {
    const normalized = normalizeText(value).replace(/[^a-zA-Z0-9._-]+/g, '-');
    return normalized || fallback;
}
function buildA2ATraceRecord(input) {
    if (!input) {
        return null;
    }
    const record = {
        sessionId: normalizeText(input.sessionId) || null,
        taskRunId: normalizeText(input.taskRunId) || null,
        role: normalizeText(input.role) || null,
        publicStatus: normalizeText(input.publicStatus) || null,
        latestEvent: normalizeText(input.latestEvent) || null,
        taskRunState: normalizeText(input.taskRunState) || null,
        callerGlobalMetaId: normalizeText(input.callerGlobalMetaId) || null,
        callerName: normalizeText(input.callerName) || null,
        providerGlobalMetaId: normalizeText(input.providerGlobalMetaId) || null,
        providerName: normalizeText(input.providerName) || null,
        servicePinId: normalizeText(input.servicePinId) || null,
    };
    return Object.values(record).some(Boolean) ? record : null;
}
function buildAskMasterTraceRecord(input) {
    if (!input || typeof input !== 'object') {
        return null;
    }
    const preview = input.preview && typeof input.preview === 'object'
        ? {
            userTask: normalizeText(input.preview.userTask) || null,
            question: normalizeText(input.preview.question) || null,
        }
        : null;
    const response = input.response && typeof input.response === 'object'
        ? {
            status: normalizeText(input.response.status) || null,
            summary: normalizeText(input.response.summary) || null,
            followUpQuestion: normalizeText(input.response.followUpQuestion) || null,
            errorCode: normalizeText(input.response.errorCode) || null,
        }
        : null;
    const failure = input.failure && typeof input.failure === 'object'
        ? {
            code: normalizeText(input.failure.code) || null,
            message: normalizeText(input.failure.message) || null,
        }
        : null;
    const auto = input.auto && typeof input.auto === 'object'
        ? {
            reason: normalizeText(input.auto.reason) || null,
            confidence: typeof input.auto.confidence === 'number' && Number.isFinite(input.auto.confidence)
                ? input.auto.confidence
                : Number.isFinite(Number(input.auto.confidence))
                    ? Number(input.auto.confidence)
                    : null,
            frictionMode: normalizeText(input.auto.frictionMode) === 'preview_confirm'
                || normalizeText(input.auto.frictionMode) === 'direct_send'
                ? normalizeText(input.auto.frictionMode)
                : null,
            detectorVersion: normalizeText(input.auto.detectorVersion) || null,
            selectedMasterTrusted: typeof input.auto.selectedMasterTrusted === 'boolean'
                ? input.auto.selectedMasterTrusted
                : null,
            sensitivity: input.auto.sensitivity && typeof input.auto.sensitivity === 'object'
                ? {
                    isSensitive: input.auto.sensitivity.isSensitive === true,
                    reasons: Array.isArray(input.auto.sensitivity.reasons)
                        ? input.auto.sensitivity.reasons
                            .filter((entry) => typeof entry === 'string')
                            .map((entry) => normalizeText(entry))
                            .filter(Boolean)
                        : [],
                }
                : null,
        }
        : null;
    const record = {
        flow: 'master',
        transport: normalizeText(input.transport) || null,
        canonicalStatus: normalizeText(input.canonicalStatus) || null,
        triggerMode: normalizeText(input.triggerMode) || null,
        contextMode: normalizeText(input.contextMode) || null,
        confirmationMode: normalizeText(input.confirmationMode) || null,
        requestId: normalizeText(input.requestId) || null,
        masterKind: normalizeText(input.masterKind) || null,
        servicePinId: normalizeText(input.servicePinId) || null,
        providerGlobalMetaId: normalizeText(input.providerGlobalMetaId) || null,
        displayName: normalizeText(input.displayName) || null,
        preview: preview && (preview.userTask || preview.question) ? preview : null,
        response: response && (response.status || response.summary || response.followUpQuestion || response.errorCode) ? response : null,
        failure: failure && (failure.code || failure.message) ? failure : null,
        auto: auto && (auto.reason
            || auto.confidence !== null
            || auto.frictionMode
            || auto.detectorVersion
            || auto.selectedMasterTrusted !== null
            || auto.sensitivity) ? auto : null,
    };
    return record.canonicalStatus || record.requestId || record.masterKind || record.servicePinId || record.displayName
        || record.preview || record.response || record.failure || record.auto
        ? record
        : null;
}
function buildServiceOrderObserverConversationId(input) {
    const txidPart = normalizeText(input.paymentTxid).slice(0, 16) || 'pending';
    return `metaweb_order:${input.role}:${input.metabotId}:${normalizeText(input.peerGlobalMetaId)}:${txidPart}`;
}
function buildServiceOrderFallbackPayload(input) {
    const txid = normalizeText(input.servicePaidTx);
    const lines = [
        '[ORDER] Restored service order context.',
        input.servicePrice || input.serviceCurrency
            ? `支付金额 ${normalizeText(input.servicePrice) || '0'} ${normalizeText(input.serviceCurrency) || 'SPACE'}`
            : '',
        txid ? `txid: ${txid}` : 'txid: pending',
        normalizeText(input.serviceId) ? `service id: ${normalizeText(input.serviceId)}` : '',
        normalizeText(input.serviceSkill) ? `skill name: ${normalizeText(input.serviceSkill)}` : '',
        normalizeText(input.peerGlobalMetaId)
            ? `peer globalmetaid: ${normalizeText(input.peerGlobalMetaId)}`
            : '',
    ].filter(Boolean);
    return lines.join('\n');
}
function buildServiceOrderEventMessage(type, order) {
    if (type === 'refund_requested') {
        if (order.role === 'seller') {
            const pinId = order.refundRequestPinId ? ` 申请凭证：${order.refundRequestPinId}` : '';
            return `系统提示：买家已发起全额退款申请，请人工处理。${pinId}`.trim();
        }
        const pinId = order.refundRequestPinId ? ` 申请凭证：${order.refundRequestPinId}` : '';
        return `系统提示：服务订单已超时，已自动发起全额退款申请。${pinId}`.trim();
    }
    const refundTxid = order.refundTxid ? ` 退款 txid：${order.refundTxid}` : '';
    return `系统提示：退款已处理完成。${refundTxid}`.trim();
}
function buildSessionTrace(input) {
    const traceId = normalizeText(input.traceId);
    const exportRoot = normalizeText(input.exportRoot);
    const sessionId = normalizeText(input.session.id);
    if (!traceId) {
        throw new Error('Trace ID is required');
    }
    if (!exportRoot) {
        throw new Error('Export root is required');
    }
    if (!sessionId) {
        throw new Error('Session ID is required');
    }
    const safeTraceId = sanitizePathSegment(traceId, 'trace');
    const safeSessionId = sanitizePathSegment(sessionId, 'session');
    const transcriptMarkdownPath = node_path_1.default.join(exportRoot, 'chats', `${safeSessionId}.md`);
    const traceMarkdownPath = node_path_1.default.join(exportRoot, 'traces', `${safeTraceId}.md`);
    const traceJsonPath = node_path_1.default.join(exportRoot, 'traces', `${safeTraceId}.json`);
    return {
        traceId,
        channel: normalizeText(input.channel),
        createdAt: Number.isFinite(input.createdAt) ? Number(input.createdAt) : Date.now(),
        session: {
            id: sessionId,
            title: normalizeText(input.session.title) || null,
            type: normalizeText(input.session.type) || null,
            metabotId: Number.isFinite(input.session.metabotId)
                ? Number(input.session.metabotId)
                : null,
            peerGlobalMetaId: normalizeText(input.session.peerGlobalMetaId) || null,
            peerName: normalizeText(input.session.peerName) || null,
            externalConversationId: normalizeText(input.session.externalConversationId) || null,
        },
        order: input.order
            ? {
                id: normalizeText(input.order.id) || null,
                role: normalizeText(input.order.role) || null,
                serviceId: normalizeText(input.order.serviceId) || null,
                serviceName: normalizeText(input.order.serviceName) || null,
                paymentTxid: normalizeText(input.order.paymentTxid) || null,
                paymentCurrency: normalizeText(input.order.paymentCurrency) || null,
                paymentAmount: normalizeText(input.order.paymentAmount) || null,
            }
            : null,
        a2a: buildA2ATraceRecord(input.a2a),
        askMaster: buildAskMasterTraceRecord(input.askMaster),
        artifacts: {
            transcriptMarkdownPath,
            traceMarkdownPath,
            traceJsonPath,
        },
    };
}
