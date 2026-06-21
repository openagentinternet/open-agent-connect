"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionStateStore = createSessionStateStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const SESSION_STATE_SCHEMA_VERSION = 1;
const MAX_TRANSCRIPT_ITEMS = 2_000;
const MAX_PUBLIC_STATUS_SNAPSHOTS = 1_000;
const LOCKFILE_BASE_DELAY_MS = 25;
const LOCKFILE_MAX_ATTEMPTS = 200;
const LOCKFILE_STALE_WITH_PID_MS = 5 * 60 * 1000;
const LOCKFILE_STALE_WITHOUT_PID_MS = 30_000;
function cloneEmptyState() {
    return {
        version: SESSION_STATE_SCHEMA_VERSION,
        sessions: [],
        taskRuns: [],
        transcriptItems: [],
        cursors: {
            caller: null,
            provider: null,
        },
        publicStatusSnapshots: [],
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
        if (error instanceof SyntaxError) {
            const corruptPath = `${filePath}.corrupt-${Date.now()}`;
            try {
                await node_fs_1.promises.rename(filePath, corruptPath);
            }
            catch {
                // Best effort quarantine so malformed runtime state does not brick future reads.
            }
            return null;
        }
        throw error;
    }
}
async function readLockInfo(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
            acquiredAt: typeof parsed.acquiredAt === 'number' ? parsed.acquiredAt : undefined,
        };
    }
    catch {
        return null;
    }
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
async function sleep(ms) {
    await new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        const code = error.code;
        return code !== 'ESRCH';
    }
}
async function withLock(lockPath, operation) {
    for (let attempt = 0; attempt < LOCKFILE_MAX_ATTEMPTS; attempt += 1) {
        try {
            const handle = await node_fs_1.promises.open(lockPath, 'wx');
            try {
                await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })}\n`, 'utf8');
                return await operation();
            }
            finally {
                await handle.close();
                try {
                    await node_fs_1.promises.rm(lockPath, { force: true });
                }
                catch {
                    // Best effort cleanup; stale lock recovery handles leftover lock files later.
                }
            }
        }
        catch (error) {
            const code = error.code;
            if (code !== 'EEXIST') {
                throw error;
            }
            try {
                const lockInfo = await readLockInfo(lockPath);
                const stat = await node_fs_1.promises.stat(lockPath);
                const lockPid = typeof lockInfo?.pid === 'number' ? lockInfo.pid : null;
                const acquiredAt = typeof lockInfo?.acquiredAt === 'number' ? lockInfo.acquiredAt : stat.mtimeMs;
                const ownerAlive = lockPid ? isProcessAlive(lockPid) : false;
                if (lockPid && !ownerAlive) {
                    await node_fs_1.promises.rm(lockPath, { force: true });
                    continue;
                }
                const staleThreshold = lockPid ? LOCKFILE_STALE_WITH_PID_MS : LOCKFILE_STALE_WITHOUT_PID_MS;
                const stale = Date.now() - acquiredAt > staleThreshold;
                if (!lockPid && stale) {
                    await node_fs_1.promises.rm(lockPath, { force: true });
                    continue;
                }
            }
            catch {
                // Another writer may have released the lock between stat/remove attempts.
            }
            await sleep(Math.min(LOCKFILE_BASE_DELAY_MS * (attempt + 1), 250));
        }
    }
    throw new Error(`Timed out acquiring session-state lock: ${lockPath}`);
}
function normalizeLoopCursors(raw) {
    const normalizeCursor = (value) => {
        if (typeof value === 'string' || typeof value === 'number') {
            return value;
        }
        return null;
    };
    return {
        caller: normalizeCursor(raw?.caller),
        provider: normalizeCursor(raw?.provider),
    };
}
function normalizeState(value) {
    if (!value || typeof value !== 'object') {
        return cloneEmptyState();
    }
    const source = value;
    return {
        ...source,
        version: typeof source.version === 'number' ? source.version : SESSION_STATE_SCHEMA_VERSION,
        sessions: Array.isArray(source.sessions) ? source.sessions : [],
        taskRuns: Array.isArray(source.taskRuns) ? source.taskRuns : [],
        transcriptItems: Array.isArray(source.transcriptItems)
            ? source.transcriptItems.slice(-MAX_TRANSCRIPT_ITEMS)
            : [],
        cursors: normalizeLoopCursors(source.cursors),
        publicStatusSnapshots: Array.isArray(source.publicStatusSnapshots)
            ? source.publicStatusSnapshots.slice(-MAX_PUBLIC_STATUS_SNAPSHOTS)
            : [],
    };
}
function createSessionStateStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    const sessionStatePath = paths.sessionStatePath;
    const lockPath = `${sessionStatePath}.lock`;
    let pendingWrite = Promise.resolve();
    const runExclusive = async (operation) => {
        const next = pendingWrite.then(async () => {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            return withLock(lockPath, operation);
        }, async () => {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            return withLock(lockPath, operation);
        });
        pendingWrite = next.then(() => undefined, () => undefined);
        return next;
    };
    return {
        paths,
        sessionStatePath,
        async ensureLayout() {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            return paths;
        },
        async readState() {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            return normalizeState(await readJsonFile(sessionStatePath));
        },
        async writeState(nextState) {
            return runExclusive(async () => {
                await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
                const normalized = normalizeState(nextState);
                await writeJsonFileAtomically(sessionStatePath, normalized);
                return normalized;
            });
        },
        async updateState(updater) {
            return runExclusive(async () => {
                await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
                const current = normalizeState(await readJsonFile(sessionStatePath));
                const nextState = await updater(current);
                const normalized = normalizeState(nextState);
                await writeJsonFileAtomically(sessionStatePath, normalized);
                return normalized;
            });
        },
        async writeSession(record) {
            await this.updateState(state => ({
                ...state,
                sessions: [...state.sessions.filter(session => session.sessionId !== record.sessionId), record],
            }));
            return record;
        },
        async writeTaskRun(record) {
            await this.updateState(state => ({
                ...state,
                taskRuns: [...state.taskRuns.filter(run => run.runId !== record.runId), record],
            }));
            return record;
        },
        async appendTranscriptItems(items) {
            if (!items.length) {
                return items;
            }
            let persistedItems = [];
            await this.updateState(state => ({
                ...state,
                transcriptItems: (() => {
                    const seenIds = new Set(state.transcriptItems.map(item => item.id));
                    const nextItems = [];
                    for (const item of items) {
                        if (seenIds.has(item.id)) {
                            continue;
                        }
                        seenIds.add(item.id);
                        nextItems.push(item);
                    }
                    const nextStateItems = [...state.transcriptItems, ...nextItems].slice(-MAX_TRANSCRIPT_ITEMS);
                    const persistedIds = new Set(nextStateItems.map(item => item.id));
                    persistedItems = nextItems.filter(item => persistedIds.has(item.id));
                    return nextStateItems;
                })(),
            }));
            return persistedItems;
        },
        async appendPublicStatusSnapshots(items) {
            if (!items.length) {
                return items;
            }
            let persistedSnapshots = [];
            const snapshotKey = (snapshot) => JSON.stringify([
                snapshot.sessionId,
                snapshot.taskRunId || '',
                snapshot.status || '',
                snapshot.rawEvent || '',
                String(snapshot.mapped),
                String(snapshot.resolvedAt),
            ]);
            await this.updateState(state => ({
                ...state,
                publicStatusSnapshots: (() => {
                    const seenKeys = new Set(state.publicStatusSnapshots.map(snapshotKey));
                    const nextSnapshots = [];
                    for (const snapshot of items) {
                        const incomingKey = snapshotKey(snapshot);
                        if (seenKeys.has(incomingKey)) {
                            continue;
                        }
                        seenKeys.add(incomingKey);
                        nextSnapshots.push(snapshot);
                    }
                    const nextStateSnapshots = [...state.publicStatusSnapshots, ...nextSnapshots]
                        .slice(-MAX_PUBLIC_STATUS_SNAPSHOTS);
                    const persistedKeys = new Set(nextStateSnapshots.map(snapshotKey));
                    persistedSnapshots = nextSnapshots.filter(snapshot => persistedKeys.has(snapshotKey(snapshot)));
                    return nextStateSnapshots;
                })(),
            }));
            return persistedSnapshots;
        },
        async setLoopCursor(role, cursor) {
            await this.updateState(state => ({
                ...state,
                cursors: {
                    ...state.cursors,
                    [role]: cursor,
                },
            }));
            return cursor;
        },
        async readLoopCursor(role) {
            const state = await this.readState();
            return state.cursors[role];
        },
    };
}
