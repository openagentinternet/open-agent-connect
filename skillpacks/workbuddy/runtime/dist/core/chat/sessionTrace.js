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
function normalizeTextList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value.map((entry) => normalizeText(entry)).filter(Boolean))];
}
function normalizeOptionalNumber(value) {
    if (value === null || value === undefined || normalizeText(value) === '') {
        return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
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
function buildProviderRuntimeTraceRecord(input) {
    if (!input) {
        return null;
    }
    const record = {
        runtimeId: normalizeText(input.runtimeId) || null,
        runtimeProvider: normalizeText(input.runtimeProvider) || null,
        sessionId: normalizeText(input.sessionId) || null,
        providerSkill: normalizeText(input.providerSkill) || null,
        providerSkills: normalizeTextList(input.providerSkills),
        fallbackSelected: typeof input.fallbackSelected === 'boolean' ? input.fallbackSelected : null,
    };
    return Object.values(record).some((value) => (Array.isArray(value) ? value.length > 0 : value !== null && value !== '')) ? record : null;
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
                orderPinId: normalizeText(input.order.orderPinId) || null,
                orderTxid: normalizeText(input.order.orderTxid) || null,
                orderTxids: Array.isArray(input.order.orderTxids)
                    ? input.order.orderTxids.map((entry) => normalizeText(entry)).filter(Boolean)
                    : [],
                paymentTxid: normalizeText(input.order.paymentTxid) || null,
                paymentCommitTxid: normalizeText(input.order.paymentCommitTxid) || null,
                orderReference: normalizeText(input.order.orderReference) || null,
                serviceOrderPinId: normalizeText(input.order.serviceOrderPinId) || null,
                paymentCurrency: normalizeText(input.order.paymentCurrency) || null,
                paymentAmount: normalizeText(input.order.paymentAmount) || null,
                paymentChain: normalizeText(input.order.paymentChain) || null,
                settlementKind: normalizeText(input.order.settlementKind) || null,
                mrc20Ticker: normalizeText(input.order.mrc20Ticker) || null,
                mrc20Id: normalizeText(input.order.mrc20Id) || null,
                providerSkill: normalizeText(input.order.providerSkill) || null,
                providerSkills: normalizeTextList(input.order.providerSkills),
                outputType: normalizeText(input.order.outputType) || null,
                requestText: normalizeText(input.order.requestText) || null,
                status: normalizeText(input.order.status) || null,
                failedAt: normalizeOptionalNumber(input.order.failedAt),
                failureReason: normalizeText(input.order.failureReason) || null,
                refundRequestPinId: normalizeText(input.order.refundRequestPinId) || null,
                refundRequestTxid: normalizeText(input.order.refundRequestTxid) || null,
                refundRequestedAt: normalizeOptionalNumber(input.order.refundRequestedAt),
                refundCompletedAt: normalizeOptionalNumber(input.order.refundCompletedAt),
                refundFinalizePinId: normalizeText(input.order.refundFinalizePinId) || null,
                refundBlockingReason: normalizeText(input.order.refundBlockingReason) || null,
                refundApplyRetryCount: normalizeOptionalNumber(input.order.refundApplyRetryCount),
                nextRetryAt: normalizeOptionalNumber(input.order.nextRetryAt),
                refundTxid: normalizeText(input.order.refundTxid) || null,
                refundedAt: normalizeOptionalNumber(input.order.refundedAt),
                updatedAt: normalizeOptionalNumber(input.order.updatedAt),
            }
            : null,
        a2a: buildA2ATraceRecord(input.a2a),
        providerRuntime: buildProviderRuntimeTraceRecord(input.providerRuntime),
        artifacts: {
            transcriptMarkdownPath,
            traceMarkdownPath,
            traceJsonPath,
        },
    };
}
