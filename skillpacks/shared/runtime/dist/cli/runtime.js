"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultDaemonPort = getDefaultDaemonPort;
exports.getDaemonRuntimeFingerprint = getDaemonRuntimeFingerprint;
exports.buildDaemonConfigHash = buildDaemonConfigHash;
exports.createDefaultCliDependencies = createDefaultCliDependencies;
exports.mergeCliDependencies = mergeCliDependencies;
exports.serveCliDaemonProcess = serveCliDaemonProcess;
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const node_net_1 = __importDefault(require("node:net"));
const commandResult_1 = require("../core/contracts/commandResult");
const configStore_1 = require("../core/config/configStore");
const service_1 = require("../core/evolution/service");
const localEvolutionStore_1 = require("../core/evolution/localEvolutionStore");
const remoteEvolutionStore_1 = require("../core/evolution/remoteEvolutionStore");
const publishArtifact_1 = require("../core/evolution/publish/publishArtifact");
const chainEvolutionReader_1 = require("../core/evolution/import/chainEvolutionReader");
const importArtifact_1 = require("../core/evolution/import/importArtifact");
const listImportedArtifacts_1 = require("../core/evolution/import/listImportedArtifacts");
const searchArtifacts_1 = require("../core/evolution/import/searchArtifacts");
const remoteAdoption_1 = require("../core/evolution/remoteAdoption");
const hostSkillBinding_1 = require("../core/host/hostSkillBinding");
const uploadFile_1 = require("../core/files/uploadFile");
const identityProfiles_1 = require("../core/identity/identityProfiles");
const profileWorkspace_1 = require("../core/identity/profileWorkspace");
const profileNameResolution_1 = require("../core/identity/profileNameResolution");
const skillResolver_1 = require("../core/skills/skillResolver");
const paths_1 = require("../core/state/paths");
const homeSelection_1 = require("../core/state/homeSelection");
const runtimeStateStore_1 = require("../core/state/runtimeStateStore");
const providerHeartbeatLoop_1 = require("../core/provider/providerHeartbeatLoop");
const providerPresenceState_1 = require("../core/provider/providerPresenceState");
const fileSecretStore_1 = require("../core/secrets/fileSecretStore");
const localMnemonicSigner_1 = require("../core/signing/localMnemonicSigner");
const writePin_1 = require("../core/chain/writePin");
const daemon_1 = require("../daemon");
const defaultHandlers_1 = require("../daemon/defaultHandlers");
const metawebMasterReplyWaiter_1 = require("../core/master/metawebMasterReplyWaiter");
const masterMessageSchema_1 = require("../core/master/masterMessageSchema");
const privateChatListener_1 = require("../core/chat/privateChatListener");
const privateChatAutoReply_1 = require("../core/chat/privateChatAutoReply");
const privateChatStateStore_1 = require("../core/chat/privateChatStateStore");
const chatStrategyStore_1 = require("../core/chat/chatStrategyStore");
const hostLlmChatReplyRunner_1 = require("../core/chat/hostLlmChatReplyRunner");
const DEFAULT_DAEMON_BASE_URL = 'http://127.0.0.1:4827';
const DEFAULT_DAEMON_HOST = '127.0.0.1';
const DEFAULT_DAEMON_START_TIMEOUT_MS = 5_000;
const DAEMON_START_POLL_INTERVAL_MS = 100;
const DAEMON_PREFERRED_PORT_ENV = 'METABOT_DAEMON_PREFERRED_PORT';
const DEFAULT_DAEMON_PORT_BASE = 24_000;
const DEFAULT_DAEMON_PORT_SPAN = 20_000;
const TEST_FAKE_CHAIN_WRITE_ENV = 'METABOT_TEST_FAKE_CHAIN_WRITE';
const TEST_FAKE_SUBSIDY_ENV = 'METABOT_TEST_FAKE_SUBSIDY';
const TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY_ENV = 'METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY';
const TEST_FAKE_METAWEB_REPLY_ENV = 'METABOT_TEST_FAKE_METAWEB_REPLY';
const TEST_FAKE_MASTER_REPLY_ENV = 'METABOT_TEST_FAKE_MASTER_REPLY';
const ALLOW_UNINDEXED_HOME_ENV = 'METABOT_ALLOW_UNINDEXED_HOME';
const DAEMON_CONFIG_RESTART_TIMEOUT_MS = 5_000;
const METALET_HOST = 'https://www.metalet.space';
const CHAIN_NET = 'livenet';
const MAX_MVC_BALANCE_QUERY_PAGES = 200;
let cachedDaemonRuntimeFingerprint = null;
const EVOLUTION_IMPORT_SKILL_NAME = 'metabot-network-directory';
function normalizeBaseUrl(value) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || DEFAULT_DAEMON_BASE_URL;
}
function normalizeEnvText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}
async function fetchMetaletData(url) {
    const response = await fetch(url);
    const payload = await response.json();
    if (payload?.code !== 0) {
        throw new Error(payload?.message || 'Metalet request failed.');
    }
    return (payload?.data ?? null);
}
async function fetchMvcBalanceSnapshot(address) {
    let flag = '';
    let totalSatoshis = 0;
    let confirmedSatoshis = 0;
    let unconfirmedSatoshis = 0;
    let utxoCount = 0;
    for (let page = 0; page < MAX_MVC_BALANCE_QUERY_PAGES; page += 1) {
        const params = new URLSearchParams({
            address,
            net: CHAIN_NET,
            ...(flag ? { flag } : {}),
        });
        const data = await fetchMetaletData(`${METALET_HOST}/wallet-api/v4/mvc/address/utxo-list?${params}`);
        const list = Array.isArray(data?.list) ? data.list : [];
        if (!list.length) {
            break;
        }
        for (const utxo of list) {
            const satoshis = Math.max(0, Math.floor(toFiniteNumber(utxo.value)));
            totalSatoshis += satoshis;
            utxoCount += 1;
            if (toFiniteNumber(utxo.height) > 0) {
                confirmedSatoshis += satoshis;
            }
            else {
                unconfirmedSatoshis += satoshis;
            }
        }
        const nextFlag = normalizeEnvText(list[list.length - 1]?.flag);
        if (!nextFlag || nextFlag === flag) {
            break;
        }
        flag = nextFlag;
    }
    return {
        chain: 'mvc',
        address,
        totalSatoshis,
        confirmedSatoshis,
        unconfirmedSatoshis,
        utxoCount,
        totalMvc: totalSatoshis / 1e8,
    };
}
async function fetchBtcBalanceSnapshot(address) {
    const params = new URLSearchParams({
        address,
        net: CHAIN_NET,
    });
    const data = await fetchMetaletData(`${METALET_HOST}/wallet-api/v3/address/btc-balance?${params}`);
    const totalBtc = Math.max(0, toFiniteNumber(data?.balance));
    const confirmedBtc = Math.max(0, toFiniteNumber(data?.safeBalance ?? data?.balance));
    const unconfirmedBtc = toFiniteNumber(data?.pendingBalance);
    return {
        chain: 'btc',
        address,
        totalSatoshis: Math.round(totalBtc * 1e8),
        confirmedSatoshis: Math.round(confirmedBtc * 1e8),
        unconfirmedSatoshis: Math.round(unconfirmedBtc * 1e8),
        totalBtc,
        confirmedBtc,
        unconfirmedBtc,
    };
}
function parseDaemonPort(value) {
    const parsed = Number.parseInt(normalizeEnvText(value), 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        return null;
    }
    return parsed;
}
function getLegacyDefaultDaemonPort() {
    try {
        const parsed = new URL(DEFAULT_DAEMON_BASE_URL);
        const port = Number.parseInt(parsed.port, 10);
        if (Number.isInteger(port) && port > 0) {
            return port;
        }
    }
    catch {
        // Ignore malformed defaults and fall back below.
    }
    return 4827;
}
function getDefaultDaemonPort(homeDir) {
    const normalizedHomeDir = typeof homeDir === 'string' ? homeDir.trim() : '';
    if (!normalizedHomeDir) {
        return getLegacyDefaultDaemonPort();
    }
    try {
        const digest = (0, node_crypto_1.createHash)('sha256')
            .update(node_path_1.default.resolve(normalizedHomeDir))
            .digest();
        const offset = digest.readUInt32BE(0) % DEFAULT_DAEMON_PORT_SPAN;
        return DEFAULT_DAEMON_PORT_BASE + offset;
    }
    catch {
        return getLegacyDefaultDaemonPort();
    }
}
function isAddressInUseError(error) {
    return Boolean(error
        && typeof error === 'object'
        && 'code' in error
        && error.code === 'EADDRINUSE');
}
const SUPPORTED_CONFIG_KEYS = new Set([
    'evolution_network.enabled',
    'evolution_network.autoAdoptSameSkillSameScope',
    'evolution_network.autoRecordExecutions',
    'askMaster.enabled',
    'askMaster.triggerMode',
]);
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function compareCodePointStrings(left, right) {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
}
function projectActiveVariantIds(activeVariants) {
    const entries = [];
    for (const [skillName, rawRef] of Object.entries(activeVariants)) {
        const activeRef = (0, localEvolutionStore_1.parseSkillActiveVariantRef)(rawRef);
        if (!activeRef) {
            continue;
        }
        entries.push([skillName, activeRef.variantId]);
    }
    entries.sort(([left], [right]) => compareCodePointStrings(left, right));
    return Object.fromEntries(entries);
}
function projectActiveVariantRefs(activeVariants) {
    const entries = [];
    for (const [skillName, rawRef] of Object.entries(activeVariants)) {
        const activeRef = (0, localEvolutionStore_1.parseSkillActiveVariantRef)(rawRef);
        if (!activeRef) {
            continue;
        }
        entries.push([skillName, activeRef]);
    }
    entries.sort(([left], [right]) => compareCodePointStrings(left, right));
    return Object.fromEntries(entries);
}
function isSupportedConfigKey(key) {
    return SUPPORTED_CONFIG_KEYS.has(key);
}
function isSupportedBooleanConfigKey(key) {
    return key === 'evolution_network.enabled'
        || key === 'evolution_network.autoAdoptSameSkillSameScope'
        || key === 'evolution_network.autoRecordExecutions'
        || key === 'askMaster.enabled';
}
function readConfigValue(config, key) {
    if (key === 'evolution_network.enabled') {
        return config.evolution_network.enabled;
    }
    if (key === 'evolution_network.autoAdoptSameSkillSameScope') {
        return config.evolution_network.autoAdoptSameSkillSameScope;
    }
    if (key === 'evolution_network.autoRecordExecutions') {
        return config.evolution_network.autoRecordExecutions;
    }
    if (key === 'askMaster.enabled') {
        return config.askMaster.enabled;
    }
    if (key === 'askMaster.triggerMode') {
        return config.askMaster.triggerMode;
    }
    return config.evolution_network.autoRecordExecutions;
}
function writeConfigValue(config, key, value) {
    if (key === 'askMaster.enabled') {
        return {
            ...config,
            askMaster: {
                ...config.askMaster,
                enabled: value === true,
            },
        };
    }
    if (key === 'askMaster.triggerMode') {
        return {
            ...config,
            askMaster: {
                ...config.askMaster,
                triggerMode: value,
            },
        };
    }
    if (key === 'evolution_network.enabled') {
        return {
            ...config,
            evolution_network: {
                ...config.evolution_network,
                enabled: value === true,
            },
        };
    }
    if (key === 'evolution_network.autoAdoptSameSkillSameScope') {
        return {
            ...config,
            evolution_network: {
                ...config.evolution_network,
                autoAdoptSameSkillSameScope: value === true,
            },
        };
    }
    return {
        ...config,
        evolution_network: {
            ...config.evolution_network,
            autoRecordExecutions: value === true,
        },
    };
}
function normalizeConfigValueForKey(input) {
    if (isSupportedBooleanConfigKey(input.key)) {
        if (typeof input.value !== 'boolean') {
            return {
                ok: false,
                message: `Config key ${input.key} requires a boolean value.`,
            };
        }
        return {
            ok: true,
            value: input.value,
        };
    }
    if (input.key === 'askMaster.triggerMode') {
        if (input.value !== 'manual' && input.value !== 'suggest') {
            return {
                ok: false,
                message: 'Config value for askMaster.triggerMode must be one of `manual` or `suggest`.',
            };
        }
        return {
            ok: true,
            value: input.value,
        };
    }
    return {
        ok: false,
        message: `Unsupported config key: ${input.key}`,
    };
}
async function readArtifactFile(filePath) {
    try {
        const raw = await node_fs_1.default.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed)) {
            return null;
        }
        return parsed;
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT' || error instanceof SyntaxError) {
            return null;
        }
        throw error;
    }
}
function collectRuntimeFingerprintEntries(rootDir, directory, entries) {
    for (const dirent of node_fs_1.default.readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = node_path_1.default.join(directory, dirent.name);
        if (dirent.isDirectory()) {
            collectRuntimeFingerprintEntries(rootDir, absolutePath, entries);
            continue;
        }
        if (!dirent.isFile() || !absolutePath.endsWith('.js')) {
            continue;
        }
        const stat = node_fs_1.default.statSync(absolutePath);
        entries.push(`${node_path_1.default.relative(rootDir, absolutePath)}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
    }
}
function getDaemonRuntimeFingerprint(rootDir) {
    const normalizedRoot = rootDir
        ? node_path_1.default.resolve(rootDir)
        : node_path_1.default.resolve(__dirname, '..');
    if (!rootDir && cachedDaemonRuntimeFingerprint) {
        return cachedDaemonRuntimeFingerprint;
    }
    const entries = [];
    try {
        collectRuntimeFingerprintEntries(normalizedRoot, normalizedRoot, entries);
    }
    catch {
        const fallbackEntry = resolveCliEntrypoint();
        try {
            const stat = node_fs_1.default.statSync(fallbackEntry);
            entries.push(`${node_path_1.default.basename(fallbackEntry)}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
        }
        catch {
            entries.push(`fallback:${fallbackEntry}`);
        }
    }
    entries.sort();
    const fingerprint = (0, node_crypto_1.createHash)('sha256').update(entries.join('\n')).digest('hex');
    if (!rootDir) {
        cachedDaemonRuntimeFingerprint = fingerprint;
    }
    return fingerprint;
}
function buildDaemonConfigHash(env, options = {}) {
    return (0, node_crypto_1.createHash)('sha256')
        .update(JSON.stringify({
        runtimeFingerprint: options.runtimeFingerprint ?? getDaemonRuntimeFingerprint(),
        chainApiBaseUrl: normalizeEnvText(env.METABOT_CHAIN_API_BASE_URL),
        fakeChainWrite: normalizeEnvText(env[TEST_FAKE_CHAIN_WRITE_ENV]),
        fakeSubsidy: normalizeEnvText(env[TEST_FAKE_SUBSIDY_ENV]),
        fakeProviderChatPublicKey: normalizeEnvText(env[TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY_ENV]),
        fakeMetaWebReply: normalizeEnvText(env[TEST_FAKE_METAWEB_REPLY_ENV]),
        fakeMasterReply: normalizeEnvText(env[TEST_FAKE_MASTER_REPLY_ENV]),
    }))
        .digest('hex');
}
function normalizeHomeDir(env, cwd, options = {}) {
    return (0, homeSelection_1.resolveMetabotHomeSelectionSync)({
        env,
        cwd,
        allowUnindexedExplicitHome: options.allowUnindexedExplicitHome,
    }).homeDir;
}
function normalizeSystemHomeDir(env, cwd) {
    return (0, homeSelection_1.normalizeSystemHomeDir)(env, cwd);
}
function cloneContextWithHomeDir(context, homeDir) {
    return {
        ...context,
        env: {
            ...context.env,
            METABOT_HOME: homeDir,
        },
    };
}
function tryNormalizeHomeDir(env, cwd, options = {}) {
    try {
        return normalizeHomeDir(env, cwd, options);
    }
    catch {
        return null;
    }
}
function resolveCliEntrypoint() {
    return node_path_1.default.join(__dirname, 'main.js');
}
function resolveLocalUiPath(page) {
    if (page === 'buzz') {
        return '/ui/buzz/app/index.html';
    }
    if (page === 'chat') {
        return '/ui/chat/app/chat.html';
    }
    return `/ui/${page}`;
}
async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function isPortBindable(host, port) {
    return new Promise((resolve) => {
        const probe = node_net_1.default.createServer();
        const finalize = (result) => {
            probe.removeAllListeners();
            resolve(result);
        };
        probe.once('error', () => finalize(false));
        probe.listen(port, host, () => {
            probe.close(() => finalize(true));
        });
    });
}
async function waitForPortRelease(host, port, timeoutMs) {
    if (!Number.isInteger(port) || port <= 0) {
        return;
    }
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < timeoutMs) {
        if (await isPortBindable(host, port)) {
            return;
        }
        await sleep(DAEMON_START_POLL_INTERVAL_MS);
    }
}
async function isDaemonReachable(baseUrl) {
    try {
        const response = await fetch(`${baseUrl}/api/daemon/status`);
        return response.ok;
    }
    catch {
        return false;
    }
}
async function resolveDaemonRecord(context, options = {}) {
    const homeDir = normalizeHomeDir(context.env, context.cwd, options);
    const store = (0, runtimeStateStore_1.createRuntimeStateStore)(homeDir);
    return store.readDaemon();
}
function daemonConfigMatchesContext(daemonRecord, context) {
    if (!daemonRecord) {
        return false;
    }
    return normalizeEnvText(daemonRecord.configHash) === buildDaemonConfigHash(context.env);
}
async function stopRunningDaemon(daemonRecord) {
    if (!Number.isFinite(daemonRecord.pid) || daemonRecord.pid <= 0) {
        return;
    }
    try {
        process.kill(daemonRecord.pid, 'SIGTERM');
    }
    catch (error) {
        const code = error.code;
        if (code === 'ESRCH') {
            return;
        }
        throw error;
    }
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < DAEMON_CONFIG_RESTART_TIMEOUT_MS) {
        if (!await isDaemonReachable(daemonRecord.baseUrl)) {
            await waitForPortRelease(daemonRecord.host || DEFAULT_DAEMON_HOST, daemonRecord.port, DAEMON_CONFIG_RESTART_TIMEOUT_MS)
                .catch(() => { });
            return;
        }
        await sleep(DAEMON_START_POLL_INTERVAL_MS);
    }
    throw new Error('Timed out while restarting the local MetaBot daemon with updated configuration.');
}
async function ensureDaemonBaseUrl(context, options = {}) {
    const explicitBaseUrl = typeof context.env.METABOT_DAEMON_BASE_URL === 'string'
        ? context.env.METABOT_DAEMON_BASE_URL.trim()
        : '';
    if (explicitBaseUrl) {
        return normalizeBaseUrl(explicitBaseUrl);
    }
    const daemonRecord = await resolveDaemonRecord(context, options);
    if (daemonRecord?.baseUrl && await isDaemonReachable(daemonRecord.baseUrl)) {
        if (daemonConfigMatchesContext(daemonRecord, context)) {
            return daemonRecord.baseUrl;
        }
        await stopRunningDaemon(daemonRecord);
        return startDetachedDaemon(context, daemonRecord, options);
    }
    return startDetachedDaemon(context, undefined, options);
}
async function startDetachedDaemon(context, preferredRecord, options = {}) {
    const homeDir = normalizeHomeDir(context.env, context.cwd, options);
    const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
    const store = (0, runtimeStateStore_1.createRuntimeStateStore)(homeDir);
    const expectedConfigHash = buildDaemonConfigHash(context.env);
    const persistedRecord = await store.readDaemon();
    const staleRecord = persistedRecord ?? preferredRecord ?? null;
    if (persistedRecord?.baseUrl && await isDaemonReachable(persistedRecord.baseUrl)) {
        if (daemonConfigMatchesContext(persistedRecord, context)) {
            return persistedRecord.baseUrl;
        }
        await stopRunningDaemon(persistedRecord);
    }
    await store.clearDaemon();
    const child = (0, node_child_process_1.spawn)(process.execPath, [resolveCliEntrypoint(), 'daemon', 'serve'], {
        cwd: homeDir,
        detached: true,
        stdio: 'ignore',
        env: {
            ...context.env,
            HOME: systemHomeDir,
            METABOT_HOME: homeDir,
            ...(options.allowUnindexedExplicitHome ? { [ALLOW_UNINDEXED_HOME_ENV]: '1' } : {}),
            [DAEMON_PREFERRED_PORT_ENV]: String(parseDaemonPort(context.env[DAEMON_PREFERRED_PORT_ENV])
                ?? staleRecord?.port
                ?? getDefaultDaemonPort(homeDir)),
        },
    });
    child.unref();
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < DEFAULT_DAEMON_START_TIMEOUT_MS) {
        const daemonRecord = await store.readDaemon();
        if (daemonRecord?.baseUrl
            && normalizeEnvText(daemonRecord.configHash) === expectedConfigHash
            && await isDaemonReachable(daemonRecord.baseUrl)) {
            return daemonRecord.baseUrl;
        }
        await sleep(DAEMON_START_POLL_INTERVAL_MS);
    }
    throw new Error('Timed out while starting the local MetaBot daemon.');
}
async function requestJson(context, method, routePath, body, options = {}) {
    const baseUrl = await ensureDaemonBaseUrl(context, options);
    const response = await fetch(`${baseUrl}${routePath}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    return response.json();
}
async function requestText(context, method, routePath) {
    const baseUrl = await ensureDaemonBaseUrl(context);
    const response = await fetch(`${baseUrl}${routePath}`, {
        method,
    });
    if (!response.ok) {
        throw new Error(`Request failed with HTTP ${response.status}`);
    }
    return response.text();
}
async function observeNetworkDirectoryExecutionSafely(context, observation) {
    try {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const evolutionService = (0, service_1.createNetworkDirectoryEvolutionService)(homeDir);
        await evolutionService.observeNetworkDirectoryExecution(observation);
    }
    catch {
        // Evolution observation must never block normal CLI command execution.
    }
}
function wrapNetworkListServicesDependency(context, listServices) {
    if (!listServices) {
        return undefined;
    }
    return async (input) => {
        if (input.online !== true) {
            return listServices(input);
        }
        const startedAt = Date.now();
        try {
            const result = await listServices(input);
            if (result.state === 'waiting' || result.state === 'manual_action_required') {
                return result;
            }
            const finishedAt = Date.now();
            await observeNetworkDirectoryExecutionSafely(context, {
                skillName: 'metabot-network-directory',
                commandTemplate: 'metabot network services --online',
                startedAt,
                finishedAt,
                envelope: result,
                stdout: '',
                stderr: result.ok ? '' : (result.message ?? ''),
                usedUiFallback: false,
                manualRecovery: false,
            });
            return result;
        }
        catch (error) {
            const finishedAt = Date.now();
            const message = error instanceof Error ? error.message : String(error);
            await observeNetworkDirectoryExecutionSafely(context, {
                skillName: 'metabot-network-directory',
                commandTemplate: 'metabot network services --online',
                startedAt,
                finishedAt,
                envelope: (0, commandResult_1.commandFailed)('network_services_execution_failed', message),
                stdout: '',
                stderr: message,
                usedUiFallback: false,
                manualRecovery: false,
            });
            throw error;
        }
    };
}
async function resolveActiveVariantForSkill(context, skillName) {
    const homeDir = normalizeHomeDir(context.env, context.cwd);
    const evolutionStore = (0, localEvolutionStore_1.createLocalEvolutionStore)(homeDir);
    const index = await evolutionStore.readIndex();
    const activeVariantRef = (0, localEvolutionStore_1.parseSkillActiveVariantRef)(index.activeVariants[skillName]);
    if (!activeVariantRef) {
        return {
            activeVariant: null,
            activeVariantSource: null,
        };
    }
    let artifact;
    if (activeVariantRef.source === 'local') {
        const artifactPath = node_path_1.default.join(evolutionStore.paths.evolutionArtifactsRoot, `${activeVariantRef.variantId}.json`);
        artifact = await readArtifactFile(artifactPath);
    }
    else {
        try {
            const remoteStore = (0, remoteEvolutionStore_1.createRemoteEvolutionStore)(homeDir);
            artifact = await remoteStore.readArtifact(activeVariantRef.variantId);
        }
        catch {
            artifact = null;
        }
    }
    if (!artifact || artifact.skillName !== skillName) {
        return {
            activeVariant: null,
            activeVariantSource: null,
        };
    }
    return {
        activeVariant: {
            ...artifact,
            // Active refs are the source of truth even for imported remote artifacts,
            // which remain stored as inactive bodies in the remote cache.
            status: 'active',
        },
        activeVariantSource: activeVariantRef.source,
    };
}
async function clearActiveVariantMapping(context, skillName) {
    const homeDir = normalizeHomeDir(context.env, context.cwd);
    const evolutionStore = (0, localEvolutionStore_1.createLocalEvolutionStore)(homeDir);
    const index = await evolutionStore.readIndex();
    const previousVariantRef = (0, localEvolutionStore_1.parseSkillActiveVariantRef)(index.activeVariants[skillName]);
    if (!previousVariantRef) {
        return {
            removed: false,
            previousVariantId: null,
        };
    }
    await evolutionStore.clearActiveVariant(skillName);
    return {
        removed: true,
        previousVariantId: previousVariantRef.variantId,
    };
}
async function resolveEvolutionScopeHashForSkill(input) {
    const resolvedActiveVariant = input.evolutionNetworkEnabled
        ? await resolveActiveVariantForSkill(input.context, input.skillName)
        : { activeVariant: null, activeVariantSource: null };
    const rendered = (0, skillResolver_1.renderResolvedSkillContract)({
        skillName: input.skillName,
        host: 'codex',
        format: 'json',
        evolutionNetworkEnabled: input.evolutionNetworkEnabled,
        activeVariant: resolvedActiveVariant.activeVariant,
        activeVariantSource: resolvedActiveVariant.activeVariantSource,
    });
    return (0, searchArtifacts_1.deriveResolvedScopeHash)(rendered.contract);
}
function createTestChainWriteSigner(baseSigner) {
    let writeCount = 0;
    return {
        getIdentity: () => baseSigner.getIdentity(),
        getPrivateChatIdentity: () => baseSigner.getPrivateChatIdentity(),
        writePin: async (rawInput) => {
            const request = (0, writePin_1.normalizeChainWriteRequest)(rawInput);
            const identity = await baseSigner.getIdentity();
            writeCount += 1;
            return {
                txids: [`${request.path || 'metaid'}-tx-${writeCount}`],
                pinId: `${request.path || 'metaid'}-pin-${writeCount}`,
                totalCost: 1,
                network: request.network,
                operation: request.operation,
                path: request.path,
                contentType: request.contentType,
                encoding: request.encoding,
                globalMetaId: identity.globalMetaId,
                mvcAddress: identity.mvcAddress,
            };
        },
    };
}
function isEvolutionPublishFailureCode(value) {
    return value === 'evolution_variant_not_found'
        || value === 'evolution_variant_skill_mismatch'
        || value === 'evolution_variant_analysis_mismatch'
        || value === 'evolution_variant_scope_hash_missing'
        || value === 'evolution_variant_not_verified'
        || value === 'evolution_publish_not_supported';
}
function isEvolutionRuntimeFailureCode(value) {
    return value === 'evolution_search_not_supported'
        || value === 'evolution_scope_hash_missing'
        || value === 'evolution_chain_query_failed'
        || value === 'evolution_search_result_invalid'
        || value === 'evolution_search_index_failed'
        || value === 'evolution_import_metadata_invalid'
        || value === 'evolution_import_pin_not_found'
        || value === 'evolution_import_not_supported'
        || value === 'evolution_import_scope_mismatch'
        || value === 'evolution_import_variant_conflict'
        || value === 'evolution_import_artifact_fetch_failed'
        || value === 'evolution_import_artifact_invalid'
        || value === 'evolution_imported_not_supported'
        || value === 'evolution_imported_artifact_invalid'
        || value === 'evolution_remote_adopt_not_supported'
        || value === 'evolution_remote_variant_not_found'
        || value === 'evolution_remote_variant_skill_mismatch'
        || value === 'evolution_remote_variant_scope_mismatch'
        || value === 'evolution_remote_variant_invalid';
}
function mapEvolutionRuntimeError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'evolution_search_not_supported') {
        return { code: 'evolution_search_not_supported', message };
    }
    if (message === 'evolution_scope_hash_missing') {
        return { code: 'evolution_scope_hash_missing', message };
    }
    if (message.startsWith('evolution_chain_query_failed:')) {
        return { code: 'evolution_chain_query_failed', message };
    }
    if (message.startsWith('evolution_search_result_invalid:')) {
        return { code: 'evolution_search_result_invalid', message };
    }
    if (message.startsWith('evolution_search_index_failed:')) {
        return { code: 'evolution_search_index_failed', message };
    }
    const explicitCode = error && typeof error === 'object' ? error.code : undefined;
    if (isEvolutionRuntimeFailureCode(explicitCode)) {
        return { code: explicitCode, message };
    }
    return null;
}
function createCliSigner(context, homeDir) {
    const secretStore = (0, fileSecretStore_1.createFileSecretStore)(homeDir);
    const baseSigner = (0, localMnemonicSigner_1.createLocalMnemonicSigner)({ secretStore });
    if (context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1') {
        return createTestChainWriteSigner(baseSigner);
    }
    return baseSigner;
}
function createTestSubsidyRequester() {
    return async (options) => ({
        success: true,
        step1: {
            address: options.mvcAddress,
            source: 'test-fake-subsidy',
        },
        step2: {
            address: options.mvcAddress,
            source: 'test-fake-subsidy',
            rewarded: true,
        },
    });
}
function createTestProviderChatPublicKeyFetcher(env) {
    const publicKey = typeof env[TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY_ENV] === 'string'
        ? env[TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY_ENV].trim()
        : '';
    if (!publicKey) {
        return undefined;
    }
    return async () => publicKey;
}
function createTestMetaWebReplyWaiter(env) {
    const raw = typeof env[TEST_FAKE_METAWEB_REPLY_ENV] === 'string'
        ? env[TEST_FAKE_METAWEB_REPLY_ENV].trim()
        : '';
    if (!raw) {
        return undefined;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`Invalid ${TEST_FAKE_METAWEB_REPLY_ENV}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const sequence = Array.isArray(parsed.sequence) && parsed.sequence.length > 0
        ? parsed.sequence
        : [parsed];
    let replyIndex = 0;
    return {
        awaitServiceReply: async (input) => {
            const step = sequence[Math.min(replyIndex, sequence.length - 1)] ?? parsed;
            replyIndex += 1;
            const delayMs = Number.isFinite(step.delayMs)
                ? Math.max(0, Math.floor(Number(step.delayMs)))
                : 0;
            if (delayMs > 0) {
                await sleep(Math.min(delayMs, input.timeoutMs));
            }
            if (step.state === 'timeout') {
                return {
                    state: 'timeout',
                };
            }
            return {
                state: 'completed',
                responseText: typeof step.responseText === 'string'
                    ? step.responseText
                    : 'Test fake remote reply.',
                deliveryPinId: typeof step.deliveryPinId === 'string' ? step.deliveryPinId : null,
                ratingRequestText: typeof step.ratingRequestText === 'string' ? step.ratingRequestText : null,
                observedAt: Number.isFinite(step.observedAt)
                    ? Number(step.observedAt)
                    : Date.now(),
                rawMessage: {
                    source: 'test-fake-metaweb-reply',
                },
            };
        },
    };
}
function createTestMasterReplyWaiter(env) {
    const raw = typeof env[TEST_FAKE_MASTER_REPLY_ENV] === 'string'
        ? env[TEST_FAKE_MASTER_REPLY_ENV].trim()
        : '';
    if (!raw) {
        return undefined;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`Invalid ${TEST_FAKE_MASTER_REPLY_ENV}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const sequence = Array.isArray(parsed.sequence) && parsed.sequence.length > 0
        ? parsed.sequence
        : [parsed];
    let replyIndex = 0;
    return {
        awaitMasterReply: async (input) => {
            const step = sequence[Math.min(replyIndex, sequence.length - 1)] ?? parsed;
            replyIndex += 1;
            const delayMs = Number.isFinite(step.delayMs)
                ? Math.max(0, Math.floor(Number(step.delayMs)))
                : 0;
            if (delayMs > 0) {
                await sleep(Math.min(delayMs, input.timeoutMs));
            }
            if (step.state === 'timeout') {
                return {
                    state: 'timeout',
                };
            }
            const responseJson = typeof step.responseJson === 'string' ? step.responseJson.trim() : '';
            if (!responseJson) {
                throw new Error(`Invalid ${TEST_FAKE_MASTER_REPLY_ENV}: responseJson is required unless state=timeout.`);
            }
            const parsedResponse = (0, masterMessageSchema_1.parseMasterResponse)(responseJson);
            if (!parsedResponse.ok) {
                throw new Error(`Invalid ${TEST_FAKE_MASTER_REPLY_ENV}: ${parsedResponse.message}`);
            }
            return {
                state: 'completed',
                response: parsedResponse.value,
                responseJson,
                deliveryPinId: typeof step.deliveryPinId === 'string' ? step.deliveryPinId : null,
                observedAt: Number.isFinite(step.observedAt)
                    ? Number(step.observedAt)
                    : Date.now(),
                rawMessage: {
                    source: 'test-fake-master-reply',
                },
            };
        },
    };
}
function createDefaultCliDependencies(context) {
    return {
        config: {
            get: async (input) => {
                if (!isSupportedConfigKey(input.key)) {
                    return (0, commandResult_1.commandFailed)('unsupported_config_key', `Unsupported config key: ${input.key}`);
                }
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const configStore = (0, configStore_1.createConfigStore)(homeDir);
                const config = await configStore.read();
                return (0, commandResult_1.commandSuccess)({
                    key: input.key,
                    value: readConfigValue(config, input.key),
                });
            },
            set: async (input) => {
                if (!isSupportedConfigKey(input.key)) {
                    return (0, commandResult_1.commandFailed)('unsupported_config_key', `Unsupported config key: ${input.key}`);
                }
                const normalizedValue = normalizeConfigValueForKey({
                    key: input.key,
                    value: input.value,
                });
                if (!normalizedValue.ok) {
                    return (0, commandResult_1.commandFailed)('invalid_argument', normalizedValue.message);
                }
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const configStore = (0, configStore_1.createConfigStore)(homeDir);
                const config = await configStore.read();
                const nextConfig = writeConfigValue(config, input.key, normalizedValue.value);
                await configStore.set(nextConfig);
                return (0, commandResult_1.commandSuccess)({
                    key: input.key,
                    value: readConfigValue(nextConfig, input.key),
                });
            },
        },
        buzz: {
            post: async (input) => requestJson(context, 'POST', '/api/buzz/post', input),
        },
        chain: {
            write: async (input) => requestJson(context, 'POST', '/api/chain/write', input),
        },
        daemon: {
            start: async () => {
                const baseUrl = await ensureDaemonBaseUrl(context);
                const daemonRecord = await resolveDaemonRecord(context);
                const parsed = new URL(baseUrl);
                return (0, commandResult_1.commandSuccess)({
                    host: parsed.hostname,
                    port: Number(parsed.port || '80'),
                    baseUrl,
                    pid: daemonRecord?.pid ?? null,
                });
            },
        },
        doctor: {
            run: async () => requestJson(context, 'GET', '/api/doctor'),
        },
        identity: {
            create: async (input) => {
                const normalizedName = normalizeEnvText(input.name);
                if (!normalizedName) {
                    return (0, commandResult_1.commandFailed)('missing_name', 'MetaBot identity name is required.');
                }
                const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
                const explicitHomeDir = normalizeEnvText(context.env.METABOT_HOME)
                    ? tryNormalizeHomeDir(context.env, context.cwd, {
                        allowUnindexedExplicitHome: true,
                    })
                    : null;
                const activeHomeDir = await (0, identityProfiles_1.readActiveMetabotHome)(systemHomeDir);
                let targetHomeDir = null;
                if (explicitHomeDir) {
                    const explicitState = await (0, runtimeStateStore_1.createRuntimeStateStore)(explicitHomeDir).readState();
                    if (explicitState.identity || explicitHomeDir === activeHomeDir) {
                        targetHomeDir = explicitHomeDir;
                    }
                }
                if (!targetHomeDir) {
                    const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir);
                    const resolvedHome = (0, profileWorkspace_1.resolveIdentityCreateProfileHome)({
                        systemHomeDir,
                        requestedName: normalizedName,
                        profiles,
                    });
                    if (resolvedHome.status === 'duplicate') {
                        return (0, commandResult_1.commandFailed)('identity_name_taken', resolvedHome.message);
                    }
                    targetHomeDir = resolvedHome.homeDir;
                }
                return requestJson(cloneContextWithHomeDir(context, targetHomeDir), 'POST', '/api/identity/create', input, {
                    allowUnindexedExplicitHome: true,
                });
            },
            who: async () => {
                const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
                const activeHomeDir = await (0, identityProfiles_1.readActiveMetabotHome)(systemHomeDir);
                if (!activeHomeDir) {
                    return (0, commandResult_1.commandFailed)('identity_profile_not_initialized', 'No active profile initialized.');
                }
                const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir);
                const activeProfile = profiles.find((profile) => profile.homeDir === activeHomeDir);
                if (!activeProfile) {
                    return (0, commandResult_1.commandFailed)('identity_profile_not_initialized', 'No active profile initialized.');
                }
                return (0, commandResult_1.commandSuccess)({
                    activeHomeDir,
                    systemHomeDir,
                    identity: {
                        name: activeProfile.name,
                        slug: activeProfile.slug,
                        aliases: activeProfile.aliases,
                        globalMetaId: activeProfile.globalMetaId,
                        mvcAddress: activeProfile.mvcAddress,
                    },
                });
            },
            list: async () => {
                const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
                const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir);
                const activeHomeDir = await (0, identityProfiles_1.readActiveMetabotHome)(systemHomeDir);
                return (0, commandResult_1.commandSuccess)({
                    systemHomeDir,
                    activeHomeDir: activeHomeDir || null,
                    profiles,
                });
            },
            assign: async (input) => {
                const targetName = normalizeEnvText(input.name);
                if (!targetName) {
                    return (0, commandResult_1.commandFailed)('missing_name', 'MetaBot identity name is required for identity assign.');
                }
                const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
                const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir);
                const resolved = (0, profileNameResolution_1.resolveProfileNameMatch)(targetName, profiles);
                if (resolved.status === 'not_found') {
                    return (0, commandResult_1.commandFailed)('identity_profile_not_found', resolved.message);
                }
                if (resolved.status === 'ambiguous') {
                    return (0, commandResult_1.commandFailed)('identity_profile_ambiguous', resolved.message);
                }
                const selected = resolved.match;
                await (0, identityProfiles_1.setActiveMetabotHome)({
                    systemHomeDir,
                    homeDir: selected.homeDir,
                });
                return (0, commandResult_1.commandSuccess)({
                    activeHomeDir: selected.homeDir,
                    assignedProfile: selected,
                });
            },
        },
        master: {
            publish: async (input) => requestJson(context, 'POST', '/api/master/publish', input),
            list: async (input) => {
                const query = new URLSearchParams();
                if (input.online !== undefined) {
                    query.set('online', input.online ? 'true' : 'false');
                }
                if (typeof input.masterKind === 'string' && input.masterKind.trim()) {
                    query.set('kind', input.masterKind.trim());
                }
                const suffix = query.size ? `?${query.toString()}` : '';
                return requestJson(context, 'GET', `/api/master/list${suffix}`);
            },
            ask: async (input) => requestJson(context, 'POST', '/api/master/ask', input),
            suggest: async (input) => requestJson(context, 'POST', '/api/master/suggest', input),
            hostAction: async (input) => requestJson(context, 'POST', '/api/master/host-action', input),
            trace: async (input) => requestJson(context, 'GET', `/api/master/trace/${encodeURIComponent(input.traceId)}`),
        },
        network: {
            listServices: async (input) => {
                const query = input.online === undefined ? '' : `?online=${input.online ? 'true' : 'false'}`;
                return requestJson(context, 'GET', `/api/network/services${query}`);
            },
            listBots: async (input) => {
                const query = new URLSearchParams();
                if (input.online !== undefined) {
                    query.set('online', input.online ? 'true' : 'false');
                }
                if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
                    query.set('limit', String(Math.max(1, Math.floor(input.limit))));
                }
                const suffix = query.size ? `?${query.toString()}` : '';
                return requestJson(context, 'GET', `/api/network/bots${suffix}`);
            },
            listSources: async () => requestJson(context, 'GET', '/api/network/sources'),
            addSource: async (input) => requestJson(context, 'POST', '/api/network/sources', input),
            removeSource: async (input) => requestJson(context, 'DELETE', '/api/network/sources', input),
        },
        services: {
            publish: async (input) => requestJson(context, 'POST', '/api/services/publish', input),
            call: async (input) => requestJson(context, 'POST', '/api/services/call', input),
            rate: async (input) => requestJson(context, 'POST', '/api/services/rate', input),
        },
        chat: {
            private: async (input) => requestJson(context, 'POST', '/api/chat/private', input),
            conversations: async () => requestJson(context, 'GET', '/api/chat/private/conversations'),
            messages: async (input) => {
                const params = new URLSearchParams({ conversationId: input.conversationId });
                if (input.limit != null)
                    params.set('limit', String(input.limit));
                return requestJson(context, 'GET', `/api/chat/private/messages?${params.toString()}`);
            },
            autoReplyStatus: async () => requestJson(context, 'GET', '/api/chat/auto-reply/status'),
            setAutoReply: async (input) => requestJson(context, 'POST', '/api/chat/auto-reply/config', input),
        },
        file: {
            upload: async (input) => requestJson(context, 'POST', '/api/file/upload', input),
        },
        wallet: {
            balance: async (input) => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const runtimeStateStore = (0, runtimeStateStore_1.createRuntimeStateStore)(homeDir);
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'No local MetaBot identity is loaded for the current active home.');
                }
                const targetChains = input.chain === 'all'
                    ? ['mvc', 'btc']
                    : [input.chain];
                try {
                    const balances = {};
                    for (const chain of targetChains) {
                        if (chain === 'mvc') {
                            const mvcAddress = normalizeEnvText(state.identity.mvcAddress);
                            if (!mvcAddress) {
                                return (0, commandResult_1.commandFailed)('identity_address_missing', 'Current identity has no mvcAddress.');
                            }
                            balances.mvc = await fetchMvcBalanceSnapshot(mvcAddress);
                            continue;
                        }
                        const btcAddress = normalizeEnvText(state.identity.btcAddress);
                        if (!btcAddress) {
                            return (0, commandResult_1.commandFailed)('identity_address_missing', 'Current identity has no btcAddress.');
                        }
                        balances.btc = await fetchBtcBalanceSnapshot(btcAddress);
                    }
                    return (0, commandResult_1.commandSuccess)({
                        chain: input.chain,
                        globalMetaId: state.identity.globalMetaId,
                        balances,
                    });
                }
                catch (error) {
                    return (0, commandResult_1.commandFailed)('wallet_balance_query_failed', error instanceof Error ? error.message : String(error));
                }
            },
        },
        trace: {
            get: async (input) => requestJson(context, 'GET', `/api/trace/${encodeURIComponent(input.traceId)}`),
            watch: async (input) => requestText(context, 'GET', `/api/trace/${encodeURIComponent(input.traceId)}/watch`),
        },
        ui: {
            open: async (input) => {
                const baseUrl = await ensureDaemonBaseUrl(context);
                const query = input.traceId
                    ? `?traceId=${encodeURIComponent(input.traceId)}`
                    : '';
                return (0, commandResult_1.commandSuccess)({
                    page: input.page,
                    localUiUrl: `${baseUrl}${resolveLocalUiPath(input.page)}${query}`,
                });
            },
        },
        skills: {
            resolve: async (input) => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const configStore = (0, configStore_1.createConfigStore)(homeDir);
                const config = await configStore.read();
                const resolvedActiveVariant = config.evolution_network.enabled
                    ? await resolveActiveVariantForSkill(context, input.skill)
                    : { activeVariant: null, activeVariantSource: null };
                const rendered = (0, skillResolver_1.renderResolvedSkillContract)({
                    skillName: input.skill,
                    host: input.host,
                    format: input.format,
                    evolutionNetworkEnabled: config.evolution_network.enabled,
                    activeVariant: resolvedActiveVariant.activeVariant,
                    activeVariantSource: resolvedActiveVariant.activeVariantSource,
                });
                if (rendered.format === 'markdown') {
                    return (0, commandResult_1.commandSuccess)(rendered.markdown);
                }
                return (0, commandResult_1.commandSuccess)(rendered);
            },
        },
        host: {
            bindSkills: async (input) => {
                try {
                    const result = await (0, hostSkillBinding_1.bindHostSkills)({
                        systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
                        host: input.host,
                        env: context.env,
                    });
                    return (0, commandResult_1.commandSuccess)(result);
                }
                catch (error) {
                    if (error instanceof hostSkillBinding_1.HostSkillBindingError) {
                        return {
                            ok: false,
                            state: 'failed',
                            code: error.code,
                            message: error.message,
                            data: error.data,
                        };
                    }
                    return (0, commandResult_1.commandFailed)('host_skill_bind_failed', error instanceof Error ? error.message : String(error));
                }
            },
        },
        evolution: {
            status: async () => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const configStore = (0, configStore_1.createConfigStore)(homeDir);
                const config = await configStore.read();
                const evolutionStore = (0, localEvolutionStore_1.createLocalEvolutionStore)(homeDir);
                const index = await evolutionStore.readIndex();
                return (0, commandResult_1.commandSuccess)({
                    enabled: config.evolution_network.enabled,
                    executions: index.executions.length,
                    analyses: index.analyses.length,
                    artifacts: index.artifacts.length,
                    activeVariants: projectActiveVariantIds(index.activeVariants),
                    activeVariantRefs: projectActiveVariantRefs(index.activeVariants),
                });
            },
            search: async (input) => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const configStore = (0, configStore_1.createConfigStore)(homeDir);
                const config = await configStore.read();
                if (!config.evolution_network.enabled) {
                    return (0, commandResult_1.commandFailed)('evolution_network_disabled', 'Evolution network search is disabled.');
                }
                if (input.skill !== EVOLUTION_IMPORT_SKILL_NAME) {
                    return (0, commandResult_1.commandFailed)('evolution_search_not_supported', `Evolution search is currently supported only for "${EVOLUTION_IMPORT_SKILL_NAME}".`);
                }
                try {
                    const resolvedScopeHash = await resolveEvolutionScopeHashForSkill({
                        context,
                        skillName: input.skill,
                        evolutionNetworkEnabled: config.evolution_network.enabled,
                    });
                    const remoteStore = (0, remoteEvolutionStore_1.createRemoteEvolutionStore)(homeDir);
                    const chainReader = (0, chainEvolutionReader_1.createChainEvolutionReader)({
                        chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
                    });
                    const results = await (0, searchArtifacts_1.searchPublishedEvolutionArtifacts)({
                        skillName: input.skill,
                        resolvedScopeHash,
                        remoteStore,
                        fetchMetadataRows: chainReader.fetchMetadataRows,
                    });
                    return (0, commandResult_1.commandSuccess)(results);
                }
                catch (error) {
                    const mapped = mapEvolutionRuntimeError(error);
                    if (mapped) {
                        return (0, commandResult_1.commandFailed)(mapped.code, mapped.message);
                    }
                    throw error;
                }
            },
            publish: async (input) => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const configStore = (0, configStore_1.createConfigStore)(homeDir);
                const config = await configStore.read();
                if (!config.evolution_network.enabled) {
                    return (0, commandResult_1.commandFailed)('evolution_network_disabled', 'Evolution network publishing is disabled.');
                }
                const evolutionStore = (0, localEvolutionStore_1.createLocalEvolutionStore)(homeDir);
                const signer = createCliSigner(context, homeDir);
                const identity = await signer.getIdentity();
                try {
                    const published = await (0, publishArtifact_1.publishEvolutionArtifact)({
                        store: evolutionStore,
                        skillName: input.skill,
                        variantId: input.variantId,
                        publisherGlobalMetaId: identity.globalMetaId,
                        uploadArtifactBody: async (filePath) => {
                            const uploaded = await (0, uploadFile_1.uploadLocalFileToChain)({
                                filePath,
                                signer,
                            });
                            return {
                                artifactUri: uploaded.metafileUri,
                            };
                        },
                        writeMetadataPin: async (request) => {
                            const result = await signer.writePin(request);
                            return {
                                pinId: result.pinId,
                                txids: result.txids,
                            };
                        },
                    });
                    return (0, commandResult_1.commandSuccess)(published);
                }
                catch (error) {
                    const code = error && typeof error === 'object' ? error.code : undefined;
                    const message = error instanceof Error ? error.message : String(error);
                    if (isEvolutionPublishFailureCode(code)) {
                        return (0, commandResult_1.commandFailed)(code, message);
                    }
                    throw error;
                }
            },
            import: async (input) => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const configStore = (0, configStore_1.createConfigStore)(homeDir);
                const config = await configStore.read();
                if (!config.evolution_network.enabled) {
                    return (0, commandResult_1.commandFailed)('evolution_network_disabled', 'Evolution network import is disabled.');
                }
                try {
                    const resolvedScopeHash = await resolveEvolutionScopeHashForSkill({
                        context,
                        skillName: EVOLUTION_IMPORT_SKILL_NAME,
                        evolutionNetworkEnabled: config.evolution_network.enabled,
                    });
                    const remoteStore = (0, remoteEvolutionStore_1.createRemoteEvolutionStore)(homeDir);
                    const chainReader = (0, chainEvolutionReader_1.createChainEvolutionReader)({
                        chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
                    });
                    const imported = await (0, importArtifact_1.importPublishedEvolutionArtifact)({
                        pinId: input.pinId,
                        skillName: EVOLUTION_IMPORT_SKILL_NAME,
                        resolvedScopeHash,
                        remoteStore,
                        readMetadataPinById: chainReader.readMetadataPinById,
                        readArtifactBodyByUri: chainReader.readArtifactBodyByUri,
                    });
                    return (0, commandResult_1.commandSuccess)(imported);
                }
                catch (error) {
                    const mapped = mapEvolutionRuntimeError(error);
                    if (mapped) {
                        return (0, commandResult_1.commandFailed)(mapped.code, mapped.message);
                    }
                    throw error;
                }
            },
            imported: async (input) => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const configStore = (0, configStore_1.createConfigStore)(homeDir);
                const config = await configStore.read();
                if (!config.evolution_network.enabled) {
                    return (0, commandResult_1.commandFailed)('evolution_network_disabled', 'Evolution network imported listing is disabled.');
                }
                try {
                    const evolutionStore = (0, localEvolutionStore_1.createLocalEvolutionStore)(homeDir);
                    const index = await evolutionStore.readIndex();
                    const activeRef = (0, localEvolutionStore_1.parseSkillActiveVariantRef)(index.activeVariants[input.skill]);
                    const remoteStore = (0, remoteEvolutionStore_1.createRemoteEvolutionStore)(homeDir);
                    const imported = await (0, listImportedArtifacts_1.listImportedEvolutionArtifacts)({
                        skillName: input.skill,
                        activeRef,
                        remoteStore,
                    });
                    return (0, commandResult_1.commandSuccess)(imported);
                }
                catch (error) {
                    const mapped = mapEvolutionRuntimeError(error);
                    if (mapped) {
                        return (0, commandResult_1.commandFailed)(mapped.code, mapped.message);
                    }
                    throw error;
                }
            },
            adopt: async (input) => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                if (input.source === 'remote') {
                    const configStore = (0, configStore_1.createConfigStore)(homeDir);
                    const config = await configStore.read();
                    if (!config.evolution_network.enabled) {
                        return (0, commandResult_1.commandFailed)('evolution_network_disabled', 'Evolution network remote adoption is disabled.');
                    }
                    if (input.skill !== EVOLUTION_IMPORT_SKILL_NAME) {
                        return (0, commandResult_1.commandFailed)('evolution_remote_adopt_not_supported', `Remote adoption is currently supported only for "${EVOLUTION_IMPORT_SKILL_NAME}".`);
                    }
                    try {
                        const resolvedScopeHash = await resolveEvolutionScopeHashForSkill({
                            context,
                            skillName: input.skill,
                            evolutionNetworkEnabled: config.evolution_network.enabled,
                        });
                        const evolutionStore = (0, localEvolutionStore_1.createLocalEvolutionStore)(homeDir);
                        const remoteStore = (0, remoteEvolutionStore_1.createRemoteEvolutionStore)(homeDir);
                        const adopted = await (0, remoteAdoption_1.adoptRemoteEvolutionArtifact)({
                            skillName: input.skill,
                            variantId: input.variantId,
                            resolvedScopeHash,
                            remoteStore,
                            evolutionStore,
                        });
                        return (0, commandResult_1.commandSuccess)(adopted);
                    }
                    catch (error) {
                        const mapped = mapEvolutionRuntimeError(error);
                        if (mapped) {
                            return (0, commandResult_1.commandFailed)(mapped.code, mapped.message);
                        }
                        throw error;
                    }
                }
                const evolutionStore = (0, localEvolutionStore_1.createLocalEvolutionStore)(homeDir);
                const artifactPath = node_path_1.default.join(evolutionStore.paths.evolutionArtifactsRoot, `${input.variantId}.json`);
                const artifact = await readArtifactFile(artifactPath);
                if (!artifact) {
                    return (0, commandResult_1.commandFailed)('evolution_variant_not_found', `Variant not found: ${input.variantId}`);
                }
                if (artifact.skillName !== input.skill) {
                    return (0, commandResult_1.commandFailed)('evolution_variant_skill_mismatch', `Variant ${input.variantId} belongs to ${String(artifact.skillName)} and cannot be adopted for ${input.skill}.`);
                }
                const updatedArtifact = {
                    ...artifact,
                    status: 'active',
                    adoption: 'active',
                    updatedAt: Date.now(),
                };
                await evolutionStore.writeArtifact(updatedArtifact);
                await evolutionStore.setActiveVariant(input.skill, input.variantId);
                return (0, commandResult_1.commandSuccess)({
                    skillName: input.skill,
                    variantId: input.variantId,
                    active: true,
                });
            },
            rollback: async (input) => {
                const rollback = await clearActiveVariantMapping(context, input.skill);
                return (0, commandResult_1.commandSuccess)({
                    skillName: input.skill,
                    rolledBack: rollback.removed,
                    previousVariantId: rollback.previousVariantId,
                });
            },
        },
    };
}
function mergeCliDependencies(context) {
    const defaults = createDefaultCliDependencies(context);
    const provided = context.dependencies;
    const defaultNetwork = defaults.network ?? {};
    const networkListServices = wrapNetworkListServicesDependency(context, provided.network?.listServices ?? defaultNetwork.listServices);
    return {
        config: { ...defaults.config, ...provided.config },
        buzz: { ...defaults.buzz, ...provided.buzz },
        chain: { ...defaults.chain, ...provided.chain },
        daemon: { ...defaults.daemon, ...provided.daemon },
        doctor: { ...defaults.doctor, ...provided.doctor },
        identity: { ...defaults.identity, ...provided.identity },
        master: { ...defaults.master, ...provided.master },
        network: {
            ...defaultNetwork,
            ...provided.network,
            listServices: networkListServices,
        },
        services: { ...defaults.services, ...provided.services },
        chat: { ...defaults.chat, ...provided.chat },
        file: { ...defaults.file, ...provided.file },
        wallet: { ...defaults.wallet, ...provided.wallet },
        trace: { ...defaults.trace, ...provided.trace },
        ui: { ...defaults.ui, ...provided.ui },
        skills: { ...defaults.skills, ...provided.skills },
        host: { ...defaults.host, ...provided.host },
        evolution: { ...defaults.evolution, ...provided.evolution },
    };
}
async function serveCliDaemonProcess(context) {
    const homeDir = normalizeHomeDir(context.env, context.cwd, {
        allowUnindexedExplicitHome: context.env[ALLOW_UNINDEXED_HOME_ENV] === '1',
    });
    const paths = (0, paths_1.resolveMetabotPaths)(homeDir);
    let daemonRecord = null;
    const secretStore = (0, fileSecretStore_1.createFileSecretStore)(homeDir);
    const baseSigner = (0, localMnemonicSigner_1.createLocalMnemonicSigner)({ secretStore });
    const signer = context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
        ? createTestChainWriteSigner(baseSigner)
        : baseSigner;
    const requestMvcGasSubsidy = context.env[TEST_FAKE_SUBSIDY_ENV] === '1'
        ? createTestSubsidyRequester()
        : undefined;
    const fetchPeerChatPublicKey = createTestProviderChatPublicKeyFetcher(context.env);
    const callerReplyWaiter = createTestMetaWebReplyWaiter(context.env);
    const masterReplyWaiter = createTestMasterReplyWaiter(context.env) ?? (0, metawebMasterReplyWaiter_1.createSocketIoMetaWebMasterReplyWaiter)();
    const socketPresenceApiBaseUrl = context.env.METABOT_SOCKET_PRESENCE_API_BASE_URL
        || (context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1' ? 'http://127.0.0.1:9' : undefined);
    const sharedAutoReplyConfig = {
        enabled: false,
        acceptPolicy: 'accept_all',
        defaultStrategyId: null,
    };
    const daemon = (0, daemon_1.createMetabotDaemon)({
        homeDirOrPaths: paths,
        handlers: (0, defaultHandlers_1.createDefaultMetabotDaemonHandlers)({
            homeDir,
            systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
            getDaemonRecord: () => daemonRecord,
            secretStore,
            signer,
            chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
            socketPresenceApiBaseUrl,
            socketPresenceFailureMode: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
                ? 'assume_service_providers_online'
                : 'throw',
            identitySyncStepDelayMs: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1' ? 0 : undefined,
            fetchPeerChatPublicKey,
            callerReplyWaiter,
            masterReplyWaiter,
            requestMvcGasSubsidy,
            autoReplyConfig: sharedAutoReplyConfig,
        }),
    });
    const host = DEFAULT_DAEMON_HOST;
    const explicitPort = parseDaemonPort(context.env.METABOT_DAEMON_PORT);
    const preferredPort = explicitPort
        ?? parseDaemonPort(context.env[DAEMON_PREFERRED_PORT_ENV])
        ?? getDefaultDaemonPort(homeDir);
    let started;
    try {
        started = await daemon.start(preferredPort, host);
    }
    catch (error) {
        if (explicitPort != null || !isAddressInUseError(error)) {
            throw error;
        }
        started = await daemon.start(0, host);
    }
    const runtimeStore = (0, runtimeStateStore_1.createRuntimeStateStore)(paths);
    const providerPresenceStore = (0, providerPresenceState_1.createProviderPresenceStateStore)(paths);
    const providerHeartbeatLoop = (0, providerHeartbeatLoop_1.createProviderHeartbeatLoop)({
        signer,
        presenceStore: providerPresenceStore,
        getIdentity: async () => {
            const state = await runtimeStore.readState();
            if (!state.identity) {
                return null;
            }
            return {
                globalMetaId: state.identity.globalMetaId,
                mvcAddress: state.identity.mvcAddress,
            };
        },
    });
    daemonRecord = await runtimeStore.writeDaemon({
        ownerId: daemon.ownerId,
        pid: process.pid,
        host: started.host,
        port: started.port,
        baseUrl: started.baseUrl,
        startedAt: Date.now(),
        configHash: buildDaemonConfigHash(context.env),
    });
    const providerPresence = await providerPresenceStore.read();
    if (providerPresence.enabled) {
        await providerHeartbeatLoop.start();
    }
    const chatStateStore = (0, privateChatStateStore_1.createPrivateChatStateStore)(paths);
    const chatStrategyStore = (0, chatStrategyStore_1.createChatStrategyStore)(paths);
    const resolvePeerChatPublicKeyForChat = fetchPeerChatPublicKey ?? (async (_id) => null);
    const chatAutoReplyOrchestrator = (0, privateChatAutoReply_1.createPrivateChatAutoReplyOrchestrator)({
        stateStore: chatStateStore,
        strategyStore: chatStrategyStore,
        paths,
        signer,
        selfGlobalMetaId: async () => {
            const state = await runtimeStore.readState();
            return state.identity?.globalMetaId ?? null;
        },
        resolvePeerChatPublicKey: resolvePeerChatPublicKeyForChat,
        replyRunner: (0, hostLlmChatReplyRunner_1.createHostLlmChatReplyRunner)(),
    }, sharedAutoReplyConfig);
    const privateChatListener = (0, privateChatListener_1.createPrivateChatListener)({
        getIdentity: async () => {
            const state = await runtimeStore.readState();
            if (!state.identity)
                return null;
            try {
                const chatIdentity = await signer.getPrivateChatIdentity();
                return {
                    globalMetaId: chatIdentity.globalMetaId,
                    privateKeyHex: chatIdentity.privateKeyHex,
                    chatPublicKey: chatIdentity.chatPublicKey,
                };
            }
            catch {
                return null;
            }
        },
        callbacks: {
            onMessage: (message) => { void chatAutoReplyOrchestrator.handleInboundMessage(message); },
        },
        resolvePeerChatPublicKey: resolvePeerChatPublicKeyForChat,
    });
    privateChatListener.start();
    let shuttingDown = false;
    const shutdown = async (exitCode) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        privateChatListener.stop();
        providerHeartbeatLoop.stop();
        await runtimeStore.clearDaemon(process.pid);
        await daemon.close();
        process.exit(exitCode);
    };
    process.on('SIGTERM', () => { void shutdown(0); });
    process.on('SIGINT', () => { void shutdown(0); });
    process.on('uncaughtException', (error) => {
        console.error(error);
        void shutdown(1);
    });
    process.on('unhandledRejection', (error) => {
        console.error(error);
        void shutdown(1);
    });
    return new Promise(() => { });
}
