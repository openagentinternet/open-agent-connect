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
const llmTypes_1 = require("./llmTypes");
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
async function readExecutableVersion(binaryPath, timeoutMs = 5_000) {
    return new Promise((resolve) => {
        const child = (0, node_child_process_1.spawn)(binaryPath, ['--version'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
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
async function discoverProvider(provider, pathDirs, options) {
    if (provider === 'custom')
        return null; // Custom runtimes are registered manually.
    const binaryName = llmTypes_1.HOST_BINARY_MAP[provider];
    if (!binaryName)
        return null;
    const binaryPath = await findExecutableInPath(binaryName, pathDirs);
    if (!binaryPath)
        return null;
    const version = await readExecutableVersion(binaryPath);
    const now = (options?.now ?? (() => new Date().toISOString()))();
    const createId = options?.createId ?? (() => `llm_${provider.replace('-', '_')}_${Date.now()}`);
    const env = process.env;
    const authState = (provider === 'claude-code' && env.ANTHROPIC_API_KEY) ? 'authenticated' :
        (provider === 'codex' && env.OPENAI_API_KEY) ? 'authenticated' :
            'unknown';
    const displayNames = {
        'claude-code': 'Claude Code',
        'codex': 'Codex',
        'openclaw': 'OpenClaw',
    };
    return {
        id: createId(),
        provider,
        displayName: displayNames[provider] ?? provider,
        binaryPath,
        version,
        authState,
        health: 'healthy',
        capabilities: ['tool-use'],
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
    for (const provider of llmTypes_1.SUPPORTED_LLM_PROVIDERS) {
        try {
            const runtime = await discoverProvider(provider, pathDirs, {
                createId: input?.createId,
                now: input?.now,
            });
            if (runtime) {
                runtimes.push(runtime);
            }
        }
        catch (err) {
            errors.push({
                provider,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return { runtimes, errors };
}
