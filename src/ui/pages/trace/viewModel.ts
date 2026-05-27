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
export type TraceDeliveryArtifactKind = 'image' | 'video' | 'audio' | 'file';

export interface TraceDeliveryArtifact {
  uri: string;
  pinId: string;
  kind: TraceDeliveryArtifactKind;
  fileName: string | null;
  extension: string | null;
  contentType: string | null;
  byteLength: number | null;
  sourceUrl: string;
  fallbackUrl: string;
  downloadUrl: string;
}

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
  peerName: string;
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
  deliveryArtifacts: TraceDeliveryArtifact[];
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
  peerName: string;
  servicePinId: string;
  callerGlobalMetaId: string;
  providerGlobalMetaId: string;
  messages: TraceSessionMessage[];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeByteLength(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeArtifactKind(value: unknown): TraceDeliveryArtifactKind {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'image' || normalized === 'video' || normalized === 'audio' || normalized === 'file'
    ? normalized
    : 'file';
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

function coerceDeliveryArtifact(value: unknown): TraceDeliveryArtifact | null {
  const record = coerceObject(value);
  if (!record) return null;

  const uri = normalizeText(record.uri);
  if (!uri) return null;

  return {
    uri,
    pinId: normalizeText(record.pinId),
    kind: normalizeArtifactKind(record.kind),
    fileName: normalizeNullableText(record.fileName),
    extension: normalizeNullableText(record.extension),
    contentType: normalizeNullableText(record.contentType),
    byteLength: normalizeByteLength(record.byteLength),
    sourceUrl: normalizeText(record.sourceUrl),
    fallbackUrl: normalizeText(record.fallbackUrl),
    downloadUrl: normalizeText(record.downloadUrl),
  };
}

function collectDeliveryArtifacts(item: Record<string, unknown>, metadata: Record<string, unknown> | null): TraceDeliveryArtifact[] {
  const deliveryPayload = coerceObject(metadata?.deliveryPayload);
  const sources = [
    item.artifacts,
    metadata?.deliveryArtifacts,
    deliveryPayload?.artifacts,
  ];
  const seen = new Set<string>();
  const artifacts: TraceDeliveryArtifact[] = [];

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

function normalizeTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value >= 1_000_000_000 && value < 1_000_000_000_000) return value * 1000;
  return value;
}

const ACTIVE_STATES = new Set<string>(['requesting_remote', 'remote_received', 'remote_executing']);
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

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
      const peerName = normalizeText(record.peerName);
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
        peerName,
        servicePinId,
        stateTone: isStale ? 'timeout' : getStateTone(state),
        stateLabel: isStale ? 'Timeout' : getStateLabel(state),
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
  const peerName = normalizeText(payload.peerName) || normalizeText(session.peerName);

  const topLevelItems = coerceArray(payload.transcriptItems);
  const inspector = coerceObject(payload.inspector);
  const rawItems = topLevelItems.length
    ? topLevelItems
    : coerceArray(inspector?.transcriptItems);
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
    peerName,
    servicePinId,
    callerGlobalMetaId,
    providerGlobalMetaId,
    messages,
  };
}
