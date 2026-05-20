"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findExecutableInPath = findExecutableInPath;
exports.findExecutablesInPath = findExecutablesInPath;
exports.readExecutableVersion = readExecutableVersion;
exports.probeExecutableVersion = probeExecutableVersion;
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
    const matches = await findExecutablesInPath(name, pathDirs);
    return matches[0] ?? null;
}
async function findExecutablesInPath(name, pathDirs) {
    const dirs = pathDirs ?? splitPath(getPathEnv());
    const matches = [];
    const seen = new Set();
    for (const dir of dirs) {
        const candidate = node_path_1.default.join(dir, name);
        if (seen.has(candidate))
            continue;
        seen.add(candidate);
        try {
            await node_fs_1.promises.access(candidate, node_fs_1.promises.constants.X_OK);
            matches.push(candidate);
        }
        catch {
            // Not found / not executable.
        }
    }
    return matches;
}
async function readExecutableVersion(binaryPath, versionArgs = ['--version'], timeoutMs = 5_000, env = process.env) {
    const probe = await probeExecutableVersion(binaryPath, versionArgs, timeoutMs, env);
    return probe.ok ? probe.version : undefined;
}
async function probeExecutableVersion(binaryPath, versionArgs = ['--version'], timeoutMs = 5_000, env = process.env) {
    return new Promise((resolve) => {
        const child = (0, node_child_process_1.spawn)(binaryPath, versionArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
            shell: false,
        });
        let output = '';
        let settled = false;
        const finish = (probe) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(probe);
        };
        const timer = setTimeout(() => {
            try {
                child.kill('SIGTERM');
            }
            catch { /* best effort */ }
            finish({ ok: false, message: `Version probe timed out after ${timeoutMs}ms.` });
        }, timeoutMs);
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => { output += chunk; });
        child.stderr?.on('data', (chunk) => { output += chunk; });
        child.on('close', (code) => {
            const trimmed = output.trim();
            if (code !== 0) {
                finish({
                    ok: false,
                    exitCode: code,
                    message: trimmed || `Version probe exited with code ${code ?? 'unknown'}.`,
                });
                return;
            }
            if (!trimmed) {
                finish({ ok: true, exitCode: code });
                return;
            }
            const match = trimmed.match(/(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/);
            finish({
                ok: true,
                exitCode: code,
                version: match ? match[1] : trimmed.split(/\s+/).pop() ?? undefined,
            });
        });
        child.on('error', (error) => {
            finish({ ok: false, message: error.message });
        });
    });
}
function detectAuthState(authEnv, env) {
    if (authEnv.some((envVar) => Boolean(env[envVar]))) {
        return 'authenticated';
    }
    return 'unknown';
}
function buildDiscoveredRuntime(provider, platform, binaryPath, versionProbe, options) {
    const env = options?.env ?? process.env;
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
        version: versionProbe.version,
        logoPath: platform.logoPath,
        authState,
        health: versionProbe.ok ? 'healthy' : 'unavailable',
        capabilities: [...platform.runtime.capabilities],
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
    };
}
async function discoverProvider(provider, pathDirs, options) {
    if (provider === 'custom')
        return null; // Custom runtimes are registered manually.
    if (!(0, platformRegistry_1.isRuntimePlatformId)(provider))
        return null;
    const platform = (0, platformRegistry_1.getRuntimePlatformDefinition)(provider);
    let firstUnavailableCandidate = null;
    const env = options?.env ?? process.env;
    for (const binaryName of platform.runtime.binaryNames) {
        const binaryPaths = await findExecutablesInPath(binaryName, pathDirs);
        for (const binaryPath of binaryPaths) {
            const versionProbe = await probeExecutableVersion(binaryPath, platform.runtime.versionArgs.length ? platform.runtime.versionArgs : ['--version'], 5_000, env);
            if (versionProbe.ok) {
                return buildDiscoveredRuntime(provider, platform, binaryPath, versionProbe, options);
            }
            if (!firstUnavailableCandidate) {
                firstUnavailableCandidate = { binaryPath, versionProbe };
            }
        }
    }
    if (!firstUnavailableCandidate)
        return null;
    return buildDiscoveredRuntime(provider, platform, firstUnavailableCandidate.binaryPath, firstUnavailableCandidate.versionProbe, options);
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
