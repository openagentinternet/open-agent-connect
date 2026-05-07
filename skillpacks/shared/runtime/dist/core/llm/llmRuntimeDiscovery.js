"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findExecutableInPath = findExecutableInPath;
exports.readExecutableVersion = readExecutableVersion;
exports.discoverProvider = discoverProvider;
exports.discoverLlmRuntimes = discoverLlmRuntimes;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const platformRegistry_1 = require("../platform/platformRegistry");
function getPathEnv(env) {
    return (env ?? process.env).PATH ?? '';
}
function splitPath(pathEnv) {
    const separator = process.platform === 'win32' ? ';' : ':';
    return pathEnv.split(separator).filter(Boolean);
}
async function findExecutableInPath(name, pathDirs) {
    const dirs = pathDirs ?? splitPath(getPathEnv());
    for (const dir of dirs) {
        const candidate = node_path_1.default.join(dir, name);
        try {
            await node_fs_1.promises.access(candidate, node_fs_1.promises.constants.X_OK);
            return candidate;
        }
        catch {
            // Not found / not executable.
        }
    }
    return null;
}
async function readExecutableVersion(binaryPath, versionArgs = ['--version'], timeoutMs = 5_000, env = process.env) {
    return new Promise((resolve) => {
        const child = (0, node_child_process_1.spawn)(binaryPath, versionArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
            shell: false,
        });
        let output = '';
        const timer = setTimeout(() => {
            try {
                child.kill('SIGTERM');
            }
            catch { /* best effort */ }
            resolve(undefined);
        }, timeoutMs);
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => { output += chunk; });
        child.stderr?.on('data', (chunk) => { output += chunk; });
        child.on('close', () => {
            clearTimeout(timer);
            const trimmed = output.trim();
            if (!trimmed) {
                resolve(undefined);
                return;
            }
            const match = trimmed.match(/(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/);
            resolve(match ? match[1] : trimmed.split(/\s+/).pop() ?? undefined);
        });
        child.on('error', () => {
            clearTimeout(timer);
            resolve(undefined);
        });
    });
}
function detectAuthState(authEnv, env) {
    if (authEnv.some((envVar) => Boolean(env[envVar]))) {
        return 'authenticated';
    }
    return 'unknown';
}
async function discoverProvider(provider, pathDirs, options) {
    if (provider === 'custom')
        return null; // Custom runtimes are registered manually.
    if (!(0, platformRegistry_1.isPlatformId)(provider))
        return null;
    const platform = (0, platformRegistry_1.getPlatformDefinition)(provider);
    let binaryPath = null;
    for (const binaryName of platform.runtime.binaryNames) {
        binaryPath = await findExecutableInPath(binaryName, pathDirs);
        if (binaryPath)
            break;
    }
    if (!binaryPath)
        return null;
    const env = options?.env ?? process.env;
    const version = await readExecutableVersion(binaryPath, platform.runtime.versionArgs.length ? platform.runtime.versionArgs : ['--version'], 5_000, env);
    const now = (options?.now ?? (() => new Date().toISOString()))();
    // Stable ID: same binary always gets same id, so rediscovery upserts instead of duplicating.
    const defaultId = `llm_${provider.replace(/-/g, '_')}_${binaryPath}`;
    const createId = options?.createId ?? (() => defaultId);
    const authState = detectAuthState(platform.runtime.authEnv, env);
    return {
        id: createId(),
        provider,
        displayName: platform.displayName,
        binaryPath,
        version,
        logoPath: platform.logoPath,
        authState,
        health: 'healthy',
        capabilities: [...platform.runtime.capabilities],
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
    };
}
async function discoverLlmRuntimes(input) {
    const pathDirs = splitPath(getPathEnv(input?.env));
    const runtimes = [];
    const errors = [];
    // Discover each supported provider. Run in sequence to keep it simple;
    // the binary spawns are the slow part, and they're already async.
    for (const platform of (0, platformRegistry_1.getRuntimePlatforms)()) {
        try {
            const runtime = await discoverProvider(platform.id, pathDirs, {
                createId: input?.createId,
                now: input?.now,
                env: input?.env ?? process.env,
            });
            if (runtime) {
                runtimes.push(runtime);
            }
        }
        catch (err) {
            errors.push({
                provider: platform.id,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return { runtimes, errors };
}
