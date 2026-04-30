"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSystemUninstall = runSystemUninstall;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("./types");
const FULL_ERASE_TOKEN = 'DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS';
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function isNotFound(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        return parsed;
    }
    catch (error) {
        if (isNotFound(error)) {
            return null;
        }
        throw error;
    }
}
function resolveBuiltInHostRoots(systemHomeDir, env) {
    const codexHome = normalizeText(env.CODEX_HOME) || node_path_1.default.join(systemHomeDir, '.codex');
    const claudeHome = normalizeText(env.CLAUDE_HOME) || node_path_1.default.join(systemHomeDir, '.claude');
    const openclawHome = normalizeText(env.OPENCLAW_HOME) || node_path_1.default.join(systemHomeDir, '.openclaw');
    return [
        node_path_1.default.join(codexHome, 'skills'),
        node_path_1.default.join(claudeHome, 'skills'),
        node_path_1.default.join(openclawHome, 'skills'),
    ];
}
async function removeGuardedHostSymlinks(hostSkillRoot) {
    try {
        const dirents = await node_fs_1.promises.readdir(hostSkillRoot, { withFileTypes: true });
        const removed = [];
        for (const entry of dirents) {
            if (!entry.isSymbolicLink() || !entry.name.startsWith('metabot-')) {
                continue;
            }
            const linkPath = node_path_1.default.join(hostSkillRoot, entry.name);
            let target = '';
            try {
                target = await node_fs_1.promises.readlink(linkPath);
            }
            catch {
                continue;
            }
            if (!target.includes('.metabot/skills/metabot-')) {
                continue;
            }
            await node_fs_1.promises.rm(linkPath, { force: true });
            removed.push(linkPath);
        }
        return removed;
    }
    catch (error) {
        if (isNotFound(error)) {
            return [];
        }
        throw error;
    }
}
async function stopDaemonBestEffort(systemHomeDir) {
    const activeHomePath = node_path_1.default.join(systemHomeDir, '.metabot', 'manager', 'active-home.json');
    const activeState = await readJsonFile(activeHomePath);
    const activeHomeDir = normalizeText(activeState?.homeDir);
    if (!activeHomeDir) {
        return { attempted: false, stopped: false };
    }
    const daemonStatePath = node_path_1.default.join(activeHomeDir, '.runtime', 'daemon.json');
    const daemonState = await readJsonFile(daemonStatePath);
    const pid = Number(daemonState?.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
        return { attempted: false, stopped: false };
    }
    try {
        process.kill(pid, 'SIGTERM');
        return { attempted: true, stopped: true };
    }
    catch (error) {
        const code = error.code;
        if (code === 'ESRCH') {
            return { attempted: true, stopped: false };
        }
        return { attempted: true, stopped: false };
    }
}
async function removeLegacyShimIfRecognized(systemHomeDir) {
    const legacyShimPath = node_path_1.default.join(systemHomeDir, '.agent-connect', 'bin', 'metabot');
    try {
        const body = await node_fs_1.promises.readFile(legacyShimPath, 'utf8');
        if (!body.includes('Canonical MetaBot CLI shim')) {
            return false;
        }
        await node_fs_1.promises.rm(legacyShimPath, { force: true });
        return true;
    }
    catch (error) {
        if (isNotFound(error)) {
            return false;
        }
        throw error;
    }
}
async function runTier1Uninstall(systemHomeDir, env) {
    const daemonStatus = await stopDaemonBestEffort(systemHomeDir);
    const roots = resolveBuiltInHostRoots(systemHomeDir, env);
    const removedHostBindings = [];
    for (const root of roots) {
        const removed = await removeGuardedHostSymlinks(root);
        removedHostBindings.push(...removed);
    }
    const cliShimPath = node_path_1.default.join(systemHomeDir, '.metabot', 'bin', 'metabot');
    let removedCliShim = false;
    try {
        await node_fs_1.promises.rm(cliShimPath, { force: true });
        removedCliShim = true;
    }
    catch (error) {
        if (!isNotFound(error)) {
            throw error;
        }
    }
    const removedLegacyShim = await removeLegacyShimIfRecognized(systemHomeDir);
    return {
        tier: 'safe',
        removedHostBindings,
        removedCliShim,
        removedLegacyShim,
        daemonStopAttempted: daemonStatus.attempted,
        daemonStopped: daemonStatus.stopped,
        preservedSensitiveData: true,
    };
}
async function runSystemUninstall(input) {
    const tier1Result = await runTier1Uninstall(input.systemHomeDir, input.env);
    if (!input.all) {
        return tier1Result;
    }
    if (!input.confirmToken) {
        throw new types_1.SystemCommandError('confirmation_required', 'Full erase requires --confirm-token DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS.', true);
    }
    if (input.confirmToken !== FULL_ERASE_TOKEN) {
        throw new types_1.SystemCommandError('invalid_confirmation_token', 'Invalid --confirm-token for full erase uninstall.');
    }
    await node_fs_1.promises.rm(node_path_1.default.join(input.systemHomeDir, '.metabot'), { recursive: true, force: true });
    return {
        ...tier1Result,
        tier: 'full_erase',
        preservedSensitiveData: false,
    };
}
