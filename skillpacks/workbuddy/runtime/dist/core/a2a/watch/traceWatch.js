"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTraceWatchEvents = buildTraceWatchEvents;
exports.serializeTraceWatchEvents = serializeTraceWatchEvents;
const watchEvents_1 = require("./watchEvents");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function buildTraceWatchEvents(input) {
    const traceId = normalizeText(input.traceId);
    if (!traceId) {
        return [];
    }
    const sessionIds = new Set(input.sessions
        .filter((session) => normalizeText(session.traceId) === traceId)
        .map((session) => normalizeText(session.sessionId))
        .filter(Boolean));
    if (sessionIds.size === 0) {
        return [];
    }
    const lastStatusBySession = new Map();
    const events = [];
    for (const snapshot of input.snapshots) {
        const sessionId = normalizeText(snapshot.sessionId);
        if (!sessionIds.has(sessionId) || !snapshot.mapped || !snapshot.status) {
            continue;
        }
        const status = snapshot.status;
        if (lastStatusBySession.get(sessionId) === status) {
            continue;
        }
        lastStatusBySession.set(sessionId, status);
        events.push({
            traceId,
            sessionId,
            taskRunId: normalizeText(snapshot.taskRunId) || null,
            status,
            terminal: (0, watchEvents_1.isTerminalTraceWatchStatus)(status),
            observedAt: normalizeNumber(snapshot.resolvedAt) ?? 0,
        });
        if ((0, watchEvents_1.isTerminalTraceWatchStatus)(status)) {
            break;
        }
    }
    return events;
}
function serializeTraceWatchEvents(events) {
    if (!events.length) {
        return '';
    }
    return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}
