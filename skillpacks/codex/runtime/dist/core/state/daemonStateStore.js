"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDaemonRuntimeLayout = ensureDaemonRuntimeLayout;
exports.createDaemonStateStore = createDaemonStateStore;
const node_fs_1 = require("node:fs");
const paths_1 = require("./paths");
const TRANSIENT_JSON_READ_RETRIES = 5;
const TRANSIENT_JSON_READ_DELAY_MS = 10;
let atomicWriteSequence = 0;
const DAEMON_EVENTS_MAX_BYTES = 1_000_000;
const DAEMON_EVENTS_COMPACT_KEEP_LINES = 200;
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
function parseDaemonEventLine(raw) {
    try {
        const parsed = JSON.parse(raw);
        const event = parsed.event;
        if (typeof event !== 'string') {
            return null;
        }
        const pid = typeof parsed.pid === 'number' ? parsed.pid : null;
        return {
            at: typeof parsed.at === 'number' ? parsed.at : 0,
            event: event,
            pid,
            trigger: typeof parsed.trigger === 'string' ? parsed.trigger : null,
            detail: typeof parsed.detail === 'string' ? parsed.detail : null,
        };
    }
    catch {
        return null;
    }
}
async function readDaemonEventLines(eventsPath) {
    let raw;
    try {
        raw = await node_fs_1.promises.readFile(eventsPath, 'utf8');
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    return raw
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map(parseDaemonEventLine)
        .filter((event) => event !== null);
}
/** Keep the journal bounded: rewrite the tail when it outgrows the cap. */
async function compactDaemonEventsFile(eventsPath, events) {
    const kept = events.slice(-DAEMON_EVENTS_COMPACT_KEEP_LINES);
    const content = kept.map((event) => JSON.stringify(event)).join('\n');
    const temporaryPath = `${eventsPath}.${process.pid}.${Date.now()}.tmp`;
    await node_fs_1.promises.writeFile(temporaryPath, content ? `${content}\n` : '', 'utf8');
    await node_fs_1.promises.rename(temporaryPath, eventsPath);
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
            // No tracked record means there is nothing to remove — skipping the
            // unlink also avoids raw EPERM noise in sandboxed environments where
            // even an unlink of a missing file is denied before ENOENT.
            if (!current) {
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
        async appendDaemonEvent(event) {
            await ensureDaemonRuntimeLayout(paths);
            const existing = await readDaemonEventLines(paths.daemonEventsPath);
            const stat = await node_fs_1.promises.stat(paths.daemonEventsPath).catch(() => null);
            if (stat && stat.size > DAEMON_EVENTS_MAX_BYTES) {
                await compactDaemonEventsFile(paths.daemonEventsPath, existing);
            }
            await node_fs_1.promises.appendFile(paths.daemonEventsPath, `${JSON.stringify(event)}\n`, 'utf8');
        },
        async readDaemonEvents(limit) {
            const events = await readDaemonEventLines(paths.daemonEventsPath);
            return limit > 0 ? events.slice(-limit) : [];
        },
    };
}
