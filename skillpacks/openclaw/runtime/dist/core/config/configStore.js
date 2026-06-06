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
function normalizeConfig(input) {
    const defaults = (0, configTypes_1.createDefaultConfig)();
    if (!input || typeof input !== 'object') {
        return defaults;
    }
    const root = input;
    const maybeA2A = root['a2a'];
    const maybeChain = root['chain'];
    const a2aSource = maybeA2A && typeof maybeA2A === 'object'
        ? maybeA2A
        : {};
    const chainSource = maybeChain && typeof maybeChain === 'object'
        ? maybeChain
        : {};
    const defaultWriteNetwork = normalizeString(chainSource.defaultWriteNetwork).toLowerCase();
    return {
        chain: {
            defaultWriteNetwork: (0, configTypes_1.isDefaultWriteNetwork)(defaultWriteNetwork)
                ? defaultWriteNetwork
                : defaults.chain.defaultWriteNetwork,
        },
        a2a: {
            simplemsgListenerEnabled: normalizeBoolean(a2aSource.simplemsgListenerEnabled, defaults.a2a.simplemsgListenerEnabled),
        },
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
