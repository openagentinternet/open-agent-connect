import { type MetabotConfig } from '../config/configTypes';
import type { BrowserSettingsSnapshot } from './hostTypes';
export type { BrowserSettingsSnapshot } from './hostTypes';
export declare const BROWSER_BASE_URL_KEYS: readonly ["metasoP2PBaseUrl", "metafileContentBaseUrl", "manApiBaseUrl", "blockExplorerBaseUrl", "walletApiBaseUrl"];
export type BrowserBaseUrlKey = typeof BROWSER_BASE_URL_KEYS[number];
export declare function createBrowserSettingsSnapshot(input: {
    config: MetabotConfig;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
}): BrowserSettingsSnapshot;
export declare function applyBrowserSettingsUpdate(current: MetabotConfig, rawBrowserInput: unknown): MetabotConfig;
