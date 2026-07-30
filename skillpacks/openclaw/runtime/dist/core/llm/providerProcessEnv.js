"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveProviderProcessEnv = resolveProviderProcessEnv;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const platformRegistry_1 = require("../platform/platformRegistry");
const NODE_VERSION_PROBE_TIMEOUT_MS = 2_000;
function parseVersion(value) {
    const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
function versionAtLeast(value, minimum) {
    const actual = parseVersion(value);
    const required = parseVersion(minimum);
    if (!actual || !required)
        return false;
    for (let index = 0; index < actual.length; index += 1) {
        if (actual[index] !== required[index])
            return actual[index] > required[index];
    }
    return true;
}
async function isNodeShebangExecutable(binaryPath) {
    try {
        const file = await node_fs_1.promises.open(binaryPath, 'r');
        try {
            const buffer = Buffer.alloc(160);
            const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
            return /^#![^\r\n]*\bnode\b/.test(buffer.subarray(0, bytesRead).toString('utf8'));
        }
        finally {
            await file.close();
        }
    }
    catch {
        return false;
    }
}
async function readNodeVersion(nodePath) {
    return new Promise((resolve) => {
        const child = (0, node_child_process_1.spawn)(nodePath, ['--version'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
        });
        let output = '';
        let settled = false;
        let timer;
        const finish = (value) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            resolve(value);
        };
        timer = setTimeout(() => {
            try {
                child.kill('SIGKILL');
            }
            catch { /* best effort */ }
            finish(null);
        }, NODE_VERSION_PROBE_TIMEOUT_MS);
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => { output += chunk; });
        child.stderr?.on('data', (chunk) => { output += chunk; });
        child.on('error', () => finish(null));
        child.on('close', (code) => finish(code === 0 ? output.trim() : null));
    });
}
function pathDirectories(env) {
    return (env.PATH ?? '').split(node_path_1.default.delimiter).filter(Boolean);
}
function providerNodePathEnvNames(provider) {
    const alias = provider.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    return [
        `OAC_${alias}_NODE_PATH`,
        `METABOT_${alias}_NODE_PATH`,
        `OPEN_AGENT_CONNECT_${alias}_NODE_PATH`,
        'OAC_NODE_PATH',
    ];
}
function nodeCandidates(provider, binaryPath, env) {
    const candidates = [];
    const seen = new Set();
    const add = (candidate) => {
        const value = candidate?.trim();
        if (!value || seen.has(value))
            return;
        seen.add(value);
        candidates.push(value);
    };
    for (const envName of providerNodePathEnvNames(provider))
        add(env[envName]);
    const executableName = process.platform === 'win32' ? 'node.exe' : 'node';
    add(node_path_1.default.join(node_path_1.default.dirname(binaryPath), executableName));
    for (const directory of pathDirectories(env))
        add(node_path_1.default.join(directory, executableName));
    add(process.execPath);
    return candidates;
}
function withNodeDirectoryFirst(env, nodePath) {
    const nodeDirectory = node_path_1.default.dirname(nodePath);
    const directories = pathDirectories(env)
        .filter((directory) => node_path_1.default.resolve(directory) !== node_path_1.default.resolve(nodeDirectory));
    return {
        ...env,
        PATH: [nodeDirectory, ...directories].join(node_path_1.default.delimiter),
    };
}
async function resolveProviderProcessEnv(provider, binaryPath, baseEnv = process.env) {
    const platform = (0, platformRegistry_1.getRuntimePlatformDefinition)(provider);
    const minimumVersion = platform.runtime.nodeRuntime?.minimumVersion;
    const env = { ...baseEnv };
    if (!minimumVersion || !(await isNodeShebangExecutable(binaryPath)))
        return { env };
    const checked = [];
    for (const candidate of nodeCandidates(provider, binaryPath, env)) {
        try {
            await node_fs_1.promises.access(candidate, node_fs_1.promises.constants.X_OK);
        }
        catch {
            continue;
        }
        const version = await readNodeVersion(candidate);
        if (!version)
            continue;
        checked.push(`${candidate} (${version})`);
        if (versionAtLeast(version, minimumVersion)) {
            return {
                env: withNodeDirectoryFirst(env, candidate),
                nodePath: candidate,
            };
        }
    }
    const found = checked.length ? ` Found: ${checked.join(', ')}.` : '';
    return {
        env,
        error: `${platform.displayName} requires Node.js >=${minimumVersion}, but no compatible Node.js executable was found.${found}`,
    };
}
