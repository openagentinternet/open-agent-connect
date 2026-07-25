"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WRITE_NETWORKS = exports.DEFAULT_AUTO_REPLY_COOLDOWN_MS = exports.DEFAULT_AUTO_REPLY_MAX_TURNS = exports.AUTO_REPLY_COOLDOWN_MS_OPTIONS = exports.AUTO_REPLY_MAX_TURNS_OPTIONS = void 0;
exports.isDefaultWriteNetwork = isDefaultWriteNetwork;
exports.createDefaultConfig = createDefaultConfig;
const agent_browser_core_1 = require("@openagentinternet/agent-browser-core");
exports.AUTO_REPLY_MAX_TURNS_OPTIONS = [5, 10, 15, 20, 25, 30];
exports.AUTO_REPLY_COOLDOWN_MS_OPTIONS = [60_000, 300_000, 600_000, 1_800_000, 3_600_000];
exports.DEFAULT_AUTO_REPLY_MAX_TURNS = 5;
exports.DEFAULT_AUTO_REPLY_COOLDOWN_MS = 300_000;
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
            maxTurns: exports.DEFAULT_AUTO_REPLY_MAX_TURNS,
            cooldownMs: exports.DEFAULT_AUTO_REPLY_COOLDOWN_MS,
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
