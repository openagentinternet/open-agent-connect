"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectDaemonStartupDiagnostics = collectDaemonStartupDiagnostics;
exports.formatDaemonStartupTimeoutMessage = formatDaemonStartupTimeoutMessage;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../core/state/paths");
const daemonStateStore_1 = require("../core/state/daemonStateStore");
async function readDaemonLockInfo(lockPath) {
    try {
        const raw = await node_fs_1.promises.readFile(lockPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            ownerId: typeof parsed.ownerId === 'string' ? parsed.ownerId : undefined,
            pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
            acquiredAt: typeof parsed.acquiredAt === 'number' ? parsed.acquiredAt : undefined,
        };
    }
    catch {
        return null;
    }
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
function formatDaemonRecord(record) {
    if (!record) {
        return 'missing';
    }
    return `present (baseUrl=${record.baseUrl}, port=${record.port}, pid=${record.pid}, startedAt=${record.startedAt}, configHash=${record.configHash ?? 'null'})`;
}
function formatLockInfo(lockInfo, lockOwnerAlive) {
    if (!lockInfo) {
        return 'missing';
    }
    const pidText = typeof lockInfo.pid === 'number' ? String(lockInfo.pid) : 'none';
    const acquiredAtText = typeof lockInfo.acquiredAt === 'number' ? String(lockInfo.acquiredAt) : 'unknown';
    const ownerAliveText = lockOwnerAlive == null ? 'unknown' : lockOwnerAlive ? 'yes' : 'no';
    return `present (ownerId=${lockInfo.ownerId ?? 'unknown'}, pid=${pidText}, acquiredAt=${acquiredAtText}, ownerAlive=${ownerAliveText})`;
}
async function collectDaemonStartupDiagnostics(input) {
    const systemHomeDir = node_path_1.default.resolve(input.systemHomeDir);
    const paths = (0, paths_1.resolveMetabotDaemonPaths)(systemHomeDir);
    const daemonRecord = await (0, daemonStateStore_1.createDaemonStateStore)(paths).readDaemon();
    const lockInfo = await readDaemonLockInfo(paths.daemonLockPath);
    const lockOwnerAlive = typeof lockInfo?.pid === 'number'
        ? isProcessAlive(lockInfo.pid)
        : null;
    return {
        systemHomeDir,
        preferredPort: input.preferredPort,
        daemonStatePath: paths.daemonStatePath,
        lockPath: paths.daemonLockPath,
        daemonRecord,
        lockInfo,
        lockOwnerAlive,
    };
}
function formatDaemonStartupTimeoutMessage(snapshot) {
    return [
        'Timed out while starting the local MetaBot daemon.',
        `System home: ${snapshot.systemHomeDir}`,
        `Preferred port: ${snapshot.preferredPort}`,
        `daemon.json: ${snapshot.daemonStatePath} (${formatDaemonRecord(snapshot.daemonRecord)})`,
        `daemon.lock: ${snapshot.lockPath} (${formatLockInfo(snapshot.lockInfo, snapshot.lockOwnerAlive)})`,
    ].join('\n');
}
