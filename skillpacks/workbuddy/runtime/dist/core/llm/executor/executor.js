"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmExecutor = void 0;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const backend_1 = require("./backends/backend");
const session_manager_1 = require("./session-manager");
const skill_injector_1 = require("./skill-injector");
const platformRegistry_1 = require("../../platform/platformRegistry");
const providerProcessEnv_1 = require("../providerProcessEnv");
const STRICT_ISOLATION_PLATFORM_HOME_FILES = {
    'claude-code': ['config.json', 'settings.json'],
    codex: ['auth.json', 'config.toml'],
};
const STRICT_ISOLATION_USER_HOME_FILES = {
    'claude-code': ['.claude.json'],
};
const STRICT_ISOLATION_SOURCE_HOME_PROVIDERS = new Set(['cursor', 'codebuddy', 'zcode', 'workbuddy']);
// Strict-isolation scope reuse (spec R7). Prepared HOME scopes are cached per
// (metaBotSlug, provider, skill allowlist, platform-home fingerprint) inside
// the profile's sessions root, so a chat turn no longer pays the platform-home
// copy cost every time. Trust boundary: a cached scope is only ever reused
// for the same profile + provider + allowlist domain; any fingerprint or
// allowlist change keys a fresh scope, and the LRU cap below bounds residue.
// The whole cache lives under the profile's sessions root, so deleting the
// profile removes it with the profile home.
const STRICT_ISOLATION_SCOPE_CACHE_DIR = '.skill-scope-cache';
const STRICT_ISOLATION_SCOPE_CACHE_LIMIT = 8;
function createSessionId() {
    return `llm_${(0, node_crypto_1.randomUUID)()}`;
}
function nowIso() {
    return new Date().toISOString();
}
function isTerminalStatus(status) {
    return ['completed', 'failed', 'timeout', 'cancelled'].includes(status);
}
function mergeStringEnvValues(...sources) {
    const merged = {};
    for (const source of sources) {
        if (!source)
            continue;
        for (const [key, value] of Object.entries(source)) {
            if (typeof value === 'string') {
                merged[key] = value;
            }
        }
    }
    return merged;
}
function platformHomeEnvParent(root, isolatedHome) {
    if (!root.path.startsWith('~/')) {
        return isolatedHome;
    }
    const relativePath = root.path.slice(2);
    const segments = relativePath.split('/').filter(Boolean);
    if (segments[segments.length - 1] === 'skills') {
        segments.pop();
    }
    return segments.length > 0 ? node_path_1.default.resolve(isolatedHome, ...segments) : isolatedHome;
}
function skillRootParent(rootPath) {
    return node_path_1.default.basename(rootPath) === 'skills' ? node_path_1.default.dirname(rootPath) : rootPath;
}
function resolveStrictIsolationSourceHome(input) {
    const sourceEnv = mergeStringEnvValues(input.baseEnv, input.requestEnv);
    return sourceEnv.HOME || process.env.HOME || input.fallbackHome;
}
function shouldUseSourceHomeForStrictIsolation(provider) {
    return STRICT_ISOLATION_SOURCE_HOME_PROVIDERS.has(provider);
}
async function copyFileIfPresent(sourcePath, destinationPath) {
    let stat;
    try {
        stat = await node_fs_1.promises.stat(sourcePath);
    }
    catch {
        return;
    }
    if (!stat.isFile())
        return;
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(destinationPath), { recursive: true });
    await node_fs_1.promises.copyFile(sourcePath, destinationPath);
}
async function copyStrictIsolationUserHomeFiles(input) {
    const supportFiles = STRICT_ISOLATION_USER_HOME_FILES[input.provider] ?? [];
    for (const fileName of supportFiles) {
        await copyFileIfPresent(node_path_1.default.join(input.sourceHome, fileName), node_path_1.default.join(input.isolatedHome, fileName));
    }
}
function applyOpenClawStrictIsolationEnv(env, sourceHome) {
    const stateDir = node_path_1.default.join(sourceHome, '.openclaw');
    if (!env.OPENCLAW_STATE_DIR) {
        env.OPENCLAW_STATE_DIR = stateDir;
    }
    if (!env.OPENCLAW_CONFIG_PATH) {
        env.OPENCLAW_CONFIG_PATH = node_path_1.default.join(stateDir, 'openclaw.json');
    }
}
function isJsonRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
async function prepareOpenClawStrictIsolationConfig(input) {
    const sourceConfigPath = input.env.OPENCLAW_CONFIG_PATH;
    if (!sourceConfigPath)
        return;
    let rawConfig;
    try {
        rawConfig = await node_fs_1.promises.readFile(sourceConfigPath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return;
        throw error;
    }
    const parsed = JSON.parse(rawConfig);
    if (!isJsonRecord(parsed)) {
        throw new Error('OpenClaw config must be a JSON object.');
    }
    const agents = isJsonRecord(parsed.agents) ? { ...parsed.agents } : {};
    const defaults = isJsonRecord(agents.defaults) ? { ...agents.defaults } : {};
    defaults.workspace = input.isolatedCwd;
    agents.defaults = defaults;
    if (Array.isArray(agents.list)) {
        agents.list = agents.list.map((agent) => (isJsonRecord(agent) ? { ...agent, workspace: input.isolatedCwd } : agent));
    }
    const isolatedConfigPath = node_path_1.default.join(input.isolatedHome, '.openclaw', 'openclaw.json');
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(isolatedConfigPath), { recursive: true });
    await node_fs_1.promises.writeFile(isolatedConfigPath, `${JSON.stringify({ ...parsed, agents }, null, 2)}\n`, 'utf8');
    input.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
}
function buildStrictSkillIsolationEnv(input) {
    const env = mergeStringEnvValues(input.baseEnv, input.requestEnv);
    const useSourceHome = shouldUseSourceHomeForStrictIsolation(input.provider);
    env.HOME = useSourceHome ? input.sourceHome : input.isolatedHome;
    env.PWD = input.isolatedCwd;
    env.XDG_CONFIG_HOME = useSourceHome
        ? (env.XDG_CONFIG_HOME || node_path_1.default.join(input.sourceHome, '.config'))
        : node_path_1.default.join(input.isolatedHome, '.config');
    if ((0, platformRegistry_1.isPlatformId)(input.provider)) {
        for (const root of (0, platformRegistry_1.getPlatformSkillRoots)(input.provider)) {
            if (root.homeEnv) {
                env[root.homeEnv] = platformHomeEnvParent(root, input.isolatedHome);
            }
        }
    }
    if (input.provider === 'openclaw') {
        applyOpenClawStrictIsolationEnv(env, input.sourceHome);
    }
    return env;
}
async function prepareStrictSkillIsolationPlatformHome(input) {
    if (input.provider === 'openclaw') {
        await prepareOpenClawStrictIsolationConfig(input);
    }
    if (!(0, platformRegistry_1.isPlatformId)(input.provider))
        return;
    await copyStrictIsolationUserHomeFiles({
        provider: input.provider,
        sourceHome: input.sourceHome,
        isolatedHome: input.isolatedHome,
    });
    const supportFiles = STRICT_ISOLATION_PLATFORM_HOME_FILES[input.provider] ?? [];
    const sourceEnv = mergeStringEnvValues(input.baseEnv, input.requestEnv);
    const preparedParents = new Set();
    for (const root of (0, platformRegistry_1.getPlatformSkillRoots)(input.provider)) {
        if (root.kind !== 'global')
            continue;
        const isolatedSkillRoot = (0, platformRegistry_1.resolvePlatformSkillRootPath)(root, input.isolatedHome, input.env);
        const isolatedParent = skillRootParent(isolatedSkillRoot);
        await node_fs_1.promises.mkdir(isolatedParent, { recursive: true });
        if (supportFiles.length === 0 || preparedParents.has(isolatedParent))
            continue;
        preparedParents.add(isolatedParent);
        const sourceSkillRoot = (0, platformRegistry_1.resolvePlatformSkillRootPath)(root, input.sourceHome, sourceEnv);
        const sourceParent = skillRootParent(sourceSkillRoot);
        for (const fileName of supportFiles) {
            await copyFileIfPresent(node_path_1.default.join(sourceParent, fileName), node_path_1.default.join(isolatedParent, fileName));
        }
    }
}
async function createStrictSkillIsolationScope(input) {
    await node_fs_1.promises.mkdir(input.sessionsRoot, { recursive: true });
    const root = await node_fs_1.promises.mkdtemp(node_path_1.default.join(input.sessionsRoot, 'skill-scope-'));
    const cwd = node_path_1.default.join(root, 'work');
    const systemHomeDir = node_path_1.default.join(root, 'home');
    await node_fs_1.promises.mkdir(cwd, { recursive: true });
    await node_fs_1.promises.mkdir(systemHomeDir, { recursive: true });
    await node_fs_1.promises.mkdir(node_path_1.default.join(systemHomeDir, '.config'), { recursive: true });
    const sourceHome = resolveStrictIsolationSourceHome({
        baseEnv: input.baseEnv,
        requestEnv: input.requestEnv,
        fallbackHome: systemHomeDir,
    });
    const env = buildStrictSkillIsolationEnv({
        provider: input.provider,
        sourceHome,
        isolatedHome: systemHomeDir,
        isolatedCwd: cwd,
        baseEnv: input.baseEnv,
        requestEnv: input.requestEnv,
    });
    await prepareStrictSkillIsolationPlatformHome({
        provider: input.provider,
        sourceHome,
        isolatedHome: systemHomeDir,
        isolatedCwd: cwd,
        env,
        baseEnv: input.baseEnv,
        requestEnv: input.requestEnv,
    });
    return {
        root,
        cwd,
        systemHomeDir,
        skillSystemHomeDir: shouldUseSourceHomeForStrictIsolation(input.provider) ? sourceHome : systemHomeDir,
        env,
    };
}
async function removeStrictSkillIsolationScope(scope) {
    if (!scope)
        return;
    await node_fs_1.promises.rm(scope.root, { recursive: true, force: true });
}
async function fingerprintStrictIsolationSourceFiles(input) {
    const filePaths = [];
    for (const fileName of STRICT_ISOLATION_USER_HOME_FILES[input.provider] ?? []) {
        filePaths.push(node_path_1.default.join(input.sourceHome, fileName));
    }
    const supportFiles = STRICT_ISOLATION_PLATFORM_HOME_FILES[input.provider] ?? [];
    if (supportFiles.length > 0 && (0, platformRegistry_1.isPlatformId)(input.provider)) {
        const sourceEnv = mergeStringEnvValues(input.baseEnv, input.requestEnv);
        const seenParents = new Set();
        for (const root of (0, platformRegistry_1.getPlatformSkillRoots)(input.provider)) {
            if (root.kind !== 'global')
                continue;
            const sourceParent = skillRootParent((0, platformRegistry_1.resolvePlatformSkillRootPath)(root, input.sourceHome, sourceEnv));
            if (seenParents.has(sourceParent))
                continue;
            seenParents.add(sourceParent);
            for (const fileName of supportFiles) {
                filePaths.push(node_path_1.default.join(sourceParent, fileName));
            }
        }
    }
    const fingerprint = [];
    for (const filePath of filePaths.sort()) {
        try {
            const stat = await node_fs_1.promises.stat(filePath);
            fingerprint.push({ path: filePath, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) });
        }
        catch {
            fingerprint.push({ path: filePath, missing: true });
        }
    }
    return fingerprint;
}
function hashStrictIsolationScopeKey(parts) {
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}
async function pruneStrictIsolationScopeCache(cacheRoot) {
    let entries;
    try {
        entries = await node_fs_1.promises.readdir(cacheRoot, { withFileTypes: true });
    }
    catch {
        return;
    }
    const scopeDirs = entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('scope-'))
        .map((entry) => node_path_1.default.join(cacheRoot, entry.name));
    if (scopeDirs.length <= STRICT_ISOLATION_SCOPE_CACHE_LIMIT)
        return;
    const withUsage = await Promise.all(scopeDirs.map(async (dir) => {
        try {
            const stat = await node_fs_1.promises.stat(node_path_1.default.join(dir, '.last-used'));
            return { dir, usedAt: stat.mtimeMs };
        }
        catch {
            return { dir, usedAt: 0 };
        }
    }));
    withUsage.sort((left, right) => right.usedAt - left.usedAt);
    for (const stale of withUsage.slice(STRICT_ISOLATION_SCOPE_CACHE_LIMIT)) {
        await node_fs_1.promises.rm(stale.dir, { recursive: true, force: true }).catch(() => undefined);
    }
}
// Acquires a strict-isolation scope for one turn (spec R7): providers whose
// platform home needs file copies reuse a cached prepared HOME keyed by
// (metaBotSlug, provider, skill allowlist, platform-home fingerprint);
// source-home providers keep per-turn scopes, so their behavior is unchanged.
async function acquireStrictSkillIsolationScope(input) {
    if (shouldUseSourceHomeForStrictIsolation(input.provider)) {
        return { scope: await createStrictSkillIsolationScope(input), reusable: false };
    }
    const sourceEnv = mergeStringEnvValues(input.baseEnv, input.requestEnv);
    const keySourceHome = sourceEnv.HOME || process.env.HOME || '<isolated>';
    const fingerprint = await fingerprintStrictIsolationSourceFiles({
        provider: input.provider,
        sourceHome: keySourceHome,
        baseEnv: input.baseEnv,
        requestEnv: input.requestEnv,
    });
    const key = hashStrictIsolationScopeKey({
        metaBotSlug: input.metaBotSlug ?? '',
        provider: input.provider,
        skills: [...(input.skills ?? [])].sort(),
        skillSourcePaths: Object.entries(input.skillSourcePaths ?? {}).sort(([left], [right]) => left.localeCompare(right)),
        fingerprint,
    });
    const cacheRoot = node_path_1.default.join(input.sessionsRoot, STRICT_ISOLATION_SCOPE_CACHE_DIR);
    const root = node_path_1.default.join(cacheRoot, `scope-${key}`);
    const cwd = node_path_1.default.join(root, 'work');
    const systemHomeDir = node_path_1.default.join(root, 'home');
    let reused = true;
    try {
        await node_fs_1.promises.access(root);
    }
    catch {
        reused = false;
    }
    await node_fs_1.promises.mkdir(cwd, { recursive: true });
    await node_fs_1.promises.mkdir(node_path_1.default.join(systemHomeDir, '.config'), { recursive: true });
    const sourceHome = keySourceHome === '<isolated>' ? systemHomeDir : keySourceHome;
    const env = buildStrictSkillIsolationEnv({
        provider: input.provider,
        sourceHome,
        isolatedHome: systemHomeDir,
        isolatedCwd: cwd,
        baseEnv: input.baseEnv,
        requestEnv: input.requestEnv,
    });
    // OpenClaw keeps its auth state in the source state directory, but its
    // config must be refreshed on every turn so a cached scope never restores
    // the host agent's workspace persona.
    if (!reused || input.provider === 'openclaw') {
        await prepareStrictSkillIsolationPlatformHome({
            provider: input.provider,
            sourceHome,
            isolatedHome: systemHomeDir,
            isolatedCwd: cwd,
            env,
            baseEnv: input.baseEnv,
            requestEnv: input.requestEnv,
        });
    }
    await node_fs_1.promises.writeFile(node_path_1.default.join(root, '.last-used'), new Date().toISOString(), 'utf8').catch(() => undefined);
    await pruneStrictIsolationScopeCache(cacheRoot).catch(() => undefined);
    return {
        scope: {
            root,
            cwd,
            systemHomeDir,
            skillSystemHomeDir: systemHomeDir,
            env,
        },
        reusable: true,
    };
}
async function releaseStrictSkillIsolationScope(acquisition) {
    if (!acquisition || acquisition.reusable)
        return;
    await removeStrictSkillIsolationScope(acquisition.scope);
}
class LlmExecutor {
    sessionsRoot;
    transcriptsRoot;
    skillsRoot;
    systemHomeDir;
    env;
    backends;
    sessionManager;
    streams = new Map();
    running = new Map();
    constructor(options) {
        this.sessionsRoot = options.sessionsRoot;
        this.transcriptsRoot = options.transcriptsRoot;
        this.skillsRoot = options.skillsRoot;
        this.systemHomeDir = options.systemHomeDir;
        this.env = options.env;
        this.backends = options.backends;
        this.sessionManager = options.sessionManager ?? (0, session_manager_1.createFileSessionManager)(options.sessionsRoot);
    }
    async execute(request) {
        if (!request.runtimeId || !request.runtime) {
            throw new Error('runtimeId and runtime are required.');
        }
        const effectiveRequest = {
            ...request,
            model: request.model ?? request.runtime.model,
        };
        const provider = effectiveRequest.runtime.provider;
        const factory = this.backends[provider];
        if (!factory) {
            throw new Error(`No LLM backend registered for provider: ${provider}`);
        }
        const binaryPath = effectiveRequest.runtime.binaryPath;
        if (!binaryPath) {
            throw new Error(`Runtime ${request.runtimeId} has no binaryPath.`);
        }
        const sessionId = createSessionId();
        const record = {
            sessionId,
            status: 'starting',
            runtimeId: effectiveRequest.runtimeId,
            provider,
            metaBotSlug: effectiveRequest.metaBotSlug,
            prompt: effectiveRequest.prompt,
            systemPrompt: effectiveRequest.systemPrompt,
            skills: effectiveRequest.skills,
            skillSourcePaths: effectiveRequest.skillSourcePaths,
            model: effectiveRequest.model,
            cwd: effectiveRequest.cwd,
            resumeSessionId: effectiveRequest.resumeSessionId,
            createdAt: nowIso(),
        };
        await this.sessionManager.create(record);
        this.streams.set(sessionId, { events: [], closed: false, waiters: [] });
        const controller = new AbortController();
        this.running.set(sessionId, { controller });
        void this.runSession(sessionId, effectiveRequest, factory, binaryPath, controller).catch((error) => {
            void this.failSession(sessionId, (0, backend_1.stringifyError)(error));
        });
        return sessionId;
    }
    async cancel(sessionId) {
        const session = await this.sessionManager.get(sessionId);
        if (!session) {
            throw new Error(`LLM session not found: ${sessionId}`);
        }
        if (isTerminalStatus(session.status) || session.result) {
            return;
        }
        const running = this.running.get(sessionId);
        if (running)
            running.controller.abort();
        await this.sessionManager.update(sessionId, {
            status: 'cancelled',
            completedAt: nowIso(),
            result: {
                status: 'cancelled',
                output: '',
                error: 'execution cancelled',
                durationMs: 0,
            },
        });
        this.pushEvent(sessionId, {
            type: 'result',
            result: {
                status: 'cancelled',
                output: '',
                error: 'execution cancelled',
                durationMs: 0,
            },
        });
        this.closeStream(sessionId);
    }
    async getSession(sessionId) {
        return this.sessionManager.get(sessionId);
    }
    async listSessions(limit, options) {
        return this.sessionManager.list(limit, options);
    }
    async *streamEvents(sessionId) {
        let stream = this.streams.get(sessionId);
        if (!stream) {
            const session = await this.sessionManager.get(sessionId);
            if (!session)
                return;
            stream = { events: [], closed: Boolean(session.result), waiters: [] };
            if (session.result) {
                stream.events.push({ type: 'result', result: session.result });
            }
            this.streams.set(sessionId, stream);
        }
        let index = 0;
        while (true) {
            while (index < stream.events.length) {
                yield stream.events[index];
                index += 1;
            }
            if (stream.closed)
                return;
            await new Promise((resolve) => {
                stream.waiters.push(resolve);
            });
        }
    }
    async runSession(sessionId, request, factory, binaryPath, controller) {
        let isolation = null;
        try {
            const startedAt = nowIso();
            const strictSkillIsolation = request.skillIsolation === 'strict';
            isolation = strictSkillIsolation
                ? await acquireStrictSkillIsolationScope({
                    sessionsRoot: this.sessionsRoot,
                    provider: request.runtime.provider,
                    metaBotSlug: request.metaBotSlug,
                    skills: request.skills,
                    skillSourcePaths: request.skillSourcePaths,
                    baseEnv: this.env,
                    requestEnv: request.env,
                })
                : null;
            const isolationScope = isolation?.scope ?? null;
            const cwd = isolationScope?.cwd ?? request.cwd ?? process.cwd();
            const requestEnv = isolationScope?.env ?? request.env;
            const baseProcessEnv = mergeStringEnvValues(process.env, this.env, requestEnv);
            const processEnv = (0, platformRegistry_1.isRuntimePlatformId)(request.runtime.provider)
                ? await (0, providerProcessEnv_1.resolveProviderProcessEnv)(request.runtime.provider, binaryPath, baseProcessEnv)
                : { env: baseProcessEnv };
            if (processEnv.error)
                throw new Error(processEnv.error);
            const backendEnv = mergeStringEnvValues(processEnv.env);
            const backendRequest = { ...request, cwd, env: backendEnv };
            await this.sessionManager.update(sessionId, { status: 'running', startedAt, cwd });
            if (request.skills && request.skills.length > 0) {
                const injection = await (0, skill_injector_1.injectSkills)({
                    skills: request.skills,
                    skillsRoot: this.skillsRoot,
                    skillSourcePaths: request.skillSourcePaths,
                    provider: request.runtime.provider,
                    cwd,
                    systemHomeDir: isolationScope?.skillSystemHomeDir ?? this.systemHomeDir,
                    env: requestEnv ?? this.env,
                });
                for (const error of injection.errors) {
                    this.pushEvent(sessionId, {
                        type: 'log',
                        level: 'warning',
                        message: `Skill injection failed for ${error.skill}: ${error.error}`,
                    });
                }
            }
            const backend = factory(binaryPath, backendEnv);
            let accumulatedOutput = '';
            const emitter = {
                emit: (event) => {
                    if (event.type === 'text') {
                        accumulatedOutput += event.content;
                    }
                    if (event.type === 'status' && event.sessionId) {
                        void this.sessionManager.update(sessionId, { providerSessionId: event.sessionId }).catch(() => undefined);
                    }
                    this.pushEvent(sessionId, event);
                },
            };
            let result;
            try {
                result = await backend.execute(backendRequest, emitter, controller.signal);
                if (!result.output && accumulatedOutput) {
                    result = { ...result, output: accumulatedOutput };
                }
            }
            catch (error) {
                result = {
                    status: controller.signal.aborted ? 'cancelled' : 'failed',
                    output: accumulatedOutput,
                    error: (0, backend_1.stringifyError)(error),
                    durationMs: Date.now() - Date.parse(startedAt),
                };
            }
            await this.sessionManager.update(sessionId, {
                status: result.status,
                providerSessionId: result.providerSessionId,
                result,
                completedAt: nowIso(),
            });
            this.running.delete(sessionId);
            await releaseStrictSkillIsolationScope(isolation).catch((error) => {
                this.pushEvent(sessionId, {
                    type: 'log',
                    level: 'warning',
                    message: `Strict skill isolation cleanup failed: ${(0, backend_1.stringifyError)(error)}`,
                });
            });
            this.pushEvent(sessionId, { type: 'result', result });
            this.closeStream(sessionId);
        }
        finally {
            await releaseStrictSkillIsolationScope(isolation).catch(() => undefined);
        }
    }
    async failSession(sessionId, message) {
        const result = {
            status: 'failed',
            output: '',
            error: message,
            durationMs: 0,
        };
        await this.sessionManager.update(sessionId, {
            status: 'failed',
            completedAt: nowIso(),
            result,
        });
        this.running.delete(sessionId);
        this.pushEvent(sessionId, { type: 'error', message });
        this.pushEvent(sessionId, { type: 'result', result });
        this.closeStream(sessionId);
    }
    pushEvent(sessionId, event) {
        let stream = this.streams.get(sessionId);
        if (!stream) {
            stream = { events: [], closed: false, waiters: [] };
            this.streams.set(sessionId, stream);
        }
        stream.events.push(event);
        void this.appendTranscript(sessionId, event);
        const waiters = stream.waiters.splice(0);
        for (const waiter of waiters)
            waiter();
        if (event.type === 'result' || (event.type === 'status' && isTerminalStatus(event.status))) {
            this.closeStream(sessionId);
        }
    }
    closeStream(sessionId) {
        const stream = this.streams.get(sessionId);
        if (!stream)
            return;
        stream.closed = true;
        const waiters = stream.waiters.splice(0);
        for (const waiter of waiters)
            waiter();
    }
    async appendTranscript(sessionId, event) {
        await node_fs_1.promises.mkdir(this.transcriptsRoot, { recursive: true });
        await node_fs_1.promises.appendFile(node_path_1.default.join(this.transcriptsRoot, `${sessionId}.log`), `${JSON.stringify({ at: nowIso(), event })}\n`, 'utf8');
    }
}
exports.LlmExecutor = LlmExecutor;
