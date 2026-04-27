"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChatStrategyStore = createChatStrategyStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const runtimeStateStore_1 = require("../state/runtimeStateStore");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeStrategiesState(value) {
    if (!value || typeof value !== 'object') {
        return { strategies: [] };
    }
    const source = value;
    if (!Array.isArray(source.strategies)) {
        return { strategies: [] };
    }
    const strategies = [];
    for (const entry of source.strategies) {
        if (!entry || typeof entry !== 'object')
            continue;
        const raw = entry;
        const id = normalizeText(raw.id);
        if (!id)
            continue;
        strategies.push({
            id,
            maxTurns: typeof raw.maxTurns === 'number' && Number.isFinite(raw.maxTurns)
                ? Math.max(1, Math.trunc(raw.maxTurns))
                : 30,
            maxIdleMs: typeof raw.maxIdleMs === 'number' && Number.isFinite(raw.maxIdleMs)
                ? Math.max(0, Math.trunc(raw.maxIdleMs))
                : 300_000,
            exitCriteria: normalizeText(raw.exitCriteria),
        });
    }
    return { strategies };
}
async function writeJsonFileAtomically(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    let handle = null;
    try {
        handle = await node_fs_1.promises.open(tempPath, 'w');
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await node_fs_1.promises.rename(tempPath, filePath);
        try {
            const directoryHandle = await node_fs_1.promises.open(node_path_1.default.dirname(filePath), 'r');
            try {
                await directoryHandle.sync();
            }
            finally {
                await directoryHandle.close();
            }
        }
        catch (error) {
            const code = error.code;
            if (code !== 'EINVAL' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EBADF') {
                throw error;
            }
        }
    }
    catch (error) {
        if (handle) {
            await handle.close();
        }
        await node_fs_1.promises.rm(tempPath, { force: true });
        throw error;
    }
}
function createChatStrategyStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    const chatStrategiesPath = paths.chatStrategiesPath;
    return {
        paths,
        async read() {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            try {
                const raw = await node_fs_1.promises.readFile(chatStrategiesPath, 'utf8');
                return normalizeStrategiesState(JSON.parse(raw));
            }
            catch (error) {
                const code = error.code;
                if (code === 'ENOENT') {
                    return { strategies: [] };
                }
                if (error instanceof SyntaxError) {
                    return { strategies: [] };
                }
                throw error;
            }
        },
        async write(state) {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            await writeJsonFileAtomically(chatStrategiesPath, normalizeStrategiesState(state));
        },
        async getStrategy(id) {
            const state = await this.read();
            const normalizedId = normalizeText(id).toLowerCase();
            return state.strategies.find(s => normalizeText(s.id).toLowerCase() === normalizedId) ?? null;
        },
    };
}
