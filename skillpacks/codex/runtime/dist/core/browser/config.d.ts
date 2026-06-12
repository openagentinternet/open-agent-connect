import type { BrowserConfig, MetabotConfig } from '../config/configTypes';
export declare function resolveBrowserConfig(config: MetabotConfig, env?: NodeJS.ProcessEnv): BrowserConfig;
export declare function createDefaultBrowserConfig(defaultChainName: BrowserConfig['defaultChainName']): BrowserConfig;
