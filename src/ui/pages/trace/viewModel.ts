// View models for the A2A Trace page session list and session detail

export type A2ASessionRole = 'caller' | 'provider';
export type A2ASessionState =
  | 'discovered'
  | 'awaiting_confirmation'
  | 'requesting_remote'
  | 'remote_received'
  | 'remote_executing'
  | 'completed'
  | 'manual_action_required'
  | 'remote_failed'
  | 'timeout';

export type A2ATranscriptSender = 'caller' | 'provider' | 'system';
export type MessageTone = 'local' | 'peer' | 'system' | 'tool';

export interface TraceSessionListItem {
  sessionId: string;
  traceId: string;
  role: A2ASessionRole;
  state: A2ASessionState;
  createdAt: number;
  updatedAt: number;
  localMetabotName: string;
  localMetabotGlobalMetaId: string;
  peerGlobalMetaId: string;
  servicePinId: string;
  stateTone: 'active' | 'completed' | 'failure' | 'timeout' | 'manual' | 'neutral';
  stateLabel: string;
  timeAgoMs: number;
}

export interface TraceSessionMessage {
  id: string;
  sessionId: string;
  taskRunId: string | null;
  timestamp: number;
  type: string;
  sender: A2ATranscriptSender;
  content: string;
  metadata: Record<string, unknown> | null;
  tone: MessageTone;
}

export interface TraceSessionDetail {
  sessionId: string;
  traceId: string;
  role: A2ASessionRole;
  state: A2ASessionState;
  createdAt: number;
  updatedAt: number;
  localMetabotName: string;
  localMetabotGlobalMetaId: string;
  peerGlobalMetaId: string;
  servicePinId: string;
  callerGlobalMetaId: string;
  providerGlobalMetaId: string;
  messages: TraceSessionMessage[];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function coerceArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)) as Array<Record<string, unknown>>
    : [];
}

function coerceObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value >= 1_000_000_000 && value < 1_000_000_000_000) return value * 1000;
  return value;
}

function getStateTone(state: string): TraceSessionListItem['stateTone'] {
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

function getStateLabel(state: string): string {
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

function getMessageTone(
  sender: A2ATranscriptSender,
  role: A2ASessionRole,
  type: string,
): MessageTone {
  if (sender === 'system') return 'system';
  if (type === 'tool_use' || type === 'tool_result') return 'tool';
  if (sender === role) return 'local';
  return 'peer';
}

export function buildSessionListViewModel(
  rawSessions: unknown[],
  now = Date.now(),
): TraceSessionListItem[] {
  return rawSessions
    .map((entry) => {
      const record = coerceObject(entry);
      if (!record) return null;

      const sessionId = normalizeText(record.sessionId);
      if (!sessionId) return null;

      const traceId = normalizeText(record.traceId);
      const role = (normalizeText(record.role) || 'caller') as A2ASessionRole;
      const state = normalizeText(record.state) as A2ASessionState;
      const createdAt = normalizeTimestamp(record.createdAt);
      const updatedAt = normalizeTimestamp(record.updatedAt);
      const localMetabotName = normalizeText(record.localMetabotName);
      const localMetabotGlobalMetaId = normalizeText(record.localMetabotGlobalMetaId);
      const peerGlobalMetaId = normalizeText(record.peerGlobalMetaId);
      const servicePinId = normalizeText(record.servicePinId);

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
        stateTone: getStateTone(state),
        stateLabel: getStateLabel(state),
        timeAgoMs: now - updatedAt,
      } satisfies TraceSessionListItem;
    })
    .filter((item): item is TraceSessionListItem => item !== null);
}

export function buildSessionDetailViewModel(
  payload: Record<string, unknown>,
): TraceSessionDetail | null {
  const session = coerceObject(payload.session);
  if (!session) return null;

  const sessionId = normalizeText(session.sessionId);
  const traceId = normalizeText(session.traceId);
  const role = (normalizeText(session.role) || 'caller') as A2ASessionRole;
  const state = normalizeText(session.state) as A2ASessionState;
  const createdAt = normalizeTimestamp(session.createdAt);
  const updatedAt = normalizeTimestamp(session.updatedAt);
  const callerGlobalMetaId = normalizeText(session.callerGlobalMetaId);
  const providerGlobalMetaId = normalizeText(session.providerGlobalMetaId);
  const servicePinId = normalizeText(session.servicePinId);
  const localMetabotName = normalizeText(payload.localMetabotName);
  const localMetabotGlobalMetaId = normalizeText(payload.localMetabotGlobalMetaId);
  const peerGlobalMetaId = normalizeText(payload.peerGlobalMetaId);

  const rawItems = coerceArray(payload.transcriptItems);
  const messages: TraceSessionMessage[] = rawItems
    .map((item) => {
      const id = normalizeText(item.id);
      if (!id) return null;
      const type = normalizeText(item.type) || 'message';
      const sender = (normalizeText(item.sender) || 'system') as A2ATranscriptSender;
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
      } satisfies TraceSessionMessage;
    })
    .filter((m): m is TraceSessionMessage => m !== null)
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
