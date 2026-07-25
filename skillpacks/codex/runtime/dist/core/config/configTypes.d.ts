import { type BotHomepageTemplateId, type BrowserNameResolutionConfig } from '@openagentinternet/agent-browser-core';
export interface A2AConfig {
    simplemsgListenerEnabled: boolean;
}
export interface AutoReplyConfig {
    enabled: boolean;
    maxTurns: number;
    cooldownMs: number;
}
export declare const AUTO_REPLY_MAX_TURNS_OPTIONS: readonly number[];
export declare const AUTO_REPLY_COOLDOWN_MS_OPTIONS: readonly number[];
export declare const DEFAULT_AUTO_REPLY_MAX_TURNS = 5;
export declare const DEFAULT_AUTO_REPLY_COOLDOWN_MS = 300000;
export type DefaultWriteNetwork = 'mvc' | 'btc' | 'doge' | 'opcat';
export declare const DEFAULT_WRITE_NETWORKS: DefaultWriteNetwork[];
export interface ChainConfig {
    defaultWriteNetwork: DefaultWriteNetwork;
    mvcSponsorUploadEnabled: boolean;
}
export interface BrowserConfig {
    renderCustomBotPages: boolean;
    nameResolution: BrowserNameResolutionConfig;
    blockExplorerBaseUrl?: string;
    walletApiBaseUrl?: string;
    botHomepageTemplateId: BotHomepageTemplateId;
    defaultChainName: DefaultWriteNetwork;
    localMode: boolean;
}
export interface MetabotConfig {
    chain: ChainConfig;
    a2a: A2AConfig;
    autoReply: AutoReplyConfig;
    browser: BrowserConfig;
}
export declare function isDefaultWriteNetwork(value: unknown): value is DefaultWriteNetwork;
export declare function createDefaultConfig(): MetabotConfig;
