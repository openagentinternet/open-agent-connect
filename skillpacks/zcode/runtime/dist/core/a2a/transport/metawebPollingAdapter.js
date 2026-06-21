"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMetaWebPollingTransportAdapter = createMetaWebPollingTransportAdapter;
const DEFAULT_ACTIVE_POLL_INTERVAL_MS = 2_000;
const DEFAULT_IDLE_POLL_INTERVAL_MS = 10_000;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeCursor(nextCursor, fallback) {
    if (typeof nextCursor === 'string') {
        return nextCursor.trim() || fallback;
    }
    if (typeof nextCursor === 'number') {
        return Number.isFinite(nextCursor) ? nextCursor : fallback;
    }
    return nextCursor === null ? null : fallback;
}
function normalizeObservedAt(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function normalizeRawMessage(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function matchesSession(message, session) {
    return (normalizeText(session.traceId) === message.traceId
        || (normalizeText(session.externalConversationId) !== ''
            && normalizeText(session.externalConversationId) === normalizeText(message.externalConversationId)));
}
function matchesAnyActiveSession(message, activeSessions) {
    return activeSessions.some((session) => matchesSession(message, session));
}
function normalizeProviderInboxEvent(message) {
    const kind = normalizeText(message.kind);
    if (kind !== 'task_request' && kind !== 'clarification_answer') {
        return null;
    }
    const messageId = normalizeText(message.messageId);
    const traceId = normalizeText(message.traceId);
    const servicePinId = normalizeText(message.servicePinId);
    const callerGlobalMetaId = normalizeText(message.callerGlobalMetaId);
    const providerGlobalMetaId = normalizeText(message.providerGlobalMetaId);
    if (!messageId || !traceId || !servicePinId || !callerGlobalMetaId || !providerGlobalMetaId) {
        return null;
    }
    return {
        messageId,
        kind,
        traceId,
        servicePinId,
        callerGlobalMetaId,
        providerGlobalMetaId,
        externalConversationId: normalizeText(message.externalConversationId) || null,
        userTask: normalizeText(message.userTask) || null,
        taskContext: normalizeText(message.taskContext) || null,
        answer: normalizeText(message.answer) || null,
        observedAt: normalizeObservedAt(message.observedAt),
        replyPinId: normalizeText(message.replyPinId) || null,
        rawMessage: normalizeRawMessage(message.rawMessage),
    };
}
function normalizeCallerSessionEvent(message) {
    const kind = normalizeText(message.kind);
    if (kind !== 'provider_received'
        && kind !== 'provider_completed'
        && kind !== 'provider_failed'
        && kind !== 'clarification_needed') {
        return null;
    }
    const messageId = normalizeText(message.messageId);
    const traceId = normalizeText(message.traceId);
    const servicePinId = normalizeText(message.servicePinId);
    const callerGlobalMetaId = normalizeText(message.callerGlobalMetaId);
    const providerGlobalMetaId = normalizeText(message.providerGlobalMetaId);
    if (!messageId || !traceId || !servicePinId || !callerGlobalMetaId || !providerGlobalMetaId) {
        return null;
    }
    return {
        messageId,
        kind,
        traceId,
        servicePinId,
        callerGlobalMetaId,
        providerGlobalMetaId,
        externalConversationId: normalizeText(message.externalConversationId) || null,
        responseText: normalizeText(message.responseText) || null,
        question: normalizeText(message.question) || null,
        failureCode: normalizeText(message.failureCode) || null,
        failureMessage: normalizeText(message.failureMessage) || null,
        observedAt: normalizeObservedAt(message.observedAt),
        replyPinId: normalizeText(message.replyPinId) || null,
        rawMessage: normalizeRawMessage(message.rawMessage),
    };
}
function createMetaWebPollingTransportAdapter(options) {
    const activePollIntervalMs = Number.isFinite(options.activePollIntervalMs)
        ? Math.max(250, Math.floor(options.activePollIntervalMs))
        : DEFAULT_ACTIVE_POLL_INTERVAL_MS;
    const idlePollIntervalMs = Number.isFinite(options.idlePollIntervalMs)
        ? Math.max(activePollIntervalMs, Math.floor(options.idlePollIntervalMs))
        : DEFAULT_IDLE_POLL_INTERVAL_MS;
    const getPollSchedule = (input) => {
        const activeSessions = Number.isFinite(input.activeSessions)
            ? Math.max(0, Math.floor(input.activeSessions))
            : 0;
        if (activeSessions > 0) {
            return {
                mode: 'active',
                intervalMs: activePollIntervalMs,
            };
        }
        return {
            mode: 'idle',
            intervalMs: idlePollIntervalMs,
        };
    };
    const pollProviderInbox = async (input) => {
        const schedule = getPollSchedule({
            role: 'provider',
            activeSessions: input.activeSessions.length,
        });
        const page = await options.fetchProviderInboxPage({
            cursor: input.cursor,
            providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
            activeSessions: input.activeSessions,
        });
        const providerGlobalMetaId = normalizeText(input.providerGlobalMetaId);
        const events = (page.messages ?? [])
            .map((message) => normalizeProviderInboxEvent(message))
            .filter((event) => Boolean(event))
            .filter((event) => {
            if (event.providerGlobalMetaId !== providerGlobalMetaId) {
                return false;
            }
            if (event.kind === 'task_request') {
                return true;
            }
            return matchesAnyActiveSession(event, input.activeSessions);
        });
        return {
            cursor: normalizeCursor(page.nextCursor, input.cursor),
            events,
            schedule,
        };
    };
    const pollCallerSessions = async (input) => {
        const schedule = getPollSchedule({
            role: 'caller',
            activeSessions: input.activeSessions.length,
        });
        if (input.activeSessions.length === 0) {
            return {
                cursor: input.cursor,
                events: [],
                schedule,
            };
        }
        const page = await options.fetchCallerSessionPage({
            cursor: input.cursor,
            callerGlobalMetaId: normalizeText(input.callerGlobalMetaId),
            activeSessions: input.activeSessions,
        });
        const callerGlobalMetaId = normalizeText(input.callerGlobalMetaId);
        const events = (page.messages ?? [])
            .map((message) => normalizeCallerSessionEvent(message))
            .filter((event) => Boolean(event))
            .filter((event) => (event.callerGlobalMetaId === callerGlobalMetaId
            && matchesAnyActiveSession(event, input.activeSessions)));
        return {
            cursor: normalizeCursor(page.nextCursor, input.cursor),
            events,
            schedule,
        };
    };
    return {
        descriptor: {
            adapterId: 'metaweb_polling',
            sourceOfTruth: 'metaweb',
            delivery: 'polling',
        },
        getPollSchedule,
        pollProviderInbox,
        pollCallerSessions,
    };
}
