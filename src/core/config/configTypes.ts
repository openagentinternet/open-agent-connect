import {
  createDefaultBrowserConfig,
  type BotHomepageTemplateId,
  type BrowserNameResolutionConfig,
} from '@openagentinternet/agent-browser-core';

export interface A2AConfig {
  simplemsgListenerEnabled: boolean;
}

export interface AutoReplyConfig {
  enabled: boolean;
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
  metafileContentBaseUrl: string;
  manApiBaseUrl: string;
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

export function isDefaultWriteNetwork(value: unknown): value is DefaultWriteNetwork {
  return typeof value === 'string' && DEFAULT_WRITE_NETWORKS.includes(value as DefaultWriteNetwork);
}

export function createDefaultConfig(): MetabotConfig {
  const browserDefaults = createDefaultBrowserConfig();
  return {
    chain: {
      defaultWriteNetwork: 'mvc',
      mvcSponsorUploadEnabled: true,
    },
    a2a: {
      simplemsgListenerEnabled: true,
    },
    autoReply: {
      enabled: true,
    },
    browser: {
      ...browserDefaults,
      blockExplorerBaseUrl: DEFAULT_BLOCK_EXPLORER_BASE_URL,
      defaultChainName: 'mvc',
      localMode: true,
    },
  };
}
