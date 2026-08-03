"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROVIDER_RUN_WORKSPACE_SWEEP_INTERVAL_MS = exports.PROVIDER_RUN_WORKSPACE_TTL_MS = void 0;
exports.resolveProviderRunWorkspaceDir = resolveProviderRunWorkspaceDir;
exports.removeProviderRunWorkspace = removeProviderRunWorkspace;
exports.sweepProviderRunWorkspaces = sweepProviderRunWorkspaces;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
// Provider order attempts execute in per-run workspaces under
// <profile>/.runtime/a2a-provider-runs/<runId>/attempt-<n>-<runtime>. Delivery
// uploads every referenced artifact to the chain (metafile:// URIs) and
// scrubs local paths from the delivered text, so once an order is terminal
// nothing local references the workspace anymore and it is deleted. Attempts
// abandoned before a terminal state (daemon crash, executor killed) are
// reclaimed by the TTL sweep below.
exports.PROVIDER_RUN_WORKSPACE_TTL_MS = 24 * 60 * 60_000;
exports.PROVIDER_RUN_WORKSPACE_SWEEP_INTERVAL_MS = 60 * 60_000;
function providerRunsRoot(projectRoot) {
    return node_path_1.default.join(node_path_1.default.resolve(projectRoot), '.runtime', 'a2a-provider-runs');
}
// Resolves the run directory (<runsRoot>/<runId>) that owns one attempt
// workspace. Returns null for anything that is not exactly
// <runsRoot>/<runId>/<attemptId> so a malformed metadata path can never
// delete an arbitrary directory. Both sides are realpath'd best-effort
// because the runner stores attemptWorkspaceCwd as a real path.
async function resolveProviderRunWorkspaceDir(projectRoot, attemptWorkspaceCwd) {
    const normalized = typeof attemptWorkspaceCwd === 'string' ? attemptWorkspaceCwd.trim() : '';
    if (!normalized) {
        return null;
    }
    const runsRoot = providerRunsRoot(projectRoot);
    const [realRunsRoot, realAttempt] = await Promise.all([
        node_fs_1.promises.realpath(runsRoot).catch(() => runsRoot),
        node_fs_1.promises.realpath(normalized).catch(() => node_path_1.default.resolve(normalized)),
    ]);
    const relative = node_path_1.default.relative(realRunsRoot, realAttempt);
    const segments = relative.split(node_path_1.default.sep);
    if (segments.length !== 2
        || !segments[0]
        || !segments[1]
        || relative.startsWith('..')
        || node_path_1.default.isAbsolute(relative)) {
        return null;
    }
    return node_path_1.default.join(runsRoot, segments[0]);
}
// Best-effort removal of the whole run workspace (all attempts of one run)
// once the owning order reached a terminal state. Never throws.
async function removeProviderRunWorkspace(projectRoot, attemptWorkspaceCwd) {
    const runDir = await resolveProviderRunWorkspaceDir(projectRoot, attemptWorkspaceCwd);
    if (!runDir) {
        return false;
    }
    try {
        await node_fs_1.promises.rm(runDir, { recursive: true, force: true });
        return true;
    }
    catch {
        return false;
    }
}
// Directory mtimes track entry creation/removal, which is enough here: an
// attempt still producing output keeps creating files (provider sessions are
// capped at 30 minutes), while an abandoned attempt ages out after the TTL.
async function readNewestChildMtimeMs(runDir) {
    try {
        const runStat = await node_fs_1.promises.stat(runDir);
        let newest = runStat.mtimeMs;
        const children = await node_fs_1.promises.readdir(runDir);
        for (const child of children) {
            const childStat = await node_fs_1.promises.stat(node_path_1.default.join(runDir, child)).catch(() => null);
            if (childStat) {
                newest = Math.max(newest, childStat.mtimeMs);
            }
        }
        return newest;
    }
    catch {
        return null;
    }
}
// Janitor for abandoned run workspaces: removes every run directory whose
// newest attempt mtime is older than the TTL. Never throws; a busy or
// unreadable directory is kept and retried on the next sweep.
async function sweepProviderRunWorkspaces(input) {
    const ttlMs = Math.max(0, Math.floor(input.ttlMs ?? exports.PROVIDER_RUN_WORKSPACE_TTL_MS));
    const nowMs = input.nowMs ?? Date.now();
    const runsRoot = providerRunsRoot(input.projectRoot);
    let entries;
    try {
        entries = await node_fs_1.promises.readdir(runsRoot, { withFileTypes: true });
    }
    catch {
        return { removedRunIds: [] };
    }
    const removedRunIds = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const runDir = node_path_1.default.join(runsRoot, entry.name);
        const newestMtimeMs = await readNewestChildMtimeMs(runDir);
        if (newestMtimeMs === null || nowMs - newestMtimeMs < ttlMs) {
            continue;
        }
        try {
            await node_fs_1.promises.rm(runDir, { recursive: true, force: true });
            removedRunIds.push(entry.name);
        }
        catch {
            // Best effort: retry on the next sweep.
        }
    }
    return { removedRunIds };
}
