"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCliShimDoctorCheck = buildCliShimDoctorCheck;
exports.buildCliRuntimeDoctorCheck = buildCliRuntimeDoctorCheck;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const CANONICAL_BIN_SEGMENTS = ['.metabot', 'bin'];
const PRIMARY_CLI_PATH = 'metabot';
const OVERRIDE_ENV_KEYS = {
    canonicalBinDir: 'METABOT_BIN_DIR',
};
async function pathExists(targetPath) {
    try {
        await node_fs_1.promises.stat(targetPath);
        return true;
    }
    catch (error) {
        if (error?.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
async function readTextIfFile(targetPath) {
    try {
        return await node_fs_1.promises.readFile(targetPath, 'utf8');
    }
    catch (error) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
function normalizePathValue(value, cwd) {
    const trimmed = value?.trim();
    return trimmed ? node_path_1.default.resolve(cwd, trimmed) : null;
}
function decodeShellDoubleQuotedValue(value) {
    try {
        return JSON.parse(`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    }
    catch {
        return value;
    }
}
function extractCanonicalTargetPath(shimBody, cwd) {
    if (!shimBody) {
        return null;
    }
    const preferredMatch = shimBody.match(/^PREFERRED_CLI_ENTRY="([^"]+)"/m);
    if (preferredMatch?.[1]) {
        return normalizePathValue(decodeShellDoubleQuotedValue(preferredMatch[1]), cwd);
    }
    const execMatch = shimBody.match(/exec "\$NODE_BIN" "([^"]+)" "\$@"/m);
    if (execMatch?.[1]) {
        return normalizePathValue(decodeShellDoubleQuotedValue(execMatch[1]), cwd);
    }
    return null;
}
function resolveConfiguredDir(configuredDir, cwd, fallbackDir) {
    const trimmed = configuredDir?.trim();
    return trimmed ? node_path_1.default.resolve(cwd, trimmed) : fallbackDir;
}
async function buildCliShimDoctorCheck(systemHomeDir, env, cwd) {
    const canonicalBinDir = resolveConfiguredDir(env[OVERRIDE_ENV_KEYS.canonicalBinDir], cwd, node_path_1.default.join(systemHomeDir, ...CANONICAL_BIN_SEGMENTS));
    const canonicalShimPath = node_path_1.default.join(canonicalBinDir, PRIMARY_CLI_PATH);
    const canonicalShimExists = await pathExists(canonicalShimPath);
    return {
        code: 'canonical_cli_shim_preferred',
        ok: true,
        canonicalShimPath: canonicalShimExists ? canonicalShimPath : null,
    };
}
async function buildCliRuntimeDoctorCheck(systemHomeDir, env, cwd, currentEntryPath) {
    const canonicalBinDir = resolveConfiguredDir(env[OVERRIDE_ENV_KEYS.canonicalBinDir], cwd, node_path_1.default.join(systemHomeDir, ...CANONICAL_BIN_SEGMENTS));
    const canonicalShimPath = node_path_1.default.join(canonicalBinDir, PRIMARY_CLI_PATH);
    if (!(await pathExists(canonicalShimPath))) {
        return null;
    }
    const canonicalTargetPath = extractCanonicalTargetPath(await readTextIfFile(canonicalShimPath), cwd);
    const normalizedCurrentEntryPath = normalizePathValue(currentEntryPath ?? undefined, cwd);
    if (!canonicalTargetPath || !normalizedCurrentEntryPath) {
        return null;
    }
    return {
        code: 'cli_runtime_matches_canonical_shim',
        ok: node_path_1.default.resolve(normalizedCurrentEntryPath) === node_path_1.default.resolve(canonicalTargetPath),
        canonicalShimPath,
        canonicalTargetPath,
        currentEntryPath: normalizedCurrentEntryPath,
    };
}
