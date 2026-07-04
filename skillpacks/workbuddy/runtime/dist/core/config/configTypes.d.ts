import { type BotHomepageTemplateId } from '@openagentinternet/agent-browser-core';
export interface A2AConfig {
    simplemsgListenerEnabled: boolean;
}
export type DefaultWriteNetwork = 'mvc' | 'btc' | 'doge' | 'opcat';
export declare const DEFAULT_WRITE_NETWORKS: DefaultWriteNetwork[];
export interface ChainConfig {
    defaultWriteNetwork: DefaultWriteNetwork;
    mvcSponsorUploadEnabled: boolean;
}
export interface BrowserConfig {
    metasoP2PBaseUrl: string;
    metafileContentBaseUrl?: string;
    manApiBaseUrl?: string;
    blockExplorerBaseUrl?: string;
    walletApiBaseUrl?: string;
    botHomepageTemplateId: BotHomepageTemplateId;
    defaultChainName: DefaultWriteNetwork;
    localMode: boolean;
}
export interface MetabotConfig {
    chain: ChainConfig;
    a2a: A2AConfig;
    browser: BrowserConfig;
}
export declare function isDefaultWriteNetwork(value: unknown): value is DefaultWriteNetwork;
export declare function createDefaultConfig(): MetabotConfig;
