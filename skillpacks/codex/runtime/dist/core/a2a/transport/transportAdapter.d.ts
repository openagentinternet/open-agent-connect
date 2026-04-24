import type { A2ALoopCursor } from '../sessionStateStore';
export type A2ATransportRole = 'caller' | 'provider';
export type A2ATransportPollMode = 'idle' | 'active';
export type A2ATransportSourceOfTruth = 'metaweb' | 'socket' | 'gateway' | 'hybrid';
export type A2ATransportDelivery = 'polling' | 'push' | 'hybrid';
export interface A2ATransportDescriptor {
    adapterId: string;
    sourceOfTruth: A2ATransportSourceOfTruth;
    delivery: A2ATransportDelivery;
}
export interface A2ATransportPollSchedule {
    mode: A2ATransportPollMode;
    intervalMs: number;
}
export interface A2ATransportSessionRef {
    sessionId: string;
    traceId: string;
    callerGlobalMetaId: string;
    providerGlobalMetaId: string;
    externalConversationId?: string | null;
}
export interface A2AProviderInboxTransportEvent {
    messageId: string;
    kind: 'task_request' | 'clarification_answer';
    traceId: string;
    servicePinId: string;
    callerGlobalMetaId: string;
    providerGlobalMetaId: string;
    externalConversationId: string | null;
    userTask: string | null;
    taskContext: string | null;
    answer: string | null;
    observedAt: number | null;
    replyPinId?: string | null;
    rawMessage?: Record<string, unknown> | null;
}
export interface A2ACallerSessionTransportEvent {
    messageId: string;
    kind: 'provider_received' | 'provider_completed' | 'provider_failed' | 'clarification_needed';
    traceId: string;
    servicePinId: string;
    callerGlobalMetaId: string;
    providerGlobalMetaId: string;
    externalConversationId: string | null;
    responseText: string | null;
    question: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    observedAt: number | null;
    replyPinId?: string | null;
    rawMessage?: Record<string, unknown> | null;
}
export interface A2ATransportPollResult<TEvent> {
    cursor: A2ALoopCursor;
    events: TEvent[];
    schedule: A2ATransportPollSchedule;
}
export interface GetTransportPollScheduleInput {
    role: A2ATransportRole;
    activeSessions: number;
}
export interface PollProviderInboxInput {
    cursor: A2ALoopCursor;
    providerGlobalMetaId: string;
    activeSessions: A2ATransportSessionRef[];
}
export interface PollCallerSessionsInput {
    cursor: A2ALoopCursor;
    callerGlobalMetaId: string;
    activeSessions: A2ATransportSessionRef[];
}
export interface A2ATransportAdapter {
    descriptor: A2ATransportDescriptor;
    getPollSchedule(input: GetTransportPollScheduleInput): A2ATransportPollSchedule;
    pollProviderInbox(input: PollProviderInboxInput): Promise<A2ATransportPollResult<A2AProviderInboxTransportEvent>>;
    pollCallerSessions(input: PollCallerSessionsInput): Promise<A2ATransportPollResult<A2ACallerSessionTransportEvent>>;
}
