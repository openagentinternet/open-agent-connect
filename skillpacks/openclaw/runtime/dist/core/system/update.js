"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSystemUpdate = runSystemUpdate;
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const types_1 = require("./types");
const NPM_PACKAGE_NAME = 'open-agent-connect';
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeNpmVersionSpecifier(version) {
    const normalized = normalizeText(version);
    if (!normalized || normalized === 'latest') {
        return 'latest';
    }
    return /^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(normalized) ? normalized.slice(1) : normalized;
}
function buildNpmPackageSpec(version) {
    return `${NPM_PACKAGE_NAME}@${normalizeNpmVersionSpecifier(version)}`;
}
function buildReleaseDownloadUrl(host, version) {
    const normalizedVersion = normalizeText(version);
    if (!normalizedVersion || normalizedVersion === 'latest') {
        return `https://github.com/openagentinternet/open-agent-connect/releases/latest/download/oac-${host}.tar.gz`;
    }
    return `https://github.com/openagentinternet/open-agent-connect/releases/download/${normalizedVersion}/oac-${host}.tar.gz`;
}
async function readInstalledVersion(systemHomeDir, host) {
    const compatibilityPath = node_path_1.default.join(systemHomeDir, '.metabot', 'installpacks', host, 'runtime', 'compatibility.json');
    try {
        const raw = await node_fs_1.promises.readFile(compatibilityPath, 'utf8');
        const parsed = JSON.parse(raw);
        const cli = normalizeText(parsed?.cli);
        return cli || null;
    }
    catch {
        return null;
    }
}
async function runCommand(command, args, options) {
    await new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: 'pipe',
        });
        let stderr = '';
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
        });
    });
}
async function readExtractedVersion(extractedHostDir) {
    const compatibilityPath = node_path_1.default.join(extractedHostDir, 'runtime', 'compatibility.json');
    try {
        const raw = await node_fs_1.promises.readFile(compatibilityPath, 'utf8');
        const parsed = JSON.parse(raw);
        const cli = normalizeText(parsed?.cli);
        return cli || null;
    }
    catch {
        return null;
    }
}
async function runSystemUpdate(input) {
    const requestedVersion = normalizeText(input.version) || 'latest';
    if (!input.host) {
        const packageSpec = buildNpmPackageSpec(requestedVersion);
        if (input.dryRun) {
            return {
                updateMode: 'npm',
                host: null,
                requestedVersion,
                resolvedVersion: null,
                previousVersion: null,
                outcome: 'no_update',
                packageSpec,
                dryRun: true,
            };
        }
        const updateEnv = {
            ...input.env,
            HOME: input.systemHomeDir,
        };
        try {
            await runCommand('npm', ['i', '-g', packageSpec], {
                cwd: input.systemHomeDir,
                env: updateEnv,
            });
            await runCommand('oac', ['install'], {
                cwd: input.systemHomeDir,
                env: updateEnv,
            });
            return {
                updateMode: 'npm',
                host: null,
                requestedVersion,
                resolvedVersion: null,
                previousVersion: null,
                outcome: 'updated',
                packageSpec,
                dryRun: false,
            };
        }
        catch (error) {
            throw new types_1.SystemCommandError('install_failed', error instanceof Error ? error.message : String(error));
        }
    }
    const host = input.host;
    const downloadUrl = buildReleaseDownloadUrl(host, requestedVersion);
    const previousVersion = await readInstalledVersion(input.systemHomeDir, host);
    const installpackPath = node_path_1.default.join(input.systemHomeDir, '.metabot', 'installpacks', host);
    if (input.dryRun) {
        return {
            updateMode: 'release-pack',
            host,
            requestedVersion,
            resolvedVersion: previousVersion,
            previousVersion,
            outcome: 'no_update',
            downloadUrl,
            installpackPath,
            dryRun: true,
        };
    }
    const tmpRoot = await node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), 'metabot-system-update-'));
    const archivePath = node_path_1.default.join(tmpRoot, `oac-${host}.tar.gz`);
    try {
        const response = await fetch(downloadUrl);
        if (!response.ok) {
            throw new types_1.SystemCommandError('download_failed', `Failed to download update archive (${response.status} ${response.statusText}) from ${downloadUrl}.`);
        }
        const body = await response.arrayBuffer();
        await node_fs_1.promises.writeFile(archivePath, Buffer.from(body));
        await runCommand('tar', ['-xzf', archivePath, '-C', tmpRoot], {
            cwd: tmpRoot,
            env: input.env,
        });
        const extractedHostDir = node_path_1.default.join(tmpRoot, host);
        const installerPath = node_path_1.default.join(extractedHostDir, 'install.sh');
        const runtimeEntryPath = node_path_1.default.join(extractedHostDir, 'runtime', 'dist', 'cli', 'main.js');
        try {
            await node_fs_1.promises.access(installerPath);
            await node_fs_1.promises.access(runtimeEntryPath);
        }
        catch {
            throw new types_1.SystemCommandError('install_artifact_invalid', `Invalid update artifact for host ${host}: missing install.sh or runtime CLI entry.`);
        }
        await runCommand('bash', [installerPath], {
            cwd: extractedHostDir,
            env: {
                ...input.env,
                HOME: input.systemHomeDir,
            },
        });
        const resolvedVersion = await readExtractedVersion(extractedHostDir);
        const outcome = previousVersion && resolvedVersion && previousVersion === resolvedVersion
            ? 'no_update'
            : 'updated';
        return {
            updateMode: 'release-pack',
            host,
            requestedVersion,
            resolvedVersion,
            previousVersion,
            outcome,
            downloadUrl,
            installpackPath,
            dryRun: false,
        };
    }
    catch (error) {
        if (error instanceof types_1.SystemCommandError) {
            throw error;
        }
        throw new types_1.SystemCommandError('install_failed', error instanceof Error ? error.message : String(error));
    }
    finally {
        await node_fs_1.promises.rm(tmpRoot, { recursive: true, force: true });
    }
}
