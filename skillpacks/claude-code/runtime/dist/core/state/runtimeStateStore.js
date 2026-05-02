"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureRuntimeLayout = ensureRuntimeLayout;
exports.createRuntimeStateStore = createRuntimeStateStore;
const node_fs_1 = require("node:fs");
const paths_1 = require("./paths");
function cloneEmptyState() {
    return {
        identity: null,
        services: [],
        traces: [],
    };
}
async function ensureRuntimeLayout(paths) {
    await Promise.all([
        node_fs_1.promises.mkdir(paths.runtimeRoot, { recursive: true }),
        node_fs_1.promises.mkdir(paths.a2aRoot, { recursive: true }),
        node_fs_1.promises.mkdir(paths.stateRoot, { recursive: true }),
        node_fs_1.promises.mkdir(paths.sessionsRoot, { recursive: true }),
        node_fs_1.promises.mkdir(paths.exportsRoot, { recursive: true }),
        node_fs_1.promises.mkdir(paths.locksRoot, { recursive: true }),
    ]);
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
function normalizeRuntimeState(value) {
    if (!value || typeof value !== 'object') {
        return cloneEmptyState();
    }
    return {
        identity: value.identity ?? null,
        services: Array.isArray(value.services) ? value.services : [],
        traces: Array.isArray(value.traces) ? value.traces : [],
    };
}
function createRuntimeStateStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    return {
        paths,
        async ensureLayout() {
            await ensureRuntimeLayout(paths);
            return paths;
        },
        async readState() {
            await ensureRuntimeLayout(paths);
            return normalizeRuntimeState(await readJsonFile(paths.runtimeStatePath));
        },
        async writeState(nextState) {
            await ensureRuntimeLayout(paths);
            const normalized = normalizeRuntimeState(nextState);
            await node_fs_1.promises.writeFile(paths.runtimeStatePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
            return normalized;
        },
        async updateState(updater) {
            const currentState = await this.readState();
            const nextState = await updater(currentState);
            return this.writeState(nextState);
        },
        async readDaemon() {
            await ensureRuntimeLayout(paths);
            return readJsonFile(paths.daemonStatePath);
        },
        async writeDaemon(record) {
            await ensureRuntimeLayout(paths);
            await node_fs_1.promises.writeFile(paths.daemonStatePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
            return record;
        },
        async clearDaemon(pid) {
            await ensureRuntimeLayout(paths);
            const current = await readJsonFile(paths.daemonStatePath);
            if (pid && current && current.pid !== pid) {
                return;
            }
            try {
                await node_fs_1.promises.rm(paths.daemonStatePath);
            }
            catch (error) {
                const code = error.code;
                if (code !== 'ENOENT') {
                    throw error;
                }
            }
        },
    };
}
