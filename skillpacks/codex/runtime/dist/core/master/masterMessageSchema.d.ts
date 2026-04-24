export declare const MASTER_MESSAGE_VERSION = "1.0.0";
export declare const MASTER_REQUEST_TYPE = "master_request";
export declare const MASTER_RESPONSE_TYPE = "master_response";
export type MasterTriggerMode = 'manual' | 'suggest' | 'auto';
export type MasterResponseStatus = 'completed' | 'need_more_context' | 'declined' | 'unavailable' | 'failed';
export interface MasterMessageArtifact {
    kind: string;
    label: string;
    content: string;
    mimeType: string | null;
}
export interface MasterRequestMessage {
    type: typeof MASTER_REQUEST_TYPE;
    version: string;
    requestId: string;
    traceId: string;
    caller: {
        globalMetaId: string;
        name: string | null;
        host: string;
    };
    target: {
        masterServicePinId: string;
        providerGlobalMetaId: string;
        masterKind: string;
    };
    task: {
        userTask: string;
        question: string;
    };
    context: {
        workspaceSummary: string | null;
        relevantFiles: string[];
        artifacts: MasterMessageArtifact[];
    };
    trigger: {
        mode: MasterTriggerMode;
        reason: string | null;
    };
    desiredOutput: string | null;
    extensions: Record<string, unknown> | null;
}
export interface MasterResponseMessage {
    type: typeof MASTER_RESPONSE_TYPE;
    version: string;
    requestId: string;
    traceId: string;
    responder: {
        providerGlobalMetaId: string;
        masterServicePinId: string;
        masterKind: string;
    };
    status: MasterResponseStatus;
    summary: string;
    responseText: string | null;
    structuredData: Record<string, unknown>;
    followUpQuestion: string | null;
    errorCode: string | null;
    extensions: Record<string, unknown> | null;
}
interface ParseSuccess<T> {
    ok: true;
    value: T;
}
interface ParseFailure {
    ok: false;
    code: 'invalid_master_message_json' | 'invalid_master_message_type' | 'invalid_master_message_version' | 'invalid_master_request' | 'invalid_master_response';
    message: string;
}
export type MasterRequestParseResult = ParseSuccess<MasterRequestMessage> | ParseFailure;
export type MasterResponseParseResult = ParseSuccess<MasterResponseMessage> | ParseFailure;
export declare function parseMasterRequest(value: unknown): MasterRequestParseResult;
export declare function parseMasterResponse(value: unknown): MasterResponseParseResult;
export declare function buildMasterRequestJson(value: unknown): string;
export declare function buildMasterResponseJson(value: unknown): string;
export {};
