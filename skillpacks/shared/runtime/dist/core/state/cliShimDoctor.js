"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCliShimDoctorCheck = buildCliShimDoctorCheck;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const CANONICAL_BIN_SEGMENTS = ['.metabot', 'bin'];
const LEGACY_BIN_SEGMENTS = ['.agent-connect', 'bin'];
const PRIMARY_CLI_PATH = 'metabot';
const OVERRIDE_ENV_KEYS = {
    canonicalBinDir: 'METABOT_BIN_DIR',
    legacyBinDir: 'METABOT_LEGACY_BIN_DIR',
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
async function isLegacyCompatibilityForwarder(legacyShimPath, canonicalShimPath) {
    try {
        const content = await node_fs_1.promises.readFile(legacyShimPath, 'utf8');
        const canonicalAssignmentMatches = content.includes(`CANONICAL_METABOT_BIN="${canonicalShimPath}"`)
            || content.includes(`CANONICAL_METABOT_BIN=${canonicalShimPath}`);
        return canonicalAssignmentMatches
            && content.includes('exec "$CANONICAL_METABOT_BIN" "$@"');
    }
    catch (error) {
        if (error?.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
function resolveConfiguredDir(configuredDir, cwd, fallbackDir) {
    const trimmed = configuredDir?.trim();
    return trimmed ? node_path_1.default.resolve(cwd, trimmed) : fallbackDir;
}
function readPathEntries(envPath, cwd) {
    return String(envPath || '')
        .split(node_path_1.default.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => node_path_1.default.resolve(cwd, entry));
}
async function buildCliShimDoctorCheck(systemHomeDir, env, cwd) {
    const canonicalBinDir = resolveConfiguredDir(env[OVERRIDE_ENV_KEYS.canonicalBinDir], cwd, node_path_1.default.join(systemHomeDir, ...CANONICAL_BIN_SEGMENTS));
    const legacyBinDir = resolveConfiguredDir(env[OVERRIDE_ENV_KEYS.legacyBinDir], cwd, node_path_1.default.join(systemHomeDir, ...LEGACY_BIN_SEGMENTS));
    const canonicalShimPath = node_path_1.default.join(canonicalBinDir, PRIMARY_CLI_PATH);
    const legacyShimPath = node_path_1.default.join(legacyBinDir, PRIMARY_CLI_PATH);
    const [canonicalShimExists, legacyShimExists] = await Promise.all([
        pathExists(canonicalShimPath),
        pathExists(legacyShimPath),
    ]);
    const legacyForwardsToCanonical = canonicalShimExists && legacyShimExists
        ? await isLegacyCompatibilityForwarder(legacyShimPath, canonicalShimPath)
        : false;
    const pathEntries = readPathEntries(env.PATH, cwd);
    const canonicalBinIndex = pathEntries.indexOf(node_path_1.default.resolve(canonicalBinDir));
    const legacyBinIndex = pathEntries.indexOf(node_path_1.default.resolve(legacyBinDir));
    const legacyShadowsCanonical = canonicalShimExists
        && legacyShimExists
        && legacyBinIndex !== -1
        && (canonicalBinIndex === -1 || legacyBinIndex < canonicalBinIndex);
    if (legacyShadowsCanonical && !legacyForwardsToCanonical) {
        return {
            code: 'canonical_cli_shim_preferred',
            ok: false,
            message: 'Legacy MetaBot CLI shim precedes the canonical MetaBot CLI shim on PATH.',
            canonicalShimPath,
            legacyShimPath,
        };
    }
    return {
        code: 'canonical_cli_shim_preferred',
        ok: true,
        canonicalShimPath: canonicalShimExists ? canonicalShimPath : null,
        legacyShimPath: legacyShimExists ? legacyShimPath : null,
        legacyCompatibilityForwarder: legacyForwardsToCanonical,
    };
}
