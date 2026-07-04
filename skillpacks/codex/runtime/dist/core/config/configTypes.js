"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WRITE_NETWORKS = void 0;
exports.isDefaultWriteNetwork = isDefaultWriteNetwork;
exports.createDefaultConfig = createDefaultConfig;
const agent_browser_core_1 = require("@openagentinternet/agent-browser-core");
exports.DEFAULT_WRITE_NETWORKS = ['mvc', 'btc', 'doge', 'opcat'];
const DEFAULT_BLOCK_EXPLORER_BASE_URL = 'https://www.mvcscan.com/tx';
function isDefaultWriteNetwork(value) {
    return typeof value === 'string' && exports.DEFAULT_WRITE_NETWORKS.includes(value);
}
function createDefaultConfig() {
    // Source Browser URL defaults from core so it remains the single source of
    // truth. Pick fields explicitly rather than spreading: core's
    // BrowserBaseConfig is wider than OAC's BrowserConfig (it carries
    // renderCustomBotPages/nameResolution) and defaults localMode to false.
    // OAC keeps its own block explorer base URL because core 0.3.5 no longer
    // carries that field.
    const browserDefaults = (0, agent_browser_core_1.createDefaultBrowserConfig)();
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
            botHomepageTemplateId: agent_browser_core_1.DEFAULT_BOT_HOMEPAGE_TEMPLATE_ID,
            defaultChainName: 'mvc',
            localMode: true,
        },
    };
}
