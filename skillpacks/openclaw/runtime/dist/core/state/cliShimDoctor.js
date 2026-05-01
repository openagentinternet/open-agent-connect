"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCliShimDoctorCheck = buildCliShimDoctorCheck;
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
