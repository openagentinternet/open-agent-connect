import type { MetabotCommandResult } from '../contracts/commandResult';
import type { BrowserResolveResult } from './types';
export type BrowserHostKind = 'standalone' | 'oac' | 'idbots';
export type BrowserActorKind = 'oac-bot' | 'idbots-agent' | 'wallet';
export type BrowserActorCapability = 'private-chat' | 'service-call' | 'wallet-sign' | 'payment' | 'template-settings' | 'profile-management' | 'chat-configuration' | 'resource-sharing' | 'message-view';
export interface BrowserActor {
    id: string;
    label: string;
    kind: BrowserActorKind;
    globalMetaId?: string;
    address?: string;
    avatar?: string;
    isDefault: boolean;
    capabilities: BrowserActorCapability[];
}
export interface BrowserRuntimeSnapshot {
    host: {
        kind: BrowserHostKind;
        name: string;
        localMode: boolean;
        publicBaseUrl?: string;
    };
    actors: BrowserActor[];
    defaultActor: BrowserActor | null;
    defaultUri: string | null;
    features: {
        privateChat: boolean;
        serviceCall: boolean;
        cacheManagement: boolean;
        templateSettings: boolean;
        walletLogin: boolean;
    };
    labels: {
        actorChip: string;
        noActorTitle: string;
        noActorBody: string;
        noActorAction?: {
            label: string;
            href: string;
        };
    };
}
export interface BrowserActorInput {
    actorId?: string;
    from?: string;
}
export type BrowserRuntimeInput = BrowserActorInput;
export interface BrowserResolveInput extends BrowserActorInput {
    uri: string;
}
export type BrowserSettingsInput = BrowserActorInput;
export interface BrowserSettingsUpdateInput extends BrowserActorInput {
    browser?: Record<string, unknown>;
}
export type BrowserCacheInput = BrowserActorInput;
export interface BrowserCacheClearInput extends BrowserActorInput {
    scope?: string;
    pinId?: string;
    cacheKey?: string;
}
export type BrowserCacheSnapshot = Record<string, unknown>;
export type BrowserCacheClearResult = Record<string, unknown>;
export interface BrowserSettingsSnapshot {
    browser: Record<string, unknown>;
    effectiveBrowser: Record<string, unknown>;
    defaults: Record<string, unknown>;
    configPath?: string;
}
export type BrowserTrustedActionKind = 'private-chat' | 'service-call' | 'copy-uri' | 'open-settings' | 'login' | 'edit-profile' | 'configure-chat' | 'view-messages' | 'wallet-sign' | 'payment' | 'open-conversation' | 'share-resource';
export interface BrowserOpenConversationPayload {
    conversationUri: string;
    peerGlobalMetaId: string;
    peerName?: string;
    initialComposerText?: string;
}
export interface BrowserTrustedActionInput extends BrowserActorInput {
    resourceUri: string;
    kind: BrowserTrustedActionKind;
    payload?: Record<string, unknown>;
}
export interface BrowserTrustedActionResult {
    kind: BrowserTrustedActionKind;
    handled: boolean;
    data?: {
        href?: string;
        route?: string;
        copiedText?: string;
        message?: string;
    };
}
export interface BrowserHostAdapter {
    getRuntime(input?: BrowserRuntimeInput): Promise<MetabotCommandResult<BrowserRuntimeSnapshot>>;
    resolveResource(input: BrowserResolveInput): Promise<MetabotCommandResult<BrowserResolveResult>>;
    getSettings(input?: BrowserSettingsInput): Promise<MetabotCommandResult<BrowserSettingsSnapshot>>;
    updateSettings(input: BrowserSettingsUpdateInput): Promise<MetabotCommandResult<BrowserSettingsSnapshot>>;
    getCache(input?: BrowserCacheInput): Promise<MetabotCommandResult<BrowserCacheSnapshot>>;
    clearCache(input: BrowserCacheClearInput): Promise<MetabotCommandResult<BrowserCacheClearResult>>;
    runTrustedAction(input: BrowserTrustedActionInput): Promise<MetabotCommandResult<BrowserTrustedActionResult>>;
}
