"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConfigStore = createConfigStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const agent_browser_core_1 = require("@openagentinternet/agent-browser-core");
const homeSelection_1 = require("../state/homeSelection");
const paths_1 = require("../state/paths");
const configTypes_1 = require("./configTypes");
async function ensureLayout(paths) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(paths.configPath), { recursive: true });
    try {
        await node_fs_1.promises.access(paths.configPath);
    }
    catch (error) {
        const code = error.code;
        if (code !== 'ENOENT') {
            throw error;
        }
        await node_fs_1.promises.writeFile(paths.configPath, `${JSON.stringify((0, configTypes_1.createDefaultConfig)(), null, 2)}\n`, 'utf8');
    }
}
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
function normalizeBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
function normalizeNumberOption(value, options, fallback) {
    return typeof value === 'number' && options.includes(value) ? value : fallback;
}
function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeStringList(value) {
    if (Array.isArray(value)) {
        return value
            .filter((item) => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return null;
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function normalizeNameResolutionConfig(input, fallback) {
    const source = input && typeof input === 'object' && !Array.isArray(input)
        ? input
        : {};
    const ensSource = source.ens && typeof source.ens === 'object' && !Array.isArray(source.ens)
        ? source.ens
        : {};
    const normalizedRpcUrls = hasOwn(ensSource, 'rpcUrls')
        ? normalizeStringList(ensSource.rpcUrls)
        : null;
    return {
        enabled: normalizeBoolean(source.enabled, fallback.enabled),
        ens: {
            enabled: normalizeBoolean(ensSource.enabled, fallback.ens.enabled),
            chainId: 1,
            rpcUrls: normalizedRpcUrls ?? [...fallback.ens.rpcUrls],
            textKey: normalizeString(ensSource.textKey) || fallback.ens.textKey,
        },
    };
}
function normalizeConfig(input) {
    const defaults = (0, configTypes_1.createDefaultConfig)();
    if (!input || typeof input !== 'object') {
        return defaults;
    }
    const root = input;
    const maybeA2A = root['a2a'];
    const maybeAutoReply = root['autoReply'];
    const maybeBrowser = root['browser'];
    const maybeChain = root['chain'];
    const a2aSource = maybeA2A && typeof maybeA2A === 'object'
        ? maybeA2A
        : {};
    const autoReplySource = maybeAutoReply && typeof maybeAutoReply === 'object'
        ? maybeAutoReply
        : {};
    const browserSource = maybeBrowser && typeof maybeBrowser === 'object'
        ? maybeBrowser
        : {};
    const chainSource = maybeChain && typeof maybeChain === 'object'
        ? maybeChain
        : {};
    const defaultWriteNetwork = normalizeString(chainSource.defaultWriteNetwork).toLowerCase();
    const browserDefaultChainName = normalizeString(browserSource.defaultChainName).toLowerCase();
    const walletApiBaseUrl = normalizeString(browserSource.walletApiBaseUrl) || defaults.browser.walletApiBaseUrl;
    const normalizedConfig = {
        chain: {
            defaultWriteNetwork: (0, configTypes_1.isDefaultWriteNetwork)(defaultWriteNetwork)
                ? defaultWriteNetwork
                : defaults.chain.defaultWriteNetwork,
            mvcSponsorUploadEnabled: normalizeBoolean(chainSource.mvcSponsorUploadEnabled, defaults.chain.mvcSponsorUploadEnabled),
        },
        a2a: {
            simplemsgListenerEnabled: normalizeBoolean(a2aSource.simplemsgListenerEnabled, defaults.a2a.simplemsgListenerEnabled),
        },
        autoReply: {
            enabled: normalizeBoolean(autoReplySource.enabled, defaults.autoReply.enabled),
            maxTurns: normalizeNumberOption(autoReplySource.maxTurns, configTypes_1.AUTO_REPLY_MAX_TURNS_OPTIONS, defaults.autoReply.maxTurns),
            cooldownMs: normalizeNumberOption(autoReplySource.cooldownMs, configTypes_1.AUTO_REPLY_COOLDOWN_MS_OPTIONS, defaults.autoReply.cooldownMs),
        },
        browser: {
            blockExplorerBaseUrl: normalizeString(browserSource.blockExplorerBaseUrl) || defaults.browser.blockExplorerBaseUrl,
            botHomepageTemplateId: (0, agent_browser_core_1.normalizeBotHomepageTemplateId)(browserSource.botHomepageTemplateId, defaults.browser.botHomepageTemplateId),
            renderCustomBotPages: normalizeBoolean(browserSource.renderCustomBotPages, defaults.browser.renderCustomBotPages),
            nameResolution: normalizeNameResolutionConfig(browserSource.nameResolution, defaults.browser.nameResolution),
            defaultChainName: (0, configTypes_1.isDefaultWriteNetwork)(browserDefaultChainName)
                ? browserDefaultChainName
                : defaults.chain.defaultWriteNetwork,
            localMode: normalizeBoolean(browserSource.localMode, defaults.browser.localMode),
        },
    };
    if (walletApiBaseUrl) {
        normalizedConfig.browser.walletApiBaseUrl = walletApiBaseUrl;
    }
    return normalizedConfig;
}
function resolvePaths(homeDirOrPaths) {
    if (typeof homeDirOrPaths === 'string') {
        return (0, paths_1.resolveMetabotPaths)(homeDirOrPaths);
    }
    if (homeDirOrPaths) {
        return homeDirOrPaths;
    }
    const selection = (0, homeSelection_1.resolveMetabotHomeSelection)({
        env: process.env,
        cwd: process.cwd(),
    });
    return selection.paths ?? (0, paths_1.resolveMetabotPaths)(selection.homeDir);
}
function createConfigStore(homeDirOrPaths) {
    const paths = resolvePaths(homeDirOrPaths);
    return {
        paths,
        async ensureLayout() {
            await ensureLayout(paths);
            return paths;
        },
        async read() {
            await ensureLayout(paths);
            const data = await readJsonFile(paths.configPath);
            return normalizeConfig(data);
        },
        async set(value) {
            await ensureLayout(paths);
            const normalized = normalizeConfig(value);
            await node_fs_1.promises.writeFile(paths.configPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
        }
    };
}
