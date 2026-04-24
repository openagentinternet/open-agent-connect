"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConfigStore = createConfigStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
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
function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const normalized = [];
    for (const entry of value) {
        const text = normalizeString(entry);
        if (!text || seen.has(text)) {
            continue;
        }
        seen.add(text);
        normalized.push(text);
    }
    return normalized;
}
function allowInternalAskMasterAutoTriggerMode() {
    return process.env.METABOT_INTERNAL_ASK_MASTER_AUTO === '1';
}
function normalizeConfig(input) {
    const defaults = (0, configTypes_1.createDefaultConfig)();
    if (!input || typeof input !== 'object') {
        return defaults;
    }
    const root = input;
    const maybeNetwork = root['evolution_network'];
    const maybeAskMaster = root['askMaster'];
    const networkSource = maybeNetwork && typeof maybeNetwork === 'object'
        ? maybeNetwork
        : {};
    const askMasterSource = maybeAskMaster && typeof maybeAskMaster === 'object'
        ? maybeAskMaster
        : {};
    const triggerMode = normalizeString(askMasterSource.triggerMode);
    const confirmationMode = normalizeString(askMasterSource.confirmationMode);
    const contextMode = normalizeString(askMasterSource.contextMode);
    return {
        evolution_network: {
            enabled: normalizeBoolean(networkSource.enabled, defaults.evolution_network.enabled),
            autoAdoptSameSkillSameScope: normalizeBoolean(networkSource.autoAdoptSameSkillSameScope, defaults.evolution_network.autoAdoptSameSkillSameScope),
            autoRecordExecutions: normalizeBoolean(networkSource.autoRecordExecutions, defaults.evolution_network.autoRecordExecutions)
        },
        askMaster: {
            enabled: normalizeBoolean(askMasterSource.enabled, defaults.askMaster.enabled),
            triggerMode: triggerMode === 'auto' && !allowInternalAskMasterAutoTriggerMode()
                ? defaults.askMaster.triggerMode
                : (0, configTypes_1.isAskMasterTriggerMode)(triggerMode)
                    ? triggerMode
                    : defaults.askMaster.triggerMode,
            confirmationMode: (0, configTypes_1.isAskMasterConfirmationMode)(confirmationMode)
                ? confirmationMode
                : defaults.askMaster.confirmationMode,
            contextMode: (0, configTypes_1.isAskMasterContextMode)(contextMode)
                ? contextMode
                : defaults.askMaster.contextMode,
            trustedMasters: normalizeStringArray(askMasterSource.trustedMasters),
            autoPolicy: (0, configTypes_1.normalizeAskMasterAutoPolicyConfig)(askMasterSource.autoPolicy),
        }
    };
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
