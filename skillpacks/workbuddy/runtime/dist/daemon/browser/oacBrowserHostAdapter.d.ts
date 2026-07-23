import type { BrowserHostAdapter } from '@openagentinternet/agent-browser-host-contract';
import { type BrowserNameAliasProvider } from '@openagentinternet/agent-browser-core';
import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { createMetaAppPreviewSessionRegistry } from '../../core/metaapp/previewSessions';
type MetaAppPreviewSessions = ReturnType<typeof createMetaAppPreviewSessionRegistry>;
type OacBrowserActionHandler = (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
type OacMetaIdPinWriteOperation = 'create' | 'modify' | 'revoke';
type OacMetaIdPinWritePayloadEncoding = 'utf-8' | 'base64';
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
