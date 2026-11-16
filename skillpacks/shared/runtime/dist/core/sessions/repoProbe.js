"use strict";
/**
 * Best-effort repo identity for a session cwd (local session adapters P1).
 *
 * Directory listings show `repo@branch` like reason-network does: the repo
 * slug comes from the origin remote basename (falling back to the directory
 * basename), the branch from `git rev-parse --abbrev-ref HEAD`. Everything
 * is bounded and never throws — a cwd that is not a work tree just yields
 * the directory basename and an empty branch.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeRepoIdentity = probeRepoIdentity;
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const PROBE_TIMEOUT_MS = 1_500;
const PROBE_MAX_BUFFER_BYTES = 64 * 1024;
function runGit(cwd, args) {
    return new Promise((resolve) => {
        (0, node_child_process_1.execFile)('git', args, { cwd, timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER_BYTES, windowsHide: true }, (error, stdout) => {
            resolve(error ? '' : String(stdout).trim());
        });
    });
}
function repoSlugFromRemoteUrl(remoteUrl) {
    const withoutSuffix = remoteUrl.replace(/\.git$/i, '');
    const lastSegment = withoutSuffix.split(/[/:]/).filter(Boolean).pop() ?? '';
    return lastSegment;
}
async function probeRepoIdentity(cwd) {
    const directoryBasename = node_path_1.default.basename(cwd).trim();
    try {
        const [branch, remoteUrl] = await Promise.all([
            runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
            runGit(cwd, ['remote', 'get-url', 'origin']),
        ]);
        const repo = repoSlugFromRemoteUrl(remoteUrl) || directoryBasename;
        // Detached HEAD reads as HEAD; report it but it is still a branch-ish marker.
        return { repo, branch };
    }
    catch {
        return { repo: directoryBasename, branch: '' };
    }
}
