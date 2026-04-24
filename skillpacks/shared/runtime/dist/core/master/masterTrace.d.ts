import type { PublicStatus } from '../a2a/publicStatus';
import type { SessionTraceRecord } from '../chat/sessionTrace';
export type MasterTraceCanonicalStatus = 'discovered' | 'suggested' | 'awaiting_confirmation' | 'requesting_remote' | 'remote_received' | 'master_responded' | 'completed' | 'timed_out' | 'failed' | 'need_more_context';
export interface AskMasterTracePreviewSummary {
    userTask: string | null;
    question: string | null;
}
export interface AskMasterTraceResponseSummary {
    status: string | null;
    summary: string | null;
    followUpQuestion: string | null;
    errorCode: string | null;
}
export interface AskMasterTraceFailureSummary {
    code: string | null;
    message: string | null;
}
export interface AskMasterTraceAutoMetadata {
    reason: string | null;
    confidence: number | null;
    frictionMode: 'preview_confirm' | 'direct_send' | null;
    detectorVersion: string | null;
    selectedMasterTrusted: boolean | null;
    sensitivity: {
        isSensitive: boolean;
        reasons: string[];
    } | null;
}
export interface AskMasterTraceMetadata {
    flow: 'master';
    transport: 'simplemsg';
    canonicalStatus: MasterTraceCanonicalStatus | null;
    triggerMode: string | null;
    contextMode: string | null;
    confirmationMode: string | null;
    requestId: string | null;
    masterKind: string | null;
    servicePinId: string | null;
    providerGlobalMetaId: string | null;
    displayName: string | null;
    preview: AskMasterTracePreviewSummary | null;
    response: AskMasterTraceResponseSummary | null;
    failure: AskMasterTraceFailureSummary | null;
    auto: AskMasterTraceAutoMetadata | null;
}
export interface BuildMasterTraceMetadataInput {
    role?: string | null;
    canonicalStatus?: MasterTraceCanonicalStatus | string | null;
    latestEvent?: string | null;
    publicStatus?: PublicStatus | string | null;
    transport?: string | null;
    triggerMode?: string | null;
    contextMode?: string | null;
    confirmationMode?: string | null;
    requestId?: string | null;
    masterKind?: string | null;
    servicePinId?: string | null;
    providerGlobalMetaId?: string | null;
    displayName?: string | null;
    preview?: {
        userTask?: string | null;
        question?: string | null;
    } | null;
    response?: {
        status?: string | null;
        summary?: string | null;
        followUpQuestion?: string | null;
        errorCode?: string | null;
    } | null;
    failure?: {
        code?: string | null;
        message?: string | null;
    } | null;
    auto?: {
        reason?: string | null;
        confidence?: number | null;
        frictionMode?: 'preview_confirm' | 'direct_send' | string | null;
        detectorVersion?: string | null;
        selectedMasterTrusted?: boolean | null;
        sensitivity?: {
            isSensitive?: boolean | null;
            reasons?: string[] | null;
        } | null;
    } | null;
}
export interface MasterTraceView {
    traceId: string;
    flow: 'master';
    transport: 'simplemsg';
    role: string | null;
    displayName: string | null;
    masterKind: string | null;
    providerGlobalMetaId: string | null;
    servicePinId: string | null;
    requestId: string | null;
    canonicalStatus: MasterTraceCanonicalStatus | null;
    latestEvent: string | null;
    triggerMode: string | null;
    contextMode: string | null;
    confirmationMode: string | null;
    preview: AskMasterTracePreviewSummary | null;
    response: AskMasterTraceResponseSummary | null;
    failure: AskMasterTraceFailureSummary | null;
    auto: AskMasterTraceAutoMetadata | null;
    display: {
        title: string;
        statusText: string;
    };
    artifacts: SessionTraceRecord['artifacts'];
    trace: SessionTraceRecord;
}
export declare function buildMasterTraceMetadata(input: BuildMasterTraceMetadataInput): AskMasterTraceMetadata;
export declare function isAskMasterTrace(trace: SessionTraceRecord | null | undefined): boolean;
export declare function buildMasterTraceView(trace: SessionTraceRecord): MasterTraceView | null;
