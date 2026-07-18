"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findExecutableInPath = findExecutableInPath;
exports.findExecutablesInPath = findExecutablesInPath;
exports.readExecutableVersion = readExecutableVersion;
exports.probeExecutableVersion = probeExecutableVersion;
exports.readinessSemanticInactivityTimeoutForProvider = readinessSemanticInactivityTimeoutForProvider;
exports.discoverProvider = discoverProvider;
exports.testLlmRuntimeReadiness = testLlmRuntimeReadiness;
exports.discoverLlmRuntimes = discoverLlmRuntimes;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const platformRegistry_1 = require("../platform/platformRegistry");
const registry_1 = require("./executor/backends/registry");
const DEFAULT_READINESS_TIMEOUT_MS = 30_000;
const SLOW_START_READINESS_TIMEOUT_MS = 45_000;
const DEFAULT_VERSION_PROBE_TIMEOUT_MS = 5_000;
const SLOW_START_VERSION_PROBE_TIMEOUT_MS = 20_000;
const DEFAULT_READINESS_SEMANTIC_INACTIVITY_TIMEOUT_MS = 15_000;
const DEFAULT_PROVIDER_DISCOVERY_CONCURRENCY = 8;
const DEFAULT_RECENT_HEALTHY_READINESS_SKIP_MS = 30 * 60 * 1000;
const READINESS_PROMPT = 'Reply exactly OK.';
const LOGIN_SHELL_RESOLVE_TIMEOUT_MS = 3_000;
const LOGIN_SHELL_RESOLVE_KILL_GRACE_MS = 2_000;
function getPathEnv(env) {
    return (env ?? process.env).PATH ?? '';
}
function splitPath(pathEnv) {
    const separator = process.platform === 'win32' ? ';' : ':';
    return pathEnv.split(separator).filter(Boolean);
}
function normalizeProviderDiscoveryConcurrency(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_PROVIDER_DISCOVERY_CONCURRENCY;
    }
    return Math.max(1, Math.floor(value));
}
function normalizeRecentHealthyReadinessSkipMs(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_RECENT_HEALTHY_READINESS_SKIP_MS;
    }
    return Math.max(0, Math.floor(value));
}
function parseIsoMs(value) {
    if (!value)
        return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function canSkipReadinessForKnownRuntime(knownRuntime, nowIso, windowMs) {
    if (!knownRuntime || knownRuntime.health !== 'healthy')
        return false;
    const checkedAt = parseIsoMs(knownRuntime.healthCheckedAt ?? knownRuntime.updatedAt);
    const nowMs = parseIsoMs(nowIso);
    if (checkedAt === null || nowMs === null || checkedAt > nowMs)
        return false;
    return nowMs - checkedAt <= windowMs;
}
async function mapWithConcurrency(items, concurrency, task) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(items.length, concurrency);
    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await task(items[index], index);
        }
    }));
    return results;
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
function safeAgentName(name) {
    return /^[A-Za-z0-9._-]+$/.test(name);
}
function buildLoginShellResolveScript(names) {
    return [
        `for n in ${names.join(' ')}; do`,
        '  unalias "$n" 2>/dev/null',
        '  unset -f "$n" 2>/dev/null',
        '  p=$(command -v "$n" 2>/dev/null) || continue',
        '  [ -n "$p" ] || continue',
        '  case "$p" in /*) ;; *) continue ;; esac',
        '  d=$(dirname "$p") && f=$(basename "$p") && c=$(cd "$d" 2>/dev/null && pwd -P) || continue',
        '  printf \'%s\\t%s\\n\' "$n" "$c/$f"',
        'done',
    ].join('\n');
}
async function resolveExecutablesViaLoginShell(names, env = process.env) {
    const safeNames = [...new Set(names)].filter(safeAgentName);
    if (!safeNames.length)
        return {};
    const shell = (env.SHELL ?? '').trim();
    const shellName = node_path_1.default.basename(shell);
    if (!shell || !['bash', 'zsh', 'sh', 'dash', 'ksh'].includes(shellName))
        return {};
    return new Promise((resolve) => {
        const child = (0, node_child_process_1.spawn)(shell, ['-ilc', buildLoginShellResolveScript(safeNames)], {
            stdio: ['ignore', 'pipe', 'ignore'],
            env,
            shell: false,
        });
        let output = '';
        let settled = false;
        let graceTimer;
        const finish = () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeoutTimer);
            if (graceTimer)
                clearTimeout(graceTimer);
            const resolved = {};
            for (const line of output.trim().split('\n')) {
                const [name, candidate] = line.split('\t', 2);
                if (!name || !candidate || !node_path_1.default.isAbsolute(candidate))
                    continue;
                resolved[name] = candidate;
            }
            resolve(resolved);
        };
        const timeoutTimer = setTimeout(() => {
            try {
                child.kill('SIGTERM');
            }
            catch { /* best effort */ }
            graceTimer = setTimeout(() => {
                try {
                    child.kill('SIGKILL');
                }
                catch { /* best effort */ }
                finish();
            }, LOGIN_SHELL_RESOLVE_KILL_GRACE_MS);
        }, LOGIN_SHELL_RESOLVE_TIMEOUT_MS);
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => { output += chunk; });
        child.on('close', finish);
        child.on('error', finish);
    });
}
function normalizeEnvKey(value) {
    return value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}
function providerEnvAliases(provider, platform) {
    const aliases = new Set();
    aliases.add(normalizeEnvKey(provider));
    for (const binaryName of platform.runtime.envAliases ?? platform.runtime.binaryNames) {
        aliases.add(normalizeEnvKey(binaryName));
    }
    if (provider === 'claude-code')
        aliases.add('CLAUDE');
    return [...aliases];
}
function providerPathEnvNames(provider, platform) {
    return providerEnvAliases(provider, platform).flatMap((alias) => [
        `OAC_${alias}_PATH`,
        `METABOT_${alias}_PATH`,
        `OPEN_AGENT_CONNECT_${alias}_PATH`,
    ]);
}
function providerModelEnvNames(provider, platform) {
    return providerEnvAliases(provider, platform).flatMap((alias) => [
        `OAC_${alias}_MODEL`,
        `METABOT_${alias}_MODEL`,
        `OPEN_AGENT_CONNECT_${alias}_MODEL`,
    ]);
}
function providerModelFromEnv(provider, platform, env) {
    for (const envName of providerModelEnvNames(provider, platform)) {
        const model = env[envName]?.trim();
        if (model)
            return model;
    }
    return undefined;
}
function providerPathSearchBinaryNames(platform) {
    return platform.runtime.pathSearchBinaryNames ?? platform.runtime.binaryNames;
}
async function executableCandidatesForProvider(provider, platform, pathDirs, env, shellResolvedExecutables) {
    const candidates = [];
    const seen = new Set();
    const add = (candidate) => {
        const trimmed = candidate?.trim();
        if (!trimmed || seen.has(trimmed))
            return;
        seen.add(trimmed);
        candidates.push(trimmed);
    };
    const addExecutableIfPresent = async (candidate) => {
        const trimmed = candidate?.trim();
        if (!trimmed || seen.has(trimmed))
            return;
        try {
            await node_fs_1.promises.access(trimmed, node_fs_1.promises.constants.X_OK);
            add(trimmed);
        }
        catch {
            // App-bundled defaults are optional and should not create unavailable runtimes when absent.
        }
    };
    for (const envName of providerPathEnvNames(provider, platform)) {
        add(env[envName]);
    }
    for (const binaryName of providerPathSearchBinaryNames(platform)) {
        for (const candidate of await findExecutablesInPath(binaryName, pathDirs)) {
            add(candidate);
        }
        add(shellResolvedExecutables?.[binaryName]);
    }
    for (const candidate of platform.runtime.defaultExecutablePaths ?? []) {
        await addExecutableIfPresent(candidate);
    }
    return candidates;
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
function compactEnv(env) {
    return Object.fromEntries(Object.entries(env).filter((entry) => typeof entry[1] === 'string'));
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
        health: versionProbe.ok ? 'detected' : 'unavailable',
        model: providerModelFromEnv(provider, platform, env),
        ...(versionProbe.ok
            ? {}
            : {
                healthReason: versionProbe.message ?? 'Version probe failed.',
                healthCheckedAt: now,
            }),
        capabilities: [...platform.runtime.capabilities],
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
    };
}
function readinessSucceeded(result) {
    return result.ok && typeof result.output === 'string' && result.output.trim().length > 0;
}
function readinessTimeoutForProvider(provider, override) {
    if (override !== undefined)
        return override;
    return ['codex', 'cursor', 'claude-code', 'zcode'].includes(provider)
        ? SLOW_START_READINESS_TIMEOUT_MS
        : DEFAULT_READINESS_TIMEOUT_MS;
}
function versionProbeTimeoutForProvider(provider) {
    return provider === 'cursor'
        ? SLOW_START_VERSION_PROBE_TIMEOUT_MS
        : DEFAULT_VERSION_PROBE_TIMEOUT_MS;
}
function readinessSemanticInactivityTimeoutForProvider(provider, readinessTimeoutMs) {
    return ['codex', 'cursor', 'claude-code', 'zcode'].includes(provider)
        ? readinessTimeoutMs
        : Math.min(readinessTimeoutMs, DEFAULT_READINESS_SEMANTIC_INACTIVITY_TIMEOUT_MS);
}
async function defaultRuntimeReadinessProbe(input) {
    const binaryPath = input.runtime.binaryPath;
    if (!binaryPath) {
        return { ok: false, message: 'Runtime has no binary path.' };
    }
    const factory = (0, registry_1.createRegistryBackendFactories)()[input.runtime.provider];
    if (!factory) {
        return { ok: false, message: `No readiness backend is registered for provider: ${input.runtime.provider}` };
    }
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
            controller.abort();
            resolve({ ok: false, message: `Readiness probe timed out after ${input.timeoutMs}ms.` });
        }, input.timeoutMs);
    });
    const backend = factory(binaryPath, compactEnv(input.env));
    const outputParts = [];
    const probe = backend.execute({
        runtimeId: input.runtime.id,
        runtime: input.runtime,
        prompt: READINESS_PROMPT,
        timeout: input.timeoutMs,
        semanticInactivityTimeout: readinessSemanticInactivityTimeoutForProvider(input.runtime.provider, input.timeoutMs),
        cwd: input.cwd ?? process.cwd(),
        model: input.runtime.model,
    }, {
        emit(event) {
            if (event.type === 'text') {
                outputParts.push(event.content);
            }
        },
    }, controller.signal).then((result) => {
        const output = result.output || outputParts.join('');
        if (result.status !== 'completed') {
            return { ok: false, output, message: result.error || `Readiness probe ended with status ${result.status}.` };
        }
        if (!output.trim()) {
            return { ok: false, output, message: 'Readiness probe completed without returning output.' };
        }
        return { ok: true, output };
    }).catch((error) => ({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
    }));
    try {
        return await Promise.race([probe, timeout]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
async function discoverProvider(provider, pathDirs, options) {
    if (provider === 'custom')
        return null; // Custom runtimes are registered manually.
    if (!(0, platformRegistry_1.isRuntimePlatformId)(provider))
        return null;
    const platform = (0, platformRegistry_1.getRuntimePlatformDefinition)(provider);
    let firstUnavailableCandidate = null;
    let firstDetectedRuntime = null;
    const env = options?.env ?? process.env;
    const readinessProbe = options?.readinessProbe ?? defaultRuntimeReadinessProbe;
    const readinessTimeoutMs = readinessTimeoutForProvider(provider, options?.readinessTimeoutMs);
    const binaryPaths = await executableCandidatesForProvider(provider, platform, pathDirs, env, options?.shellResolvedExecutables);
    for (const binaryPath of binaryPaths) {
        const versionProbe = await probeExecutableVersion(binaryPath, platform.runtime.versionArgs.length ? platform.runtime.versionArgs : ['--version'], versionProbeTimeoutForProvider(provider), env);
        if (versionProbe.ok) {
            const runtime = buildDiscoveredRuntime(provider, platform, binaryPath, versionProbe, options);
            const knownRuntime = options?.knownRuntimesById?.get(runtime.id);
            if (canSkipReadinessForKnownRuntime(knownRuntime, runtime.updatedAt, normalizeRecentHealthyReadinessSkipMs(options?.recentHealthyReadinessSkipMs))) {
                return {
                    ...runtime,
                    health: 'healthy',
                    healthReason: undefined,
                    unavailableUntil: undefined,
                    healthCheckedAt: knownRuntime.healthCheckedAt ?? knownRuntime.updatedAt,
                };
            }
            const readiness = await readinessProbe({
                runtime,
                env,
                timeoutMs: readinessTimeoutMs,
                cwd: options?.cwd,
            });
            const checkedAt = (options?.now ?? (() => new Date().toISOString()))();
            if (readinessSucceeded(readiness)) {
                return {
                    ...runtime,
                    health: 'healthy',
                    healthReason: undefined,
                    healthCheckedAt: checkedAt,
                    updatedAt: checkedAt,
                };
            }
            firstDetectedRuntime ??= {
                ...runtime,
                health: 'detected',
                healthReason: readiness.message ?? 'Readiness probe did not return a usable response.',
                healthCheckedAt: checkedAt,
                updatedAt: checkedAt,
            };
            continue;
        }
        if (!firstUnavailableCandidate) {
            firstUnavailableCandidate = { binaryPath, versionProbe };
        }
    }
    if (firstDetectedRuntime)
        return firstDetectedRuntime;
    if (!firstUnavailableCandidate)
        return null;
    return buildDiscoveredRuntime(provider, platform, firstUnavailableCandidate.binaryPath, firstUnavailableCandidate.versionProbe, options);
}
async function testLlmRuntimeReadiness(runtime, options) {
    const env = options?.env ?? process.env;
    const now = (options?.now ?? (() => new Date().toISOString()))();
    const base = {
        ...runtime,
        lastSeenAt: now,
        healthCheckedAt: now,
        updatedAt: now,
    };
    if (!runtime.binaryPath) {
        return {
            ...base,
            health: 'unavailable',
            healthReason: 'Runtime has no binary path.',
        };
    }
    if (runtime.provider === 'custom' || !(0, platformRegistry_1.isRuntimePlatformId)(runtime.provider)) {
        return {
            ...base,
            health: 'unavailable',
            healthReason: `No runtime platform is registered for provider: ${runtime.provider}`,
        };
    }
    const platform = (0, platformRegistry_1.getRuntimePlatformDefinition)(runtime.provider);
    const versionProbe = await probeExecutableVersion(runtime.binaryPath, platform.runtime.versionArgs.length ? platform.runtime.versionArgs : ['--version'], versionProbeTimeoutForProvider(runtime.provider), env);
    const probedRuntime = {
        ...buildDiscoveredRuntime(runtime.provider, platform, runtime.binaryPath, versionProbe, {
            env,
            now: () => now,
            createId: () => runtime.id,
        }),
        displayName: runtime.displayName || platform.displayName,
        logoPath: runtime.logoPath || platform.logoPath,
        model: runtime.model ?? providerModelFromEnv(runtime.provider, platform, env),
        capabilities: runtime.capabilities?.length ? [...runtime.capabilities] : [...platform.runtime.capabilities],
        createdAt: runtime.createdAt ?? now,
        lastSeenAt: now,
        healthCheckedAt: now,
        updatedAt: now,
    };
    if (!versionProbe.ok) {
        return {
            ...probedRuntime,
            health: 'unavailable',
            healthReason: versionProbe.message ?? 'Version probe failed.',
        };
    }
    const readinessProbe = options?.readinessProbe ?? defaultRuntimeReadinessProbe;
    const readiness = await readinessProbe({
        runtime: {
            ...probedRuntime,
            health: 'detected',
            healthReason: undefined,
        },
        env,
        timeoutMs: readinessTimeoutForProvider(runtime.provider, options?.readinessTimeoutMs),
        cwd: options?.cwd,
    });
    if (readinessSucceeded(readiness)) {
        return {
            ...probedRuntime,
            health: 'healthy',
            healthReason: undefined,
        };
    }
    return {
        ...probedRuntime,
        health: 'detected',
        healthReason: readiness.message
            ?? (typeof readiness.output === 'string' && !readiness.output.trim()
                ? 'Readiness probe completed without returning output.'
                : 'Readiness probe did not return a usable response.'),
    };
}
async function discoverLlmRuntimes(input) {
    const env = input?.env ?? process.env;
    const pathDirs = splitPath(getPathEnv(env));
    const runtimes = [];
    const errors = [];
    const requestedProviders = new Set((input?.providers ?? []).filter((provider) => (0, platformRegistry_1.isRuntimePlatformId)(provider)));
    const platforms = requestedProviders.size > 0
        ? (0, platformRegistry_1.getRuntimePlatforms)().filter((platform) => requestedProviders.has(platform.id))
        : (0, platformRegistry_1.getRuntimePlatforms)();
    const shellResolvedExecutables = input?.shellResolvedExecutables ?? await resolveExecutablesViaLoginShell(platforms.flatMap((platform) => platform.runtime.binaryNames), env);
    const knownRuntimesById = new Map((input?.knownRuntimes ?? []).map((runtime) => [runtime.id, runtime]));
    const discoveryResults = await mapWithConcurrency(platforms, normalizeProviderDiscoveryConcurrency(input?.providerConcurrency), async (platform) => {
        try {
            const runtime = await discoverProvider(platform.id, pathDirs, {
                createId: input?.createId,
                now: input?.now,
                env,
                readinessProbe: input?.readinessProbe,
                readinessTimeoutMs: input?.readinessTimeoutMs,
                knownRuntimesById,
                recentHealthyReadinessSkipMs: input?.recentHealthyReadinessSkipMs,
                cwd: input?.cwd,
                shellResolvedExecutables,
            });
            return { runtime, error: null };
        }
        catch (err) {
            return {
                runtime: null,
                error: {
                    provider: platform.id,
                    message: err instanceof Error ? err.message : String(err),
                },
            };
        }
    });
    for (const result of discoveryResults) {
        if (result.runtime) {
            runtimes.push(result.runtime);
        }
        if (result.error) {
            errors.push(result.error);
        }
    }
    return { runtimes, errors };
}
