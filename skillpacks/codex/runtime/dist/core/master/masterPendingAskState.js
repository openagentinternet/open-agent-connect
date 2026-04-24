"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPendingMasterAskStateStore = createPendingMasterAskStateStore;
const node_fs_1 = require("node:fs");
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const paths_1 = require("../state/paths");
function createEmptyState() {
    return {
        items: [],
    };
}
function normalizeState(value) {
    if (!value || typeof value !== 'object') {
        return createEmptyState();
    }
    return {
        items: Array.isArray(value.items) ? value.items : [],
    };
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
function createPendingMasterAskStateStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    const statePath = paths.masterPendingAskStatePath;
    return {
        paths,
        statePath,
        async read() {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            return normalizeState(await readJsonFile(statePath));
        },
        async write(nextState) {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            const normalized = normalizeState(nextState);
            await node_fs_1.promises.writeFile(statePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
            return normalized;
        },
        async update(updater) {
            const current = await this.read();
            const next = await updater(current);
            return this.write(next);
        },
        async get(traceId) {
            const state = await this.read();
            const record = state.items.find((entry) => entry.traceId === traceId);
            if (!record) {
                throw new Error(`Pending Ask Master record not found: ${traceId}`);
            }
            return record;
        },
        async put(record) {
            await this.update((current) => ({
                items: [
                    record,
                    ...current.items.filter((entry) => entry.traceId !== record.traceId),
                ],
            }));
            return record;
        },
    };
}
