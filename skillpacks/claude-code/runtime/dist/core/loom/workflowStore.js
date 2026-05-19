"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLoomWorkflowPaths = resolveLoomWorkflowPaths;
exports.createLoomWorkflowStore = createLoomWorkflowStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
function resolvePaths(homeDirOrPaths) {
    return typeof homeDirOrPaths === 'string'
        ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths)
        : homeDirOrPaths;
}
function sanitizePathSegment(value) {
    const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, '_');
    return sanitized || 'unknown';
}
function resolveLoomWorkflowPaths(homeDirOrPaths, input) {
    const paths = resolvePaths(homeDirOrPaths);
    const loomRuntimeRoot = node_path_1.default.join(paths.runtimeRoot, 'loom');
    const workflowsRoot = node_path_1.default.join(loomRuntimeRoot, 'workflows');
    const stagingRoot = node_path_1.default.join(loomRuntimeRoot, 'staging');
    const workspacesRoot = node_path_1.default.join(loomRuntimeRoot, 'workspaces');
    const logsRoot = node_path_1.default.join(loomRuntimeRoot, 'logs');
    const taskSegment = sanitizePathSegment(input.taskPinId);
    const claimSegment = sanitizePathSegment(input.claimPinId ?? 'pending-claim');
    const runSegment = sanitizePathSegment(input.localRunId ?? 'run');
    const taskLogsRoot = node_path_1.default.join(logsRoot, taskSegment);
    return {
        loomRuntimeRoot,
        workflowsRoot,
        stagingRoot,
        workspacesRoot,
        logsRoot,
        workflowPath: node_path_1.default.join(workflowsRoot, taskSegment, `${claimSegment}.json`),
        stagingRepoPath: node_path_1.default.join(stagingRoot, taskSegment, runSegment, 'repo'),
        workspaceRepoPath: node_path_1.default.join(workspacesRoot, taskSegment, claimSegment, 'repo'),
        taskLogsRoot,
    };
}
function normalizeWorkflowState(state, options) {
    return {
        ...state,
        version: 1,
        statuses: Array.isArray(state.statuses) ? state.statuses : [],
        updatedAt: options.refreshUpdatedAt ? new Date().toISOString() : state.updatedAt,
    };
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
const requiredStringFields = [
    'developerMetaBotSlug',
    'repoUri',
    'baseBranch',
    'upstreamRemote',
    'forkRemote',
    'branchName',
    'workspacePath',
    'updatedAt',
];
function hasRequiredStringFields(record) {
    return requiredStringFields.every((field) => {
        const value = record[field];
        return isNonEmptyString(value);
    });
}
const statusValues = new Set([
    'started',
    'in_progress',
    'completed',
    'failed',
]);
function isStringIfPresent(value) {
    return value === undefined || typeof value === 'string';
}
function isStringOrNullIfPresent(value) {
    return value === undefined || typeof value === 'string' || value === null;
}
function isBooleanOrNullIfPresent(value) {
    return value === undefined || typeof value === 'boolean' || value === null;
}
function normalizeCommitRecord(value) {
    if (!isRecord(value)) {
        return null;
    }
    if (!isNonEmptyString(value.sha) || typeof value.message !== 'string') {
        return null;
    }
    if (!Array.isArray(value.files) || !value.files.every((file) => typeof file === 'string')) {
        return null;
    }
    return {
        sha: value.sha,
        message: value.message,
        files: value.files,
    };
}
function normalizeStatusRecord(value) {
    if (!isRecord(value)) {
        return null;
    }
    if (!isNonEmptyString(value.roundId) || typeof value.status !== 'string') {
        return null;
    }
    if (!statusValues.has(value.status)) {
        return null;
    }
    const pinId = value.pinId;
    const processLogPath = value.processLogPath;
    const processLogUri = value.processLogUri;
    const llmSessionId = value.llmSessionId;
    const checksPassed = value.checksPassed;
    if (!isStringIfPresent(pinId)
        || !isStringIfPresent(processLogPath)
        || !isStringIfPresent(processLogUri)
        || !isStringOrNullIfPresent(llmSessionId)
        || !isBooleanOrNullIfPresent(checksPassed)) {
        return null;
    }
    if (!Array.isArray(value.commits)) {
        return null;
    }
    const commits = value.commits.map(normalizeCommitRecord);
    if (commits.some((commit) => commit === null)) {
        return null;
    }
    return {
        roundId: value.roundId,
        status: value.status,
        ...(pinId !== undefined ? { pinId } : {}),
        ...(processLogPath !== undefined ? { processLogPath } : {}),
        ...(processLogUri !== undefined ? { processLogUri } : {}),
        ...(llmSessionId !== undefined ? { llmSessionId } : {}),
        commits: commits,
        ...(checksPassed !== undefined ? { checksPassed } : {}),
    };
}
function normalizeStatusRecords(value) {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        return null;
    }
    const statuses = value.map(normalizeStatusRecord);
    return statuses.some((status) => status === null)
        ? null
        : statuses;
}
function normalizeWorkflowStateForRead(value, taskPinId, claimPinId) {
    if (!isRecord(value)) {
        return null;
    }
    const record = value;
    if (!(record.version === 1
        && record.taskPinId === taskPinId
        && record.claimPinId === claimPinId
        && hasRequiredStringFields(record))) {
        return null;
    }
    const statuses = normalizeStatusRecords(record.statuses);
    if (!statuses) {
        return null;
    }
    return normalizeWorkflowState({
        ...record,
        version: 1,
        taskPinId,
        claimPinId,
        statuses,
    }, { refreshUpdatedAt: false });
}
async function writeJsonFileAtomically(filePath, payload) {
    const directory = node_path_1.default.dirname(filePath);
    const basename = node_path_1.default.basename(filePath);
    const tmpPath = node_path_1.default.join(directory, `${basename}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    try {
        await node_fs_1.promises.writeFile(tmpPath, payload, 'utf8');
        await node_fs_1.promises.rename(tmpPath, filePath);
    }
    catch (error) {
        try {
            await node_fs_1.promises.unlink(tmpPath);
        }
        catch {
            // Best-effort cleanup after a failed atomic write attempt.
        }
        throw error;
    }
}
function createLoomWorkflowStore(homeDirOrPaths) {
    const paths = resolvePaths(homeDirOrPaths);
    return {
        paths,
        resolve(taskPinId, claimPinId, localRunId) {
            return resolveLoomWorkflowPaths(paths, { taskPinId, claimPinId, localRunId });
        },
        async read(taskPinId, claimPinId) {
            const resolved = resolveLoomWorkflowPaths(paths, { taskPinId, claimPinId });
            let raw;
            try {
                raw = await node_fs_1.promises.readFile(resolved.workflowPath, 'utf8');
            }
            catch (error) {
                if (error.code === 'ENOENT') {
                    return null;
                }
                throw error;
            }
            try {
                const parsed = JSON.parse(raw);
                return normalizeWorkflowStateForRead(parsed, taskPinId, claimPinId);
            }
            catch {
                return null;
            }
        },
        async write(state) {
            const normalized = normalizeWorkflowState(state, { refreshUpdatedAt: true });
            const resolved = resolveLoomWorkflowPaths(paths, normalized);
            await node_fs_1.promises.mkdir(node_path_1.default.dirname(resolved.workflowPath), { recursive: true });
            await writeJsonFileAtomically(resolved.workflowPath, `${JSON.stringify(normalized, null, 2)}\n`);
            return normalized;
        },
    };
}
