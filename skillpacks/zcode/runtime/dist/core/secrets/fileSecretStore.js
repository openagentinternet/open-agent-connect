"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFileSecretStore = createFileSecretStore;
const node_fs_1 = require("node:fs");
const paths_1 = require("../state/paths");
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const SECRET_FILE_MODE = 0o600;
const EMPTY_IDENTITY_SECRETS = {};
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed
            && typeof parsed === 'object'
            && !Array.isArray(parsed)
            && Object.keys(parsed).length === 0) {
            return null;
        }
        return parsed;
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
async function applySecretFileMode(filePath) {
    if (process.platform === 'win32') {
        return;
    }
    try {
        await node_fs_1.promises.chmod(filePath, SECRET_FILE_MODE);
    }
    catch (error) {
        const code = error.code;
        if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EINVAL') {
            return;
        }
        throw error;
    }
}
async function writeIdentitySecretsFile(filePath, value) {
    await node_fs_1.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        mode: SECRET_FILE_MODE,
    });
    await applySecretFileMode(filePath);
}
async function ensureIdentitySecretLayout(paths) {
    await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
    try {
        await node_fs_1.promises.access(paths.identitySecretsPath);
    }
    catch (error) {
        const code = error.code;
        if (code !== 'ENOENT') {
            throw error;
        }
        await writeIdentitySecretsFile(paths.identitySecretsPath, EMPTY_IDENTITY_SECRETS);
        return;
    }
    await applySecretFileMode(paths.identitySecretsPath);
}
function createFileSecretStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    return {
        paths,
        async ensureLayout() {
            await ensureIdentitySecretLayout(paths);
            return paths;
        },
        async readIdentitySecrets() {
            await ensureIdentitySecretLayout(paths);
            return readJsonFile(paths.identitySecretsPath);
        },
        async writeIdentitySecrets(value) {
            await ensureIdentitySecretLayout(paths);
            await writeIdentitySecretsFile(paths.identitySecretsPath, value);
            return paths.identitySecretsPath;
        },
        async deleteIdentitySecrets() {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            await writeIdentitySecretsFile(paths.identitySecretsPath, EMPTY_IDENTITY_SECRETS);
        },
    };
}
