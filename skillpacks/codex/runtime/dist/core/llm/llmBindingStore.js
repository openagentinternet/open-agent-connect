"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLlmBindingStore = createLlmBindingStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const llmTypes_1 = require("./llmTypes");
function resolveBindingsPath(homeDirOrPaths) {
    if (typeof homeDirOrPaths === 'object' && 'llmBindingsPath' in homeDirOrPaths) {
        return homeDirOrPaths.llmBindingsPath;
    }
    return (0, paths_1.resolveMetabotPaths)(homeDirOrPaths).llmBindingsPath;
}
async function readJsonFile(filePath) {
    let raw;
    try {
        raw = await node_fs_1.promises.readFile(filePath, 'utf8');
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return { version: 1, bindings: [] };
        }
        throw error;
    }
    try {
        return (0, llmTypes_1.normalizeLlmBindingsState)(JSON.parse(raw));
    }
    catch {
        return { version: 1, bindings: [] };
    }
}
async function writeJsonFile(filePath, state) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    const tmpPath = filePath + '.tmp.' + Math.random().toString(36).slice(2, 8);
    await node_fs_1.promises.writeFile(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
    await node_fs_1.promises.rename(tmpPath, filePath);
}
function createLlmBindingStore(homeDirOrPaths) {
    const filePath = resolveBindingsPath(homeDirOrPaths);
    const store = {
        async read() {
            return readJsonFile(filePath);
        },
        async write(state) {
            const normalized = (0, llmTypes_1.normalizeLlmBindingsState)(state);
            await writeJsonFile(filePath, normalized);
            return normalized;
        },
        async upsertBinding(binding) {
            const normalized = (0, llmTypes_1.normalizeLlmBinding)(binding);
            if (!normalized) {
                throw new Error('Invalid LlmBinding: missing id, metaBotSlug, llmRuntimeId, or role.');
            }
            const state = await readJsonFile(filePath);
            // Deduplicate by composite key (metaBotSlug, llmRuntimeId, role).
            const existingIndex = state.bindings.findIndex((b) => b.metaBotSlug === normalized.metaBotSlug &&
                b.llmRuntimeId === normalized.llmRuntimeId &&
                b.role === normalized.role);
            if (existingIndex >= 0) {
                state.bindings[existingIndex] = normalized;
            }
            else {
                state.bindings.push(normalized);
            }
            state.version += 1;
            await writeJsonFile(filePath, state);
            return state;
        },
        async removeBinding(bindingId) {
            const state = await readJsonFile(filePath);
            state.bindings = state.bindings.filter((b) => b.id !== bindingId);
            state.version += 1;
            await writeJsonFile(filePath, state);
            return state;
        },
        async updateLastUsed(bindingId, now) {
            const state = await readJsonFile(filePath);
            const binding = state.bindings.find((b) => b.id === bindingId);
            if (binding) {
                binding.lastUsedAt = now;
                binding.updatedAt = now;
                state.version += 1;
            }
            await writeJsonFile(filePath, state);
            return state;
        },
        async listByMetaBotSlug(slug) {
            const state = await readJsonFile(filePath);
            return state.bindings.filter((b) => b.metaBotSlug === slug);
        },
        async listEnabledByMetaBotSlug(slug) {
            const state = await readJsonFile(filePath);
            return state.bindings.filter((b) => b.metaBotSlug === slug && b.enabled);
        },
    };
    return store;
}
