export type A2ASessionRole = 'caller' | 'provider';
export type A2ASessionState = 'discovered' | 'awaiting_confirmation' | 'requesting_remote' | 'remote_received' | 'remote_executing' | 'completed' | 'manual_action_required' | 'remote_failed' | 'timeout';
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
export declare function buildSessionListViewModel(rawSessions: unknown[], now?: number): TraceSessionListItem[];
export declare function buildSessionDetailViewModel(payload: Record<string, unknown>): TraceSessionDetail | null;
