"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLlmRuntimeStore = createLlmRuntimeStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const llmTypes_1 = require("./llmTypes");
function resolveRuntimesPath(homeDirOrPaths) {
    if (typeof homeDirOrPaths === 'object' && 'llmRuntimesPath' in homeDirOrPaths) {
        return homeDirOrPaths.llmRuntimesPath;
    }
    return (0, paths_1.resolveMetabotPaths)(homeDirOrPaths).llmRuntimesPath;
}
async function readJsonFile(filePath) {
    let raw;
    try {
        raw = await node_fs_1.promises.readFile(filePath, 'utf8');
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return { version: 1, runtimes: [] };
        }
        throw error;
    }
    try {
        return (0, llmTypes_1.normalizeLlmRuntimesState)(JSON.parse(raw));
    }
    catch {
        return { version: 1, runtimes: [] };
    }
}
async function writeJsonFile(filePath, state) {
    // Ensure parent directory exists.
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    // Atomic write: temp file then rename.
    const tmpPath = filePath + '.tmp.' + Math.random().toString(36).slice(2, 8);
    await node_fs_1.promises.writeFile(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
    await node_fs_1.promises.rename(tmpPath, filePath);
}
function createLlmRuntimeStore(homeDirOrPaths) {
    const filePath = resolveRuntimesPath(homeDirOrPaths);
    const store = {
        async read() {
            return readJsonFile(filePath);
        },
        async write(state) {
            const normalized = (0, llmTypes_1.normalizeLlmRuntimesState)(state);
            await writeJsonFile(filePath, normalized);
            return normalized;
        },
        async upsertRuntime(runtime) {
            const normalized = (0, llmTypes_1.normalizeLlmRuntime)(runtime);
            if (!normalized) {
                throw new Error('Invalid LlmRuntime: missing id or provider.');
            }
            const state = await readJsonFile(filePath);
            const existingIndex = state.runtimes.findIndex((r) => r.id === normalized.id);
            if (existingIndex >= 0) {
                state.runtimes[existingIndex] = normalized;
            }
            else {
                state.runtimes.push(normalized);
            }
            state.version += 1;
            await writeJsonFile(filePath, state);
            return state;
        },
        async removeRuntime(runtimeId) {
            const state = await readJsonFile(filePath);
            state.runtimes = state.runtimes.filter((r) => r.id !== runtimeId);
            state.version += 1;
            await writeJsonFile(filePath, state);
            return state;
        },
        async markSeen(runtimeId, now) {
            const state = await readJsonFile(filePath);
            const rt = state.runtimes.find((r) => r.id === runtimeId);
            if (rt) {
                rt.lastSeenAt = now;
                rt.updatedAt = now;
                state.version += 1;
            }
            await writeJsonFile(filePath, state);
            return state;
        },
        async updateHealth(runtimeId, health) {
            const state = await readJsonFile(filePath);
            const rt = state.runtimes.find((r) => r.id === runtimeId);
            if (rt) {
                rt.health = health;
                rt.updatedAt = new Date().toISOString();
                state.version += 1;
            }
            await writeJsonFile(filePath, state);
            return state;
        },
    };
    return store;
}
