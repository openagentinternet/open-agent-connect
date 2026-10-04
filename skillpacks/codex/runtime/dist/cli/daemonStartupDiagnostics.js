"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readDaemonLockInfo = readDaemonLockInfo;
exports.isProcessAlive = isProcessAlive;
exports.classifyDaemonRecordState = classifyDaemonRecordState;
exports.collectDaemonStartupDiagnostics = collectDaemonStartupDiagnostics;
exports.formatDaemonStartupTimeoutMessage = formatDaemonStartupTimeoutMessage;
exports.formatDaemonChildStartCause = formatDaemonChildStartCause;
exports.isPermissionDeniedErrno = isPermissionDeniedErrno;
exports.formatPermissionDeniedStartupError = formatPermissionDeniedStartupError;
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
function classifyDaemonRecordState(daemonRecord) {
    if (!daemonRecord || typeof daemonRecord.pid !== 'number') {
        return 'missing';
    }
    return isProcessAlive(daemonRecord.pid) ? 'alive' : 'stale';
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
        startupLogPath: paths.daemonLogPath,
        daemonRecord,
        daemonRecordState: classifyDaemonRecordState(daemonRecord),
        lockInfo,
        lockOwnerAlive,
    };
}
function formatDaemonStartupTimeoutMessage(snapshot, childCause = {}) {
    const lines = [
        'Timed out while starting the local MetaBot daemon.',
        'The timeout is the symptom, not the cause — the daemon process output and any spawn failure are written to the startup log below.',
        `System home: ${snapshot.systemHomeDir}`,
        `Preferred port: ${snapshot.preferredPort}`,
        `daemon.json: ${snapshot.daemonStatePath} (${formatDaemonRecord(snapshot.daemonRecord)})`,
        `daemon.json state: ${snapshot.daemonRecordState}${snapshot.daemonRecordState === 'stale' ? ' — a leftover daemon.json from a daemon that died without cleanup' : ''}`,
        `daemon.lock: ${snapshot.lockPath} (${formatLockInfo(snapshot.lockInfo, snapshot.lockOwnerAlive)})`,
    ];
    const childCauseLines = formatDaemonChildStartCause(childCause);
    if (childCauseLines.length > 0) {
        lines.push(...childCauseLines);
    }
    lines.push(`Startup log (real cause): ${snapshot.startupLogPath}`);
    return lines.join('\n');
}
function formatDaemonChildStartCause(childCause) {
    const lines = [];
    if (childCause.spawnError) {
        lines.push(`Daemon spawn failed: ${childCause.spawnError}`);
    }
    if (childCause.exitCode != null) {
        lines.push(`Daemon process exited before becoming reachable (exit code ${childCause.exitCode}).`);
    }
    if (childCause.signal) {
        lines.push(`Daemon process was terminated before becoming reachable (signal ${childCause.signal}).`);
    }
    return lines;
}
function isPermissionDeniedErrno(error) {
    const code = error?.code;
    return code === 'EPERM' || code === 'EACCES' || code === 'EROFS';
}
/**
 * EPERM/EACCES on the daemon state paths is ambiguous between a real
 * filesystem permission problem and an execution sandbox (agent-host
 * seatbelt) denying writes outside the workspace. Attach stat context for
 * the target path plus concrete next steps so the operator can tell the two
 * apart instead of chasing the wrong lead.
 */
async function formatPermissionDeniedStartupError(error) {
    if (!isPermissionDeniedErrno(error)) {
        throw error;
    }
    const errnoError = error;
    const targetPath = errnoError.path ?? '<unknown path>';
    const statLines = [];
    try {
        const stat = await node_fs_1.promises.stat(targetPath);
        statLines.push(`stat ${targetPath}: exists, ${(stat.uid !== undefined) ? `owner uid=${stat.uid} gid=${stat.gid}` : 'owner unknown'}, mode=${(stat.mode & 0o777).toString(8)}`);
    }
    catch (statError) {
        const statCode = statError.code;
        statLines.push(`stat ${targetPath}: ${statCode === 'ENOENT' ? 'does not exist' : `unavailable (${statCode ?? 'unknown error'})`}`);
    }
    return [
        `Failed to prepare the local MetaBot daemon runtime: ${errnoError.code}: ${errnoError.message}`,
        ...statLines,
        'This is either a real permission problem or an execution sandbox denying writes to the MetaBot home directory (common for agent hosts).',
        'Next steps:',
        `  1. Inspect the path: ls -le ${node_path_1.default.dirname(targetPath)}`,
        '  2. If you run inside a sandboxed agent host, grant write access to ~/.metabot (or run the command outside the sandbox).',
        '  3. If permissions are truly wrong, fix ownership (chown) or permissions (chmod) for the path above.',
    ].join('\n');
}
