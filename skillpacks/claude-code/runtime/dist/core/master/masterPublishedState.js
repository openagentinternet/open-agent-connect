"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPublishedMasterStateStore = createPublishedMasterStateStore;
const node_fs_1 = require("node:fs");
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const paths_1 = require("../state/paths");
function createEmptyState() {
    return {
        masters: [],
    };
}
function normalizePublishedMasterState(value) {
    if (!value || typeof value !== 'object') {
        return createEmptyState();
    }
    return {
        masters: Array.isArray(value.masters) ? value.masters : [],
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
function createPublishedMasterStateStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    const statePath = paths.masterPublishedStatePath;
    return {
        paths,
        statePath,
        async read() {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            return normalizePublishedMasterState(await readJsonFile(statePath));
        },
        async write(nextState) {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            const normalized = normalizePublishedMasterState(nextState);
            await node_fs_1.promises.writeFile(statePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
            return normalized;
        },
        async update(updater) {
            const currentState = await this.read();
            const nextState = await updater(currentState);
            return this.write(nextState);
        },
    };
}
