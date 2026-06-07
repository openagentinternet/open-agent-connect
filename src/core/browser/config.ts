import type { BrowserConfig, MetabotConfig } from '../config/configTypes';

const DEFAULT_METASO_P2P_BASE_URL = 'https://so.metaid.io';
const DEFAULT_METAFILE_CONTENT_BASE_URL = 'https://so.metaid.io/content';
const DEFAULT_BLOCK_EXPLORER_BASE_URL = 'https://www.mvcscan.com/tx';

function normalizeUrl(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.replace(/\/+$/, '');
}

export function resolveBrowserConfig(config: MetabotConfig, env: NodeJS.ProcessEnv = process.env): BrowserConfig {
  const browser = config.browser;
  return {
    metasoP2PBaseUrl: normalizeUrl(env.METABOT_BROWSER_METASO_P2P_BASE_URL) || normalizeUrl(browser.metasoP2PBaseUrl),
    metafileContentBaseUrl: normalizeUrl(env.METABOT_BROWSER_METAFILE_CONTENT_BASE_URL) || normalizeUrl(browser.metafileContentBaseUrl),
    blockExplorerBaseUrl: normalizeUrl(env.METABOT_BROWSER_BLOCK_EXPLORER_BASE_URL) || normalizeUrl(browser.blockExplorerBaseUrl),
    walletApiBaseUrl: normalizeUrl(env.METABOT_BROWSER_WALLET_API_BASE_URL) || normalizeUrl(browser.walletApiBaseUrl),
    defaultChainName: browser.defaultChainName || config.chain.defaultWriteNetwork,
    localMode: browser.localMode !== false,
  };
}

export function createDefaultBrowserConfig(defaultChainName: BrowserConfig['defaultChainName']): BrowserConfig {
  return {
    metasoP2PBaseUrl: DEFAULT_METASO_P2P_BASE_URL,
    metafileContentBaseUrl: DEFAULT_METAFILE_CONTENT_BASE_URL,
    blockExplorerBaseUrl: DEFAULT_BLOCK_EXPLORER_BASE_URL,
    defaultChainName,
    localMode: true,
  };
}
