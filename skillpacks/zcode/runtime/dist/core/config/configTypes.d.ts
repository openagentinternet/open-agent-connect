import { type BotHomepageTemplateId, type BrowserNameResolutionConfig } from '@openagentinternet/agent-browser-core';
export interface A2AConfig {
    simplemsgListenerEnabled: boolean;
}
export interface AutoReplyConfig {
    enabled: boolean;
    maxTurns: number;
    cooldownMs: number;
}
export interface AutomationConfig {
    /**
     * Daemon nightly dream tick (dream due → run + pre-dream surf gate +
     * memory-hygiene tail) for this profile. Default enabled so non-DSH
     * installs get nightly dreams out of the box; the tick also stands down
     * while the DSH host-executor bridge is connected.
     */
    dreamTickEnabled: boolean;
    /**
     * Daemon chain-history summary drain (bounded on-chain read/write
     * summarization) for this profile. Default enabled; same DSH stand-down
     * as the dream tick.
     */
    chainHistorySummaryEnabled: boolean;
}
export declare const AUTO_REPLY_MAX_TURNS_OPTIONS: readonly number[];
export declare const AUTO_REPLY_COOLDOWN_MS_OPTIONS: readonly number[];
export declare const DEFAULT_AUTO_REPLY_MAX_TURNS = 10;
export declare const DEFAULT_AUTO_REPLY_COOLDOWN_MS = 60000;
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
    automation: AutomationConfig;
    browser: BrowserConfig;
}
export declare function isDefaultWriteNetwork(value: unknown): value is DefaultWriteNetwork;
export declare function createDefaultConfig(): MetabotConfig;
