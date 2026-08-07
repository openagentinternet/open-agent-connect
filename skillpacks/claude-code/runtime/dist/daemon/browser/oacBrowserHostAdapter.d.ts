import type { BrowserHostAdapter, BrowserLlmCompleteMessage, BrowserLlmCompleteResult } from '@openagentinternet/agent-browser-host-contract';
import { type BrowserNameAliasProvider } from '@openagentinternet/agent-browser-core';
import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { createMetaAppPreviewSessionRegistry } from '../../core/metaapp/previewSessions';
import { type AppSessionError, type AppSessionPublic, type AppSessionStartParams } from '../../core/appSession/types';
type MetaAppPreviewSessions = ReturnType<typeof createMetaAppPreviewSessionRegistry>;
type OacBrowserActionHandler = (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
type OacMetaIdPinWriteOperation = 'create' | 'modify' | 'revoke';
type OacMetaIdPinWritePayloadEncoding = 'utf-8' | 'base64';
/** The daemon-owned app session runtime surface the bridge may call. */
export interface OacAppSessionHost {
    validateStart(input: AppSessionStartParams & {
        resourceUri: string;
        actorId: string;
        actorGlobalMetaId: string;
    }): Promise<{
        ok: true;
        adapterHash: string;
    } | {
        ok: false;
        error: AppSessionError;
    }>;
    start(input: AppSessionStartParams & {
        resourceUri: string;
        actorId: string;
        actorGlobalMetaId: string;
    }): Promise<AppSessionPublic>;
    list(input: {
        resourceUri: string;
        actorId: string;
        actorGlobalMetaId: string;
        appId?: string;
        status?: string;
        groupId?: string;
    }): Promise<AppSessionPublic[]>;
    status(sessionId: string, actor: {
        resourceUri: string;
        actorId: string;
        actorGlobalMetaId: string;
    }): Promise<AppSessionPublic>;
    pause(sessionId: string, actor: {
        resourceUri: string;
        actorId: string;
        actorGlobalMetaId: string;
    }): Promise<AppSessionPublic>;
    resume(sessionId: string, actor: {
        resourceUri: string;
        actorId: string;
        actorGlobalMetaId: string;
    }): Promise<AppSessionPublic>;
    stop(sessionId: string, actor: {
        resourceUri: string;
        actorId: string;
        actorGlobalMetaId: string;
    }, options?: {
        releaseSeat?: boolean;
    }): Promise<AppSessionPublic>;
}
export interface OacBrowserMetaAppBridgeActor {
    uri: string;
    globalMetaId: string;
    name: string;
    avatarPinId?: string;
}
export interface OacBrowserMetaIdPinWriteRequest {
    operation: OacMetaIdPinWriteOperation;
    path: string;
    encryption: '0' | '1' | '2';
    version: string;
    contentType: string;
    encoding: OacMetaIdPinWritePayloadEncoding;
    payload: string;
    originalId?: string;
    appAction?: string;
}
export interface OacBrowserMetaIdPinWriteResult {
    pinId: string;
    txid?: string;
    txids?: string[];
    operation?: OacMetaIdPinWriteOperation;
    path?: string;
    actor?: OacBrowserMetaAppBridgeActor;
}
type OacBrowserMetaIdPinWriteHandler = (input: {
    actorId?: string;
    resourceUri: string;
    request: OacBrowserMetaIdPinWriteRequest;
}) => Promise<MetabotCommandResult<OacBrowserMetaIdPinWriteResult>>;
export interface OacBrowserMetaFileUploadEntry {
    /** Original file name selected by the host picker. */
    name: string;
    /** MIME type, inferred from the extension when omitted. */
    contentType?: string;
    /** Raw file bytes (host picker reads them from disk before posting). */
    data: Buffer;
}
export interface OacBrowserMetaFileUploadRequest {
    /** Whether the host file picker accepted multiple files. */
    multiple: boolean;
    /** Content-type accept hints from the MetaApp (e.g. ['image/*']). */
    accept: string[];
    /** Picked file entries to upload on chain. */
    entries: OacBrowserMetaFileUploadEntry[];
    /** Optional upload purpose label from the MetaApp. */
    purpose?: string;
}
export interface OacBrowserMetaFileUploadResult {
    files: Array<{
        pinId: string;
        uri: string;
        name: string;
        size: number;
        contentType: string;
        contentHash?: string;
        actor: OacBrowserMetaAppBridgeActor;
    }>;
}
type OacBrowserMetaFileUploadHandler = (input: {
    actorId?: string;
    resourceUri: string;
    request: OacBrowserMetaFileUploadRequest;
}) => Promise<MetabotCommandResult<OacBrowserMetaFileUploadResult>>;
export interface OacBrowserActorContext {
    homeDir: string;
}
export interface CreateOacBrowserHostAdapterInput {
    homeDir: string;
    systemHomeDir: string;
    resolveActorWriteContext: (rawActor: unknown) => Promise<OacBrowserActorContext | {
        failure: MetabotCommandResult<never>;
    }>;
    metaAppPreviewSessions: MetaAppPreviewSessions;
    privateChat?: OacBrowserActionHandler;
    serviceCall?: OacBrowserActionHandler;
    writeMetaIdPin?: OacBrowserMetaIdPinWriteHandler;
    uploadMetaFile?: OacBrowserMetaFileUploadHandler;
    appSession?: OacAppSessionHost;
    llmComplete?: (input: {
        actorId?: string;
        resourceUri: string;
        messages: BrowserLlmCompleteMessage[];
        options?: Record<string, unknown>;
        purpose?: string;
    }) => Promise<BrowserLlmCompleteResult>;
    audit?: (event: {
        type: string;
        actorId: string;
        resourceUri: string;
        sessionId?: string;
        paths?: string[];
        path?: string;
        [key: string]: unknown;
    }) => Promise<void> | void;
    fetch?: typeof fetch;
    env?: NodeJS.ProcessEnv;
    now?: () => number;
    confirmationTtlMs?: number;
    nameAliasProviders?: BrowserNameAliasProvider[];
    ensNameAliasProviderFactory?: (config: {
        chainId: 1;
        rpcUrls: string[];
        textKey: string;
    }) => BrowserNameAliasProvider;
    onInfrastructureSettingsUpdated?: () => Promise<void> | void;
}
export declare function createOacBrowserHostAdapter(input: CreateOacBrowserHostAdapterInput): BrowserHostAdapter;
export {};
