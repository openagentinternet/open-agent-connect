"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildConversationsPageViewModel = buildConversationsPageViewModel;
exports.buildConversationsPageViewModelRuntimeSource = buildConversationsPageViewModelRuntimeSource;
function normalizeText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
}
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function readArray(value) {
    return Array.isArray(value) ? value : [];
}
function normalizeTimestampMs(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value < 1_000_000_000_000 ? value * 1000 : value;
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
        }
        const dateMs = new Date(value).getTime();
        return Number.isFinite(dateMs) ? dateMs : 0;
    }
    return 0;
}
function formatTimestamp(value) {
    if (!Number.isFinite(value) || value <= 0)
        return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return '-';
    const pad = (part) => String(part).padStart(2, '0');
    return [
        date.getUTCFullYear(),
        pad(date.getUTCMonth() + 1),
        pad(date.getUTCDate()),
    ].join('-') + ' ' + [pad(date.getUTCHours()), pad(date.getUTCMinutes())].join(':');
}
function titleCase(value) {
    if (!value)
        return 'Unknown';
    return value
        .split(/[\s_-]+/u)
        .filter(Boolean)
        .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ') || 'Unknown';
}
function extractConversations(input) {
    if (Array.isArray(input.conversations))
        return input.conversations;
    const response = readObject(input.conversationsResponse);
    const data = readObject(response.data);
    return readArray(data.conversations).length > 0
        ? readArray(data.conversations)
        : readArray(response.conversations);
}
function extractMessages(input) {
    if (Array.isArray(input.messages))
        return input.messages;
    const response = readObject(input.messagesResponse);
    const data = readObject(response.data);
    return readArray(data.messages).length > 0
        ? readArray(data.messages)
        : readArray(response.messages);
}
function extractTraceSessions(input) {
    if (Array.isArray(input.traceSessions))
        return input.traceSessions;
    const response = readObject(input.traceSessionsResponse);
    const data = readObject(response.data);
    return readArray(data.sessions).length > 0
        ? readArray(data.sessions)
        : readArray(response.sessions);
}
function serviceConversationId(sessionId) {
    return `service-${sessionId}`;
}
function buildTraceHref(traceId) {
    return traceId ? `/ui/trace?traceId=${encodeURIComponent(traceId)}` : '';
}
function buildSessionHref(sessionId) {
    return sessionId ? `/ui/trace?sessionId=${encodeURIComponent(sessionId)}` : '';
}
function buildRefundHref(record) {
    const order = readObject(record.order);
    const source = Object.keys(order).length > 0 ? order : record;
    const orderId = normalizeText(source.id)
        || normalizeText(source.serviceOrderPinId)
        || normalizeText(source.orderReference)
        || normalizeText(record.refundOrderId)
        || normalizeText(record.orderId)
        || normalizeText(record.serviceOrderPinId);
    if (!orderId)
        return '';
    const status = normalizeText(source.status) || normalizeText(record.refundStatus) || normalizeText(record.status);
    const refundRequestPinId = normalizeText(source.refundRequestPinId) || normalizeText(record.refundRequestPinId);
    const requiresRefundAction = status === 'refund_pending'
        || Boolean(refundRequestPinId)
        || record.refundActionRequired === true
        || record.manualActionRequired === true;
    return requiresRefundAction ? `/ui/refund?orderId=${encodeURIComponent(orderId)}` : '';
}
function hasServiceConversationContext(record, order) {
    return Boolean(normalizeText(record.servicePinId)
        || normalizeText(record.serviceName)
        || normalizeText(record.displayName)
        || normalizeText(record.orderId)
        || normalizeText(record.serviceOrderPinId)
        || normalizeText(order.id)
        || normalizeText(order.servicePinId)
        || normalizeText(order.serviceName)
        || normalizeText(order.serviceOrderPinId)
        || normalizeText(order.orderReference));
}
function buildConversationSummary(row, selectedConversationId) {
    const record = readObject(row);
    const conversationId = normalizeText(record.conversationId) || normalizeText(record.id);
    const peerGlobalMetaId = normalizeText(record.peerGlobalMetaId) || normalizeText(record.peer);
    const peerLabel = normalizeText(record.peerName) || normalizeText(record.peerDisplayName) || peerGlobalMetaId || 'Unknown peer';
    const direction = normalizeText(record.lastDirection);
    const latestAt = normalizeTimestampMs(record.updatedAt || record.lastMessageAt || record.createdAt);
    const stateLabel = titleCase(normalizeText(record.state) || 'active');
    const turnCount = typeof record.turnCount === 'number' && Number.isFinite(record.turnCount)
        ? record.turnCount
        : Number(record.turnCount || 0);
    const normalizedTurnCount = Number.isFinite(turnCount) && turnCount >= 0 ? turnCount : 0;
    return {
        conversationId,
        peerLabel,
        peerGlobalMetaId,
        source: 'private_chat',
        latestText: `${titleCase(direction || 'private')} private chat with ${peerLabel}`,
        latestAt,
        latestAtLabel: formatTimestamp(latestAt),
        kinds: ['Chat'],
        stateLabel,
        turnCountLabel: `${normalizedTurnCount} ${normalizedTurnCount === 1 ? 'turn' : 'turns'}`,
        localBotLabel: normalizeText(record.localMetabotName) || normalizeText(record.localBotName),
        serviceName: '',
        traceHref: '',
        sessionHref: '',
        refundHref: '',
        advancedActions: [],
        isSelected: Boolean(selectedConversationId && conversationId === selectedConversationId),
    };
}
function buildServiceSummary(row, selectedConversationId) {
    const record = readObject(row);
    const sessionId = normalizeText(record.sessionId) || normalizeText(record.id);
    const conversationId = serviceConversationId(sessionId);
    const traceId = normalizeText(record.traceId);
    const peerGlobalMetaId = normalizeText(record.peerGlobalMetaId)
        || normalizeText(record.providerGlobalMetaId)
        || normalizeText(record.callerGlobalMetaId);
    const peerLabel = normalizeText(record.peerName)
        || normalizeText(record.providerName)
        || normalizeText(record.callerName)
        || peerGlobalMetaId
        || 'Remote Bot';
    const order = readObject(record.order);
    if (!sessionId || !hasServiceConversationContext(record, order)) {
        return null;
    }
    const serviceName = normalizeText(record.serviceName)
        || normalizeText(order.serviceName)
        || normalizeText(record.displayName)
        || normalizeText(record.servicePinId)
        || 'Service';
    const serviceText = serviceName === 'Service' ? 'Service session' : `${serviceName} service session`;
    const latestAt = normalizeTimestampMs(record.updatedAt || record.completedAt || record.createdAt);
    const traceHref = buildTraceHref(traceId);
    const sessionHref = buildSessionHref(sessionId);
    const refundHref = buildRefundHref(record);
    const advancedActions = [
        ...(traceHref ? [{ label: 'Trace', href: traceHref }] : []),
        ...(sessionHref ? [{ label: 'Session', href: sessionHref }] : []),
        ...(refundHref ? [{ label: 'Refund', href: refundHref }] : []),
    ];
    return {
        conversationId,
        peerLabel,
        peerGlobalMetaId,
        source: 'service_trace',
        latestText: `${serviceText} with ${peerLabel}`,
        latestAt,
        latestAtLabel: formatTimestamp(latestAt),
        kinds: ['Service'],
        stateLabel: titleCase(normalizeText(record.state) || 'service'),
        turnCountLabel: sessionId,
        localBotLabel: normalizeText(record.localMetabotName) || normalizeText(record.localBotName),
        serviceName,
        traceHref,
        sessionHref,
        refundHref,
        advancedActions,
        isSelected: Boolean(selectedConversationId && conversationId === selectedConversationId),
    };
}
function buildMessage(row) {
    const record = readObject(row);
    const direction = normalizeText(record.direction).toLowerCase();
    const timestamp = normalizeTimestampMs(record.timestamp || record.createdAt);
    return {
        messageId: normalizeText(record.messageId) || normalizeText(record.id) || normalizeText(record.messagePinId),
        directionLabel: direction === 'outbound' ? 'Bot' : 'Peer',
        content: normalizeText(record.content) || normalizeText(record.text) || normalizeText(record.body),
        timestampLabel: formatTimestamp(timestamp),
    };
}
function buildConversationsPageViewModel(input = {}) {
    const selectedInput = normalizeText(input.selectedConversationId);
    const privateSummaries = extractConversations(input)
        .map((row) => buildConversationSummary(row, normalizeText(input.selectedConversationId)))
        .filter((summary) => summary.conversationId);
    const serviceSummaries = extractTraceSessions(input)
        .map((row) => buildServiceSummary(row, selectedInput))
        .filter((summary) => Boolean(summary));
    const summaries = [...privateSummaries, ...serviceSummaries]
        .sort((left, right) => right.latestAt - left.latestAt);
    const selectedConversationId = selectedInput || (summaries[0] ? summaries[0].conversationId : '');
    const conversations = summaries.map((summary) => ({
        ...summary,
        isSelected: summary.conversationId === selectedConversationId,
    }));
    const selectedConversation = conversations.find((summary) => summary.isSelected) || null;
    const messages = selectedConversation?.source === 'private_chat'
        ? extractMessages(input)
            .filter((row) => {
            if (!selectedConversationId)
                return true;
            const record = readObject(row);
            const conversationId = normalizeText(record.conversationId);
            return !conversationId || conversationId === selectedConversationId;
        })
            .sort((left, right) => {
            const leftRecord = readObject(left);
            const rightRecord = readObject(right);
            return normalizeTimestampMs(leftRecord.timestamp || leftRecord.createdAt)
                - normalizeTimestampMs(rightRecord.timestamp || rightRecord.createdAt);
        })
            .map(buildMessage)
        : [];
    return {
        conversations,
        selectedConversation,
        messages,
        emptyState: {
            title: 'No conversations yet',
            message: 'Private chat conversations will appear here after your Bot receives or sends messages.',
        },
        detailEmptyState: {
            title: selectedConversation?.source === 'service_trace'
                ? 'Service conversation'
                : selectedConversation ? 'No messages yet' : 'Select a conversation',
            message: selectedConversation
                ? selectedConversation.source === 'service_trace'
                    ? 'Open Trace, Session, or Refund for the full service context.'
                    : 'Messages for this conversation will appear here.'
                : 'Choose a private chat thread from the conversation list.',
        },
    };
}
function buildConversationsPageViewModelRuntimeSource() {
    return [
        normalizeText,
        readObject,
        readArray,
        normalizeTimestampMs,
        formatTimestamp,
        titleCase,
        extractConversations,
        extractMessages,
        extractTraceSessions,
        serviceConversationId,
        buildTraceHref,
        buildSessionHref,
        buildRefundHref,
        hasServiceConversationContext,
        buildConversationSummary,
        buildServiceSummary,
        buildMessage,
        buildConversationsPageViewModel,
    ].map((fn) => fn.toString()).join('\n');
}
