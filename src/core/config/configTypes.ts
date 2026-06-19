import {
  DEFAULT_BOT_HOMEPAGE_TEMPLATE_ID,
  type BotHomepageTemplateId,
} from '@openagentinternet/agent-browser-core';

export interface A2AConfig {
  simplemsgListenerEnabled: boolean;
}

export type DefaultWriteNetwork = 'mvc' | 'btc' | 'doge' | 'opcat';

export const DEFAULT_WRITE_NETWORKS: DefaultWriteNetwork[] = ['mvc', 'btc', 'doge', 'opcat'];

export interface ChainConfig {
  defaultWriteNetwork: DefaultWriteNetwork;
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
  return {
    chain: {
      defaultWriteNetwork: 'mvc',
    },
    a2a: {
      simplemsgListenerEnabled: true,
    },
    browser: {
      metasoP2PBaseUrl: 'https://so.metaid.io',
      metafileContentBaseUrl: 'https://so.metaid.io/content',
      manApiBaseUrl: 'https://manapi.metaid.io',
      blockExplorerBaseUrl: 'https://www.mvcscan.com/tx',
      botHomepageTemplateId: DEFAULT_BOT_HOMEPAGE_TEMPLATE_ID,
      defaultChainName: 'mvc',
      localMode: true,
    },
  };
}
