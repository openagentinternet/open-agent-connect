export interface A2ATraceProjectionProfile {
    name?: string | null;
    slug?: string | null;
    homeDir: string;
    globalMetaId?: string | null;
}
export interface A2ATraceProjectionDaemon {
    baseUrl?: string | null;
}
export interface UnifiedA2ATraceSessionListItem {
    source: 'unified_a2a';
    sessionKind: 'peer' | 'service_order' | string;
    sessionId: string;
    traceId: string;
    role: 'caller' | 'provider';
    state: string;
    createdAt: number;
    updatedAt: number;
    localMetabotName: string;
    localMetabotGlobalMetaId: string;
    localMetabotAvatar: string | null;
    peerGlobalMetaId: string;
    peerName: string | null;
    peerAvatar: string | null;
    callerGlobalMetaId: string;
    providerGlobalMetaId: string;
    servicePinId: string;
    serviceName: string | null;
    outputType: string | null;
    orderTxid: string | null;
    paymentTxid: string | null;
    localUiUrl?: string;
}
export interface UnifiedA2ATraceTranscriptItem {
    id: string;
    sessionId: string;
    taskRunId: null;
    timestamp: number;
    type: string;
    sender: 'caller' | 'provider' | 'system';
    content: string;
    metadata: Record<string, unknown>;
}
export interface UnifiedA2ATraceSessionDetail {
    source: 'unified_a2a';
    traceId: string;
    sessionId: string;
    session: Record<string, unknown>;
    transcriptItems: UnifiedA2ATraceTranscriptItem[];
    taskRuns: [];
    publicStatusSnapshots: Array<Record<string, unknown>>;
    order: Record<string, unknown> | null;
    orderPinId: string | null;
    orderTxid: string | null;
    orderTxids: string[];
    paymentTxid: string | null;
    localUiUrl?: string;
    a2a: Record<string, unknown>;
    artifacts: {
        transcriptMarkdownPath: null;
        traceMarkdownPath: null;
        traceJsonPath: null;
    };
    resultText: string | null;
    responseText: string | null;
    resultObservedAt: number | null;
    resultDeliveryPinId: string | null;
    ratingRequestText: string | null;
    ratingRequestedAt: number | null;
    ratingRequested: boolean;
    ratingPublished: boolean;
    ratingPinId: string | null;
    ratingValue: number | null;
    ratingComment: string | null;
    ratingCreatedAt: number | null;
    ratingMessageSent: boolean | null;
    ratingMessagePinId: string | null;
    ratingMessageError: string | null;
    tStageCompleted: boolean;
    ratingSyncState: null;
    ratingSyncError: null;
    inspector: {
        session: Record<string, unknown>;
        sessions: Array<Record<string, unknown>>;
        taskRuns: [];
        transcriptItems: UnifiedA2ATraceTranscriptItem[];
        publicStatusSnapshots: Array<Record<string, unknown>>;
        transcriptMarkdown: null;
        traceMarkdown: null;
        conversationFilePath: string;
    };
    localMetabotName: string;
    localMetabotGlobalMetaId: string;
    localMetabotAvatar: string | null;
    peerGlobalMetaId: string;
    peerName: string | null;
    peerAvatar: string | null;
}
export declare function listUnifiedA2ATraceSessionsForProfile(input: {
    profile: A2ATraceProjectionProfile;
    daemon?: A2ATraceProjectionDaemon | null;
}): Promise<UnifiedA2ATraceSessionListItem[]>;
export declare function getUnifiedA2ATraceSessionForProfile(input: {
    profile: A2ATraceProjectionProfile;
    sessionId: string;
    daemon?: A2ATraceProjectionDaemon | null;
}): Promise<UnifiedA2ATraceSessionDetail | null>;
export declare function findUnifiedA2ATraceSessionForProfileByOrder(input: {
    profile: A2ATraceProjectionProfile;
    orderTxid?: string | null;
    paymentTxid?: string | null;
    daemon?: A2ATraceProjectionDaemon | null;
}): Promise<UnifiedA2ATraceSessionDetail | null>;
