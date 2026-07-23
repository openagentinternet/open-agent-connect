"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultInfrastructureConfig = createDefaultInfrastructureConfig;
exports.createInfrastructureConfigStore = createInfrastructureConfigStore;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const agent_browser_core_1 = require("@openagentinternet/agent-browser-core");
const paths_1 = require("../state/paths");
function createDefaultInfrastructureConfig() {
    const defaults = (0, agent_browser_core_1.createDefaultBrowserConfig)();
    return {
        metasoP2PBaseUrl: defaults.metasoP2PBaseUrl,
        metafileContentBaseUrl: defaults.metafileContentBaseUrl,
        manApiBaseUrl: defaults.manApiBaseUrl,
    };
}
function normalizeInfrastructureConfig(input) {
    const defaults = createDefaultInfrastructureConfig();
    const browser = input && typeof input === 'object' && !Array.isArray(input)
        ? input
        : {};
    const normalized = (0, agent_browser_core_1.applyBrowserSettingsUpdate)({ browser: defaults }, {
        metasoP2PBaseUrl: browser.metasoP2PBaseUrl,
        metafileContentBaseUrl: browser.metafileContentBaseUrl,
        manApiBaseUrl: browser.manApiBaseUrl,
    }).browser;
    return {
        metasoP2PBaseUrl: normalized.metasoP2PBaseUrl ?? defaults.metasoP2PBaseUrl,
        metafileContentBaseUrl: normalized.metafileContentBaseUrl ?? defaults.metafileContentBaseUrl,
        manApiBaseUrl: normalized.manApiBaseUrl ?? defaults.manApiBaseUrl,
    };
}
async function writeAtomic(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    try {
        await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await node_fs_1.promises.rename(tempPath, filePath);
    }
    finally {
        await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => { });
    }
}
async function ensureLayout(paths) {
    await node_fs_1.promises.mkdir(paths.managerRoot, { recursive: true });
    try {
        await node_fs_1.promises.writeFile(paths.infrastructureConfigPath, `${JSON.stringify(createDefaultInfrastructureConfig(), null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    }
    catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
}
function resolvePaths(systemHomeDirOrPaths) {
    return typeof systemHomeDirOrPaths === 'string'
        ? (0, paths_1.resolveMetabotDaemonPaths)(systemHomeDirOrPaths)
        : systemHomeDirOrPaths;
}
function createInfrastructureConfigStore(systemHomeDirOrPaths) {
    const paths = resolvePaths(systemHomeDirOrPaths);
    return {
        paths,
        async ensureLayout() {
            await ensureLayout(paths);
            return paths;
        },
        async read() {
            await ensureLayout(paths);
            const raw = await node_fs_1.promises.readFile(paths.infrastructureConfigPath, 'utf8');
            return normalizeInfrastructureConfig(JSON.parse(raw));
        },
        async set(value) {
            await ensureLayout(paths);
            await writeAtomic(paths.infrastructureConfigPath, normalizeInfrastructureConfig(value));
        },
    };
}
