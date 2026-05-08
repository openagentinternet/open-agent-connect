import type { PublicStatus } from '../a2a/publicStatus';
import type { A2ASessionRole, A2ATaskRunState } from '../a2a/sessionTypes';
import type { AskMasterTraceMetadata } from '../master/masterTrace';
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
    paymentCurrency?: string | null;
    paymentAmount?: string | null;
    paymentChain?: string | null;
    settlementKind?: string | null;
    mrc20Ticker?: string | null;
    mrc20Id?: string | null;
    providerSkill?: string | null;
    outputType?: string | null;
    requestText?: string | null;
    status?: string | null;
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
    askMaster?: SessionTraceAskMasterInput | null;
}
export interface SessionTraceProviderRuntimeInput {
    runtimeId?: string | null;
    runtimeProvider?: string | null;
    sessionId?: string | null;
    providerSkill?: string | null;
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
    fallbackSelected: boolean | null;
}
export interface SessionTraceAskMasterInput extends AskMasterTraceMetadata {
}
export interface SessionTraceAskMasterRecord {
    flow: 'master';
    transport: string | null;
    canonicalStatus: string | null;
    triggerMode: string | null;
    contextMode: string | null;
    confirmationMode: string | null;
    requestId: string | null;
    masterKind: string | null;
    servicePinId: string | null;
    providerGlobalMetaId: string | null;
    displayName: string | null;
    preview: {
        userTask: string | null;
        question: string | null;
    } | null;
    response: {
        status: string | null;
        summary: string | null;
        followUpQuestion: string | null;
        errorCode: string | null;
    } | null;
    failure: {
        code: string | null;
        message: string | null;
    } | null;
    auto: {
        reason: string | null;
        confidence: number | null;
        frictionMode: 'preview_confirm' | 'direct_send' | null;
        detectorVersion: string | null;
        selectedMasterTrusted: boolean | null;
        sensitivity: {
            isSensitive: boolean;
            reasons: string[];
        } | null;
    } | null;
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
        paymentCurrency: string | null;
        paymentAmount: string | null;
        paymentChain: string | null;
        settlementKind: string | null;
        mrc20Ticker: string | null;
        mrc20Id: string | null;
        providerSkill?: string | null;
        outputType: string | null;
        requestText: string | null;
        status: string | null;
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
    askMaster: SessionTraceAskMasterRecord | null;
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
