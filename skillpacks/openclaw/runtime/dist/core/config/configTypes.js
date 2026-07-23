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
    const browserDefaults = (0, agent_browser_core_1.createDefaultBrowserConfig)();
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
            botHomepageTemplateId: browserDefaults.botHomepageTemplateId,
            renderCustomBotPages: browserDefaults.renderCustomBotPages,
            nameResolution: browserDefaults.nameResolution,
            blockExplorerBaseUrl: DEFAULT_BLOCK_EXPLORER_BASE_URL,
            defaultChainName: 'mvc',
            localMode: true,
        },
    };
}
