import type { A2APublicStatusSnapshot } from '../sessionStateStore';
import type { A2ASessionRecord } from '../sessionTypes';
import type { TraceWatchEvent } from './watchEvents';
import { isTerminalTraceWatchStatus } from './watchEvents';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function buildTraceWatchEvents(input: {
  traceId: string;
  sessions: A2ASessionRecord[];
  snapshots: A2APublicStatusSnapshot[];
}): TraceWatchEvent[] {
  const traceId = normalizeText(input.traceId);
  if (!traceId) {
    return [];
  }

  const sessionIds = new Set(
    input.sessions
      .filter((session) => normalizeText(session.traceId) === traceId)
      .map((session) => normalizeText(session.sessionId))
      .filter(Boolean),
  );
  if (sessionIds.size === 0) {
    return [];
  }

  const lastStatusBySession = new Map<string, string>();
  const events: TraceWatchEvent[] = [];

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
      terminal: isTerminalTraceWatchStatus(status),
      observedAt: normalizeNumber(snapshot.resolvedAt) ?? 0,
    });

    if (isTerminalTraceWatchStatus(status)) {
      break;
    }
  }

  return events;
}

export function serializeTraceWatchEvents(events: TraceWatchEvent[]): string {
  if (!events.length) {
    return '';
  }

  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}
