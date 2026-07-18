"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDaemonRuntimeLayout = ensureDaemonRuntimeLayout;
exports.createDaemonStateStore = createDaemonStateStore;
const node_fs_1 = require("node:fs");
const paths_1 = require("./paths");
const TRANSIENT_JSON_READ_RETRIES = 5;
const TRANSIENT_JSON_READ_DELAY_MS = 10;
let atomicWriteSequence = 0;
async function ensureDaemonRuntimeLayout(paths) {
    await Promise.all([
        node_fs_1.promises.mkdir(paths.runtimeRoot, { recursive: true }),
        node_fs_1.promises.mkdir(paths.locksRoot, { recursive: true }),
        node_fs_1.promises.mkdir(paths.logsRoot, { recursive: true }),
        node_fs_1.promises.mkdir(paths.recoveryRoot, { recursive: true }),
    ]);
}
async function readJsonFile(filePath) {
    for (let attempt = 0; attempt <= TRANSIENT_JSON_READ_RETRIES; attempt += 1) {
        try {
            const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
            return JSON.parse(raw);
        }
        catch (error) {
            const code = error.code;
            if (code === 'ENOENT') {
                return null;
            }
            if (error instanceof SyntaxError && attempt < TRANSIENT_JSON_READ_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, TRANSIENT_JSON_READ_DELAY_MS));
                continue;
            }
            throw error;
        }
    }
    return null;
}
function createAtomicWriteTempPath(filePath) {
    atomicWriteSequence += 1;
    return `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
}
async function writeJsonFileAtomic(filePath, value) {
    const tempPath = createAtomicWriteTempPath(filePath);
    try {
        await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await node_fs_1.promises.rename(tempPath, filePath);
    }
    catch (error) {
        await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
function createDaemonStateStore(systemHomeDirOrPaths) {
    const paths = typeof systemHomeDirOrPaths === 'string'
        ? (0, paths_1.resolveMetabotDaemonPaths)(systemHomeDirOrPaths)
        : systemHomeDirOrPaths;
    return {
        paths,
        async ensureLayout() {
            await ensureDaemonRuntimeLayout(paths);
            return paths;
        },
        async readInstallation() {
            await ensureDaemonRuntimeLayout(paths);
            return readJsonFile(paths.installationPath);
        },
        async writeInstallation(record) {
            await ensureDaemonRuntimeLayout(paths);
            await writeJsonFileAtomic(paths.installationPath, record);
            return record;
        },
        async readDaemon() {
            await ensureDaemonRuntimeLayout(paths);
            return readJsonFile(paths.daemonStatePath);
        },
        async writeDaemon(record) {
            await ensureDaemonRuntimeLayout(paths);
            await writeJsonFileAtomic(paths.daemonStatePath, record);
            return record;
        },
        async clearDaemon(pid) {
            await ensureDaemonRuntimeLayout(paths);
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
