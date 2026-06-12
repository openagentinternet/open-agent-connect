"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBrowserConfig = resolveBrowserConfig;
exports.createDefaultBrowserConfig = createDefaultBrowserConfig;
const botHomepageTemplates_1 = require("./botHomepageTemplates");
const DEFAULT_METASO_P2P_BASE_URL = 'https://so.metaid.io';
const DEFAULT_METAFILE_CONTENT_BASE_URL = 'https://so.metaid.io/content';
const DEFAULT_MANAPI_BASE_URL = 'https://manapi.metaid.io';
const DEFAULT_BLOCK_EXPLORER_BASE_URL = 'https://www.mvcscan.com/tx';
function normalizeUrl(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.replace(/\/+$/, '');
}
function resolveBrowserConfig(config, env = process.env) {
    const browser = config.browser;
    return {
        metasoP2PBaseUrl: normalizeUrl(env.METABOT_BROWSER_METASO_P2P_BASE_URL) || normalizeUrl(browser.metasoP2PBaseUrl),
        metafileContentBaseUrl: normalizeUrl(env.METABOT_BROWSER_METAFILE_CONTENT_BASE_URL) || normalizeUrl(browser.metafileContentBaseUrl),
        manApiBaseUrl: normalizeUrl(env.METABOT_BROWSER_MANAPI_BASE_URL) || normalizeUrl(browser.manApiBaseUrl),
        blockExplorerBaseUrl: normalizeUrl(env.METABOT_BROWSER_BLOCK_EXPLORER_BASE_URL) || normalizeUrl(browser.blockExplorerBaseUrl),
        walletApiBaseUrl: normalizeUrl(env.METABOT_BROWSER_WALLET_API_BASE_URL) || normalizeUrl(browser.walletApiBaseUrl),
        botHomepageTemplateId: (0, botHomepageTemplates_1.normalizeBotHomepageTemplateId)(browser.botHomepageTemplateId),
        defaultChainName: browser.defaultChainName || config.chain.defaultWriteNetwork,
        localMode: browser.localMode !== false,
    };
}
function createDefaultBrowserConfig(defaultChainName) {
    return {
        metasoP2PBaseUrl: DEFAULT_METASO_P2P_BASE_URL,
        metafileContentBaseUrl: DEFAULT_METAFILE_CONTENT_BASE_URL,
        manApiBaseUrl: DEFAULT_MANAPI_BASE_URL,
        blockExplorerBaseUrl: DEFAULT_BLOCK_EXPLORER_BASE_URL,
        botHomepageTemplateId: botHomepageTemplates_1.DEFAULT_BOT_HOMEPAGE_TEMPLATE_ID,
        defaultChainName,
        localMode: true,
    };
}
