export type A2ASessionRole = 'caller' | 'provider';
export type A2ASessionState = 'discovered' | 'awaiting_confirmation' | 'requesting_remote' | 'remote_received' | 'remote_executing' | 'completed' | 'manual_action_required' | 'remote_failed' | 'timeout';
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
export declare function buildSessionListViewModel(rawSessions: unknown[], now?: number): TraceSessionListItem[];
export declare function buildSessionDetailViewModel(payload: Record<string, unknown>): TraceSessionDetail | null;
