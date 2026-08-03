import type { PublicStatus } from '../a2a/publicStatus';
import type { A2ASessionRole, A2ATaskRunState } from '../a2a/sessionTypes';
export interface SessionTraceSessionInput {
    id: string;
    title?: string | null;
    type?: string | null;
    metabotId?: number | null;
    peerGlobalMetaId?: string | null;
    peerName?: string | null;
    externalConversationId?: string | null;
}
export interface SessionTraceOrderInput {
    id?: string | null;
    role?: string | null;
    serviceId?: string | null;
    serviceName?: string | null;
    orderPinId?: string | null;
    orderTxid?: string | null;
    orderTxids?: string[] | null;
    paymentTxid?: string | null;
    paymentCommitTxid?: string | null;
    orderReference?: string | null;
    serviceOrderPinId?: string | null;
    paymentCurrency?: string | null;
    paymentAmount?: string | null;
    paymentChain?: string | null;
    settlementKind?: string | null;
    mrc20Ticker?: string | null;
    mrc20Id?: string | null;
    providerSkill?: string | null;
    providerSkills?: string[] | null;
    outputType?: string | null;
    requestText?: string | null;
    status?: string | null;
    firstResponseDeadlineAt?: number | null;
    deliveryDeadlineAt?: number | null;
    firstResponseReceivedAt?: number | null;
    failedAt?: number | null;
    failureReason?: string | null;
    refundRequestPinId?: string | null;
    refundRequestTxid?: string | null;
    refundRequestedAt?: number | null;
    refundCompletedAt?: number | null;
    refundFinalizePinId?: string | null;
    refundBlockingReason?: string | null;
    refundApplyRetryCount?: number | null;
    nextRetryAt?: number | null;
    refundTxid?: string | null;
    refundedAt?: number | null;
    updatedAt?: number | null;
}
export interface BuildSessionTraceInput {
    traceId: string;
    channel: string;
    exportRoot: string;
    createdAt?: number;
    session: SessionTraceSessionInput;
    order?: SessionTraceOrderInput | null;
    a2a?: SessionTraceA2AInput | null;
    providerRuntime?: SessionTraceProviderRuntimeInput | null;
}
export interface SessionTraceProviderRuntimeInput {
    runtimeId?: string | null;
    runtimeProvider?: string | null;
    sessionId?: string | null;
    providerSkill?: string | null;
    providerSkills?: string[] | null;
    fallbackSelected?: boolean | null;
}
export interface SessionTraceArtifacts {
    transcriptMarkdownPath: string;
    traceMarkdownPath: string;
    traceJsonPath: string;
}
export interface SessionTraceA2AInput {
    sessionId?: string | null;
    taskRunId?: string | null;
    role?: A2ASessionRole | string | null;
    publicStatus?: PublicStatus | string | null;
    latestEvent?: string | null;
    taskRunState?: A2ATaskRunState | string | null;
    callerGlobalMetaId?: string | null;
    callerName?: string | null;
    providerGlobalMetaId?: string | null;
    providerName?: string | null;
    servicePinId?: string | null;
}
export interface SessionTraceA2ARecord {
    sessionId: string | null;
    taskRunId: string | null;
    role: string | null;
    publicStatus: string | null;
    latestEvent: string | null;
    taskRunState: string | null;
    callerGlobalMetaId: string | null;
    callerName: string | null;
    providerGlobalMetaId: string | null;
    providerName: string | null;
    servicePinId: string | null;
}
export interface SessionTraceProviderRuntimeRecord {
    runtimeId: string | null;
    runtimeProvider: string | null;
    sessionId: string | null;
    providerSkill: string | null;
    providerSkills: string[];
    fallbackSelected: boolean | null;
}
export interface SessionTraceRecord {
    traceId: string;
    channel: string;
    createdAt: number;
    session: {
        id: string;
        title: string | null;
        type: string | null;
        metabotId: number | null;
        peerGlobalMetaId: string | null;
        peerName: string | null;
        externalConversationId: string | null;
    };
    order: {
        id: string | null;
        role: string | null;
        serviceId: string | null;
        serviceName: string | null;
        orderPinId: string | null;
        orderTxid: string | null;
        orderTxids: string[];
        paymentTxid: string | null;
        paymentCommitTxid: string | null;
        orderReference: string | null;
        serviceOrderPinId: string | null;
        paymentCurrency: string | null;
        paymentAmount: string | null;
        paymentChain: string | null;
        settlementKind: string | null;
        mrc20Ticker: string | null;
        mrc20Id: string | null;
        providerSkill?: string | null;
        providerSkills?: string[];
        outputType: string | null;
        requestText: string | null;
        status: string | null;
        firstResponseDeadlineAt: number | null;
        deliveryDeadlineAt: number | null;
        firstResponseReceivedAt: number | null;
        failedAt: number | null;
        failureReason: string | null;
        refundRequestPinId: string | null;
        refundRequestTxid: string | null;
        refundRequestedAt: number | null;
        refundCompletedAt: number | null;
        refundFinalizePinId: string | null;
        refundBlockingReason: string | null;
        refundApplyRetryCount: number | null;
        nextRetryAt: number | null;
        refundTxid: string | null;
        refundedAt: number | null;
        updatedAt: number | null;
    } | null;
    a2a: SessionTraceA2ARecord | null;
    providerRuntime: SessionTraceProviderRuntimeRecord | null;
    artifacts: SessionTraceArtifacts;
}
export type ServiceOrderObserverRole = 'buyer' | 'seller';
export interface BuildServiceOrderObserverConversationIdInput {
    role: ServiceOrderObserverRole;
    metabotId: number;
    peerGlobalMetaId: string;
    paymentTxid?: string | null;
}
export interface BuildServiceOrderFallbackPayloadInput {
    servicePaidTx?: string | null;
    servicePrice?: string | null;
    serviceCurrency?: string | null;
    serviceId?: string | null;
    serviceSkill?: string | null;
    peerGlobalMetaId?: string | null;
}
export interface ServiceOrderEventMessageInput {
    role: ServiceOrderObserverRole;
    refundRequestPinId?: string | null;
    refundTxid?: string | null;
}
export declare function buildServiceOrderObserverConversationId(input: BuildServiceOrderObserverConversationIdInput): string;
export declare function buildServiceOrderFallbackPayload(input: BuildServiceOrderFallbackPayloadInput): string;
export declare function buildServiceOrderEventMessage(type: 'refund_requested' | 'refunded', order: ServiceOrderEventMessageInput): string;
export declare function buildSessionTrace(input: BuildSessionTraceInput): SessionTraceRecord;
