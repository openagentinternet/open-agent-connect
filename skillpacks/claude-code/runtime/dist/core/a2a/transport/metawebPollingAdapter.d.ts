import type { A2ALoopCursor } from '../sessionStateStore';
import type { A2ACallerSessionTransportEvent, A2AProviderInboxTransportEvent, A2ATransportAdapter, PollCallerSessionsInput, PollProviderInboxInput } from './transportAdapter';
type MetaWebProviderInboxMessage = Partial<A2AProviderInboxTransportEvent> & {
    messageId?: unknown;
    kind?: unknown;
    traceId?: unknown;
    servicePinId?: unknown;
    callerGlobalMetaId?: unknown;
    providerGlobalMetaId?: unknown;
    externalConversationId?: unknown;
    userTask?: unknown;
    taskContext?: unknown;
    answer?: unknown;
    observedAt?: unknown;
    replyPinId?: unknown;
    rawMessage?: unknown;
};
type MetaWebCallerSessionMessage = Partial<A2ACallerSessionTransportEvent> & {
    messageId?: unknown;
    kind?: unknown;
    traceId?: unknown;
    servicePinId?: unknown;
    callerGlobalMetaId?: unknown;
    providerGlobalMetaId?: unknown;
    externalConversationId?: unknown;
    responseText?: unknown;
    question?: unknown;
    failureCode?: unknown;
    failureMessage?: unknown;
    observedAt?: unknown;
    replyPinId?: unknown;
    rawMessage?: unknown;
};
export interface MetaWebProviderInboxPage {
    messages?: MetaWebProviderInboxMessage[] | null;
    nextCursor?: A2ALoopCursor;
}
export interface MetaWebCallerSessionPage {
    messages?: MetaWebCallerSessionMessage[] | null;
    nextCursor?: A2ALoopCursor;
}
export interface MetaWebPollingTransportAdapterOptions {
    activePollIntervalMs?: number;
    idlePollIntervalMs?: number;
    fetchProviderInboxPage: (input: PollProviderInboxInput) => Promise<MetaWebProviderInboxPage>;
    fetchCallerSessionPage: (input: PollCallerSessionsInput) => Promise<MetaWebCallerSessionPage>;
}
export declare function createMetaWebPollingTransportAdapter(options: MetaWebPollingTransportAdapterOptions): A2ATransportAdapter;
export {};
