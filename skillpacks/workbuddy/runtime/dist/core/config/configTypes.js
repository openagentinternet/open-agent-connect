"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WRITE_NETWORKS = void 0;
exports.isDefaultWriteNetwork = isDefaultWriteNetwork;
exports.createDefaultConfig = createDefaultConfig;
const agent_browser_core_1 = require("@openagentinternet/agent-browser-core");
exports.DEFAULT_WRITE_NETWORKS = ['mvc', 'btc', 'doge', 'opcat'];
function isDefaultWriteNetwork(value) {
    return typeof value === 'string' && exports.DEFAULT_WRITE_NETWORKS.includes(value);
}
function createDefaultConfig() {
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
            botHomepageTemplateId: agent_browser_core_1.DEFAULT_BOT_HOMEPAGE_TEMPLATE_ID,
            defaultChainName: 'mvc',
            localMode: true,
        },
    };
}
