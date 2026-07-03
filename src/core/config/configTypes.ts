import {
  createDefaultBrowserConfig,
  DEFAULT_BOT_HOMEPAGE_TEMPLATE_ID,
  type BotHomepageTemplateId,
} from '@openagentinternet/agent-browser-core';

export interface A2AConfig {
  simplemsgListenerEnabled: boolean;
}

export type DefaultWriteNetwork = 'mvc' | 'btc' | 'doge' | 'opcat';

export const DEFAULT_WRITE_NETWORKS: DefaultWriteNetwork[] = ['mvc', 'btc', 'doge', 'opcat'];
const DEFAULT_BLOCK_EXPLORER_BASE_URL = 'https://www.mvcscan.com/tx';

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

export function isDefaultWriteNetwork(value: unknown): value is DefaultWriteNetwork {
  return typeof value === 'string' && DEFAULT_WRITE_NETWORKS.includes(value as DefaultWriteNetwork);
}

export function createDefaultConfig(): MetabotConfig {
  // Source Browser URL defaults from core so it remains the single source of
  // truth. Pick fields explicitly rather than spreading: core's
  // BrowserBaseConfig is wider than OAC's BrowserConfig (it carries
  // renderCustomBotPages/nameResolution) and defaults localMode to false.
  // OAC keeps its own block explorer base URL because core 0.3.5 no longer
  // carries that field.
  const browserDefaults = createDefaultBrowserConfig();
  return {
    chain: {
      defaultWriteNetwork: 'mvc',
      mvcSponsorUploadEnabled: true,
    },
    a2a: {
      simplemsgListenerEnabled: true,
    },
    browser: {
      metasoP2PBaseUrl: browserDefaults.metasoP2PBaseUrl,
      metafileContentBaseUrl: browserDefaults.metafileContentBaseUrl,
      manApiBaseUrl: browserDefaults.manApiBaseUrl,
      blockExplorerBaseUrl: DEFAULT_BLOCK_EXPLORER_BASE_URL,
      botHomepageTemplateId: DEFAULT_BOT_HOMEPAGE_TEMPLATE_ID,
      defaultChainName: 'mvc',
      localMode: true,
    },
  };
}
