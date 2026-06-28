import { type MetabotCommandResult } from '../contracts/commandResult';
import type { MetaAppManifestInput } from './types';
export declare const METAAPP_PIN_ID_PATTERN: RegExp;
export declare const METAAPP_RUNTIME_OPTIONS: readonly ["browser", "android", "ios", "windows", "macOS", "linux"];
export type MetaAppRuntimeOption = typeof METAAPP_RUNTIME_OPTIONS[number];
export declare const METAAPP_CONTENT_TYPE_OPTIONS: readonly ["application/zip", "application/x-tar", "application/x-7z-compressed", "application/x-rar-compressed", "application/gzip", "application/json", "application/xml", "text/plain", "text/html", "text/css", "application/javascript", "application/pdf", "image/jpeg", "image/png", "image/gif", "image/svg+xml", "image/webp", "video/mp4", "video/webm", "audio/mpeg", "audio/wav", "application/octet-stream"];
export declare const METAAPP_CODE_TYPE_OPTIONS: readonly ["application/zip", "application/x-tar", "application/x-7z-compressed", "application/x-rar-compressed", "application/gzip", "application/json", "application/xml", "text/html", "text/css", "application/javascript"];
export declare function normalizeMetafileReference(value: unknown, fieldName: string): string;
export declare function normalizeMetafileReferenceList(value: unknown, fieldName: string): string[];
export declare function normalizeMetaAppImageReference(value: unknown, fieldName: string): string;
export declare function normalizeMetaAppImageReferenceList(value: unknown, fieldName: string): string[];
export declare function serializeMetaAppRuntime(value: unknown): string;
export declare function buildMetaAppProtocolPayload(input: Record<string, unknown>): MetaAppManifestInput;
export declare function buildMetaAppCreateWrite(payload: MetaAppManifestInput): {
    operation: 'create';
    path: '/protocols/metaapp';
    contentType: 'application/json';
    payload: string;
};
export declare function buildMetaAppModifyWrite(targetPinId: string, payload: MetaAppManifestInput): {
    operation: 'modify';
    path: string;
    contentType: 'application/json';
    payload: string;
};
export declare function buildMetaAppRevokeWrite(targetPinId: string): {
    operation: 'revoke';
    path: string;
};
export declare function metaAppFormFailure(error: unknown): MetabotCommandResult<never>;
export declare function metaAppFormSuccess(data: Record<string, unknown>): MetabotCommandResult<Record<string, unknown>>;
