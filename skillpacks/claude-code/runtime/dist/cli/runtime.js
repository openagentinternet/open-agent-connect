"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildA2ASimplemsgInboundDispatcher = buildA2ASimplemsgInboundDispatcher;
exports.getDefaultDaemonPort = getDefaultDaemonPort;
exports.getDaemonRuntimeFingerprint = getDaemonRuntimeFingerprint;
exports.buildDaemonConfigHash = buildDaemonConfigHash;
exports.createPrivateChatAutoReplyProfileDispatcher = createPrivateChatAutoReplyProfileDispatcher;
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
const onlineServiceCache_1 = require("../core/discovery/onlineServiceCache");
const onlineServiceCacheSync_1 = require("../core/discovery/onlineServiceCacheSync");
const remoteCall_1 = require("../core/delegation/remoteCall");
const ratingDetailState_1 = require("../core/ratings/ratingDetailState");
const fileSecretStore_1 = require("../core/secrets/fileSecretStore");
const localMnemonicSigner_1 = require("../core/signing/localMnemonicSigner");
const writePin_1 = require("../core/chain/writePin");
const registry_1 = require("../core/chain/adapters/registry");
const daemon_1 = require("../daemon");
const defaultHandlers_1 = require("../daemon/defaultHandlers");
const simplemsgListener_1 = require("../core/a2a/simplemsgListener");
const simplemsgClassifier_1 = require("../core/a2a/simplemsgClassifier");
const metawebMasterReplyWaiter_1 = require("../core/master/metawebMasterReplyWaiter");
const masterMessageSchema_1 = require("../core/master/masterMessageSchema");
const privateChatAutoReply_1 = require("../core/chat/privateChatAutoReply");
const privateChatAutoReplyBackfill_1 = require("../core/chat/privateChatAutoReplyBackfill");
const privateChatStateStore_1 = require("../core/chat/privateChatStateStore");
const chatStrategyStore_1 = require("../core/chat/chatStrategyStore");
const hostLlmChatReplyRunner_1 = require("../core/chat/hostLlmChatReplyRunner");
const servicePayment_1 = require("../core/payments/servicePayment");
const llmRuntimeStore_1 = require("../core/llm/llmRuntimeStore");
const llmBindingStore_1 = require("../core/llm/llmBindingStore");
const llmRuntimeResolver_1 = require("../core/llm/llmRuntimeResolver");
const llmRuntimeDiscovery_1 = require("../core/llm/llmRuntimeDiscovery");
const platformSkillCatalog_1 = require("../core/services/platformSkillCatalog");
const executor_1 = require("../core/llm/executor");
const update_1 = require("../core/system/update");
const uninstall_1 = require("../core/system/uninstall");
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
const TEST_FAKE_BUYER_RATING_REPLY_ENV = 'METABOT_TEST_FAKE_BUYER_RATING_REPLY';
const TEST_FAKE_MASTER_REPLY_ENV = 'METABOT_TEST_FAKE_MASTER_REPLY';
const TEST_FAKE_PROVIDER_LLM_REPLY_ENV = 'METABOT_TEST_FAKE_PROVIDER_LLM_REPLY';
const ALLOW_UNINDEXED_HOME_ENV = 'METABOT_ALLOW_UNINDEXED_HOME';
const DAEMON_CONFIG_RESTART_TIMEOUT_MS = 5_000;
const METALET_HOST = 'https://www.metalet.space';
const CHAIN_NET = 'livenet';
let cachedDaemonRuntimeFingerprint = null;
function normalizeDispatcherPrivateChatMessage(message) {
    return {
        fromGlobalMetaId: message.fromGlobalMetaId,
        content: message.content,
        messagePinId: message.messagePinId ?? null,
        fromChatPublicKey: message.fromChatPublicKey ?? null,
        timestamp: Number.isFinite(message.timestamp) ? Math.trunc(Number(message.timestamp)) : Date.now(),
        rawMessage: message.rawMessage ?? null,
    };
}
function buildA2ASimplemsgInboundDispatcher(input) {
    const logWarning = input.logWarning ?? ((scope, error) => {
        console.warn(scope, error instanceof Error ? error.message : String(error));
    });
    return async (message) => {
        const simplemsgClassification = (0, simplemsgClassifier_1.classifySimplemsgContent)(message.content);
        const orderProtocolHandler = input.handleOrderProtocolMessage;
        if (orderProtocolHandler) {
            try {
                const result = await orderProtocolHandler(message);
                if (simplemsgClassification.kind === 'order_protocol'
                    || (result?.ok === true && result.data?.handled === true)) {
                    return;
                }
            }
            catch (error) {
                logWarning('[A2A order protocol handler]', error);
                if (simplemsgClassification.kind === 'order_protocol') {
                    return;
                }
            }
        }
        await input.handleGenericPrivateChatMessage(normalizeDispatcherPrivateChatMessage(message));
    };
}
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
/**
 * Parse a transfer amount string like "0.01DOGE", "0.00001BTC", "1SPACE", "10OPCAT".
 * DOGE amounts: unit is DOGE (1 DOGE = 1e8 satoshis).
 * BTC amounts: unit is BTC (1 BTC = 1e8 satoshis).
 * SPACE amounts: unit is SPACE (1 SPACE = 1e8 satoshis).
 * OPCAT amounts: unit is OPCAT (1 OPCAT = 1e8 satoshis).
 */
function parseTransferAmount(raw, adapters) {
    const trimmed = raw.trim();
    const match = trimmed.match(/^([\d.]+)\s*(btc|space|doge|opcat)$/i);
    if (!match) {
        const hasUnit = /[a-z]/i.test(trimmed);
        if (!hasUnit) {
            throw new Error('Missing currency unit. Append BTC, SPACE, DOGE, or OPCAT to the amount. Example: 0.00001BTC, 1SPACE, 0.01DOGE, or 10OPCAT.');
        }
        throw new Error(`Unsupported currency unit in "${raw}". Supported units: BTC, SPACE, DOGE, OPCAT.`);
    }
    const amount = parseFloat(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`Invalid amount "${match[1]}". Must be a positive number.`);
    }
    const unit = match[2].toUpperCase();
    const chain = unit === 'BTC' ? 'btc' : unit === 'DOGE' ? 'doge' : unit === 'OPCAT' ? 'opcat' : 'mvc';
    const adapter = adapters.get(chain);
    if (!adapter) {
        throw new Error(`No adapter registered for chain "${chain}".`);
    }
    return {
        chain,
        currency: unit,
        satoshis: Math.round(amount * 1e8),
        adapter,
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
    'a2a.simplemsgListenerEnabled',
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
        || key === 'askMaster.enabled'
        || key === 'a2a.simplemsgListenerEnabled';
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
    if (key === 'a2a.simplemsgListenerEnabled') {
        return config.a2a.simplemsgListenerEnabled;
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
    if (key === 'a2a.simplemsgListenerEnabled') {
        return {
            ...config,
            a2a: {
                ...config.a2a,
                simplemsgListenerEnabled: value === true,
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
        fakeBuyerRatingReply: normalizeEnvText(env[TEST_FAKE_BUYER_RATING_REPLY_ENV]),
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
async function readInjectedRemoteServicesPrompt(context) {
    try {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const cache = await (0, onlineServiceCache_1.createOnlineServiceCacheStore)(homeDir).read();
        const services = cache.services
            .filter((service) => service.available && service.online)
            .slice(0, 20);
        return (0, remoteCall_1.buildRemoteServicesPrompt)(services);
    }
    catch {
        return null;
    }
}
async function renderSkillContractWithOnlineServiceContext(input) {
    const rendered = (0, skillResolver_1.renderResolvedSkillContract)({
        skillName: input.skill,
        host: input.host,
        format: input.format,
        evolutionNetworkEnabled: input.evolutionNetworkEnabled,
        activeVariant: input.activeVariant,
        activeVariantSource: input.activeVariantSource,
    });
    const remoteServicesPrompt = await readInjectedRemoteServicesPrompt(input.context);
    if (!remoteServicesPrompt) {
        return rendered;
    }
    if (rendered.format === 'markdown') {
        return {
            ...rendered,
            markdown: `${rendered.markdown}\n\n## Available Remote Services\n${remoteServicesPrompt}`,
        };
    }
    return {
        ...rendered,
        contract: {
            ...rendered.contract,
            instructions: `${rendered.contract.instructions}\n\n${remoteServicesPrompt}`,
        },
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
    const adapters = (0, registry_1.createDefaultChainAdapterRegistry)();
    const baseSigner = (0, localMnemonicSigner_1.createLocalMnemonicSigner)({ secretStore, adapters });
    if (context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1') {
        return createTestChainWriteSigner(baseSigner);
    }
    return baseSigner;
}
function createPrivateChatAutoReplyProfileDispatcher(input) {
    const orchestrators = new Map();
    const createOrchestrator = input.createOrchestrator ?? privateChatAutoReply_1.createPrivateChatAutoReplyOrchestrator;
    function getOrCreateOrchestrator(profile) {
        const profileHomeDir = normalizeEnvText(profile.homeDir);
        if (!profileHomeDir)
            return null;
        const cacheKey = node_path_1.default.resolve(profileHomeDir);
        const existing = orchestrators.get(cacheKey);
        if (existing)
            return existing;
        const profilePaths = (0, paths_1.resolveMetabotPaths)(profileHomeDir);
        const profileRuntimeStore = (0, runtimeStateStore_1.createRuntimeStateStore)(profilePaths);
        const profileSigner = input.createSignerForHome
            ? input.createSignerForHome(profileHomeDir)
            : (0, localMnemonicSigner_1.createLocalMnemonicSigner)({
                secretStore: (0, fileSecretStore_1.createFileSecretStore)(profileHomeDir),
                adapters: (0, registry_1.createDefaultChainAdapterRegistry)(),
            });
        const profileRuntimeStoreForLlm = (0, llmRuntimeStore_1.createLlmRuntimeStore)(profilePaths);
        const profileBindingStore = (0, llmBindingStore_1.createLlmBindingStore)(profilePaths);
        const profileRuntimeResolver = (0, llmRuntimeResolver_1.createLlmRuntimeResolver)({
            runtimeStore: profileRuntimeStoreForLlm,
            bindingStore: profileBindingStore,
            getPreferredRuntimeId: async () => {
                try {
                    const raw = await node_fs_1.default.promises.readFile(profilePaths.preferredLlmRuntimePath, 'utf8');
                    const data = JSON.parse(raw);
                    return typeof data.runtimeId === 'string' ? data.runtimeId : null;
                }
                catch {
                    return null;
                }
            },
        });
        const metaBotSlug = node_path_1.default.basename(profilePaths.profileRoot);
        const replyRunner = input.createReplyRunnerForProfile
            ? input.createReplyRunnerForProfile({
                paths: profilePaths,
                metaBotSlug,
                runtimeResolver: profileRuntimeResolver,
                llmExecutor: input.llmExecutor,
            })
            : (0, hostLlmChatReplyRunner_1.createHostLlmChatReplyRunner)({
                runtimeResolver: profileRuntimeResolver,
                llmExecutor: input.llmExecutor,
                metaBotSlug,
            });
        const profileGlobalMetaId = normalizeEnvText(profile.globalMetaId);
        const orchestrator = createOrchestrator({
            stateStore: (0, privateChatStateStore_1.createPrivateChatStateStore)(profilePaths),
            strategyStore: (0, chatStrategyStore_1.createChatStrategyStore)(profilePaths),
            paths: profilePaths,
            signer: profileSigner,
            selfGlobalMetaId: async () => {
                const state = await profileRuntimeStore.readState().catch(() => null);
                return (state?.identity?.globalMetaId ?? profileGlobalMetaId) || null;
            },
            resolvePeerChatPublicKey: input.resolvePeerChatPublicKey,
            replyRunner,
        }, input.autoReplyConfig);
        orchestrators.set(cacheKey, orchestrator);
        return orchestrator;
    }
    return {
        async handleInboundMessage(profile, message) {
            const orchestrator = getOrCreateOrchestrator(profile);
            if (!orchestrator)
                return;
            await orchestrator.handleInboundMessage(message);
        },
    };
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
function createTestBuyerRatingReplyRunner(env) {
    const raw = typeof env[TEST_FAKE_BUYER_RATING_REPLY_ENV] === 'string'
        ? env[TEST_FAKE_BUYER_RATING_REPLY_ENV].trim()
        : '';
    if (!raw) {
        return undefined;
    }
    return async () => ({
        state: 'reply',
        content: raw,
    });
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
            stop: async () => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const runtimeStore = (0, runtimeStateStore_1.createRuntimeStateStore)(homeDir);
                const daemonRecord = await runtimeStore.readDaemon();
                if (!daemonRecord || !daemonRecord.pid) {
                    return (0, commandResult_1.commandFailed)('daemon_not_running', 'No local daemon process is currently tracked.');
                }
                const pid = daemonRecord.pid;
                try {
                    process.kill(pid, 'SIGTERM');
                }
                catch (error) {
                    const code = error.code;
                    if (code !== 'ESRCH') {
                        return (0, commandResult_1.commandFailed)('daemon_stop_failed', `Failed to stop daemon process ${pid}: ${code || error}`);
                    }
                }
                await runtimeStore.clearDaemon(pid);
                return (0, commandResult_1.commandSuccess)({ pid, stopped: true });
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
                const createInput = { name: input.name };
                if (input.host) {
                    createInput.host = input.host;
                }
                return requestJson(cloneContextWithHomeDir(context, targetHomeDir), 'POST', '/api/identity/create', createInput, {
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
                const query = new URLSearchParams();
                if (input.online !== undefined) {
                    query.set('online', input.online ? 'true' : 'false');
                }
                if (typeof input.query === 'string' && input.query.trim()) {
                    query.set('query', input.query.trim());
                }
                if (input.cached === true) {
                    query.set('cached', 'true');
                }
                const suffix = query.size ? `?${query.toString()}` : '';
                return requestJson(context, 'GET', `/api/network/services${suffix}`);
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
            listPublishSkills: async () => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const runtimeStateStore = (0, runtimeStateStore_1.createRuntimeStateStore)(homeDir);
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before listing publishable skills.');
                }
                const paths = (0, paths_1.resolveMetabotPaths)(homeDir);
                const metaBotSlug = node_path_1.default.basename(paths.profileRoot);
                const catalog = (0, platformSkillCatalog_1.createPlatformSkillCatalog)({
                    runtimeStore: (0, llmRuntimeStore_1.createLlmRuntimeStore)(paths),
                    bindingStore: (0, llmBindingStore_1.createLlmBindingStore)(paths),
                    systemHomeDir: paths.systemHomeDir,
                    projectRoot: paths.profileRoot,
                    env: context.env,
                });
                const result = await catalog.listPrimaryRuntimeSkills({ metaBotSlug });
                if (!result.ok) {
                    return (0, commandResult_1.commandFailed)(result.code, result.message);
                }
                return (0, commandResult_1.commandSuccess)({
                    metaBotSlug,
                    identity: {
                        metabotId: state.identity.metabotId,
                        name: state.identity.name,
                        globalMetaId: state.identity.globalMetaId,
                    },
                    runtime: {
                        id: result.runtime.id,
                        provider: result.runtime.provider,
                        displayName: result.runtime.displayName,
                        health: result.runtime.health,
                        version: result.runtime.version,
                        logoPath: result.runtime.logoPath,
                    },
                    platform: result.platform,
                    skills: result.skills,
                    rootDiagnostics: result.rootDiagnostics,
                });
            },
            call: async (input) => requestJson(context, 'POST', '/api/services/call', input),
            rate: async (input) => requestJson(context, 'POST', '/api/services/rate', input),
        },
        provider: {
            inspectOrder: async (input) => {
                const query = new URLSearchParams();
                if (input.orderId) {
                    query.set('orderId', input.orderId);
                }
                if (input.paymentTxid) {
                    query.set('paymentTxid', input.paymentTxid);
                }
                const suffix = query.size ? `?${query.toString()}` : '';
                return requestJson(context, 'GET', `/api/provider/order${suffix}`);
            },
            settleRefund: async (input) => requestJson(context, 'POST', '/api/provider/refund/settle', input),
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
                const adapters = (0, registry_1.createDefaultChainAdapterRegistry)();
                const allChains = Array.from(adapters.keys());
                const targetChains = input.chain === 'all'
                    ? allChains
                    : [input.chain];
                // Validate all chains are registered
                for (const chain of targetChains) {
                    if (!adapters.has(chain)) {
                        return (0, commandResult_1.commandFailed)('invalid_flag', `Unsupported --chain value: ${chain}. Supported values: all, ${Array.from(adapters.keys()).join(', ')}.`);
                    }
                }
                try {
                    const balances = {};
                    for (const chain of targetChains) {
                        const adapter = adapters.get(chain);
                        const address = state.identity.addresses[chain] ?? state.identity.mvcAddress;
                        if (!address) {
                            return (0, commandResult_1.commandFailed)('identity_address_missing', `Current identity has no address for chain "${chain}".`);
                        }
                        const balance = await adapter.fetchBalance(address);
                        balances[chain] = balance;
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
            transfer: async (input) => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const runtimeStateStore = (0, runtimeStateStore_1.createRuntimeStateStore)(homeDir);
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'No local MetaBot identity is loaded for the current active home.');
                }
                const adapters = (0, registry_1.createDefaultChainAdapterRegistry)();
                let parsed;
                try {
                    parsed = parseTransferAmount(input.amountRaw, adapters);
                }
                catch (error) {
                    return (0, commandResult_1.commandFailed)('invalid_argument', error instanceof Error ? error.message : String(error));
                }
                const adapter = parsed.adapter;
                const minSatoshis = adapter.minTransferSatoshis;
                if (parsed.satoshis < minSatoshis) {
                    return (0, commandResult_1.commandFailed)('invalid_argument', `Amount is below the minimum of ${minSatoshis} satoshis for ${parsed.currency}.`);
                }
                const fromAddress = state.identity.addresses[parsed.chain] ?? state.identity.mvcAddress;
                if (!fromAddress) {
                    return (0, commandResult_1.commandFailed)('identity_address_missing', `Current identity has no address for chain "${parsed.chain}".`);
                }
                const feeRate = await adapter.fetchFeeRate();
                // Rough fee estimate: ~392 bytes * feeRate for sat/byte chains, adjusted for sat/KB chains
                const feePerByte = adapter.feeRateUnit === 'sat/KB' ? feeRate / 1000 : feeRate;
                const estimatedFeeSatoshis = Math.ceil(392 * feePerByte);
                const totalRequired = parsed.satoshis + estimatedFeeSatoshis;
                const balance = await adapter.fetchBalance(fromAddress);
                if (balance.totalSatoshis < totalRequired) {
                    const balanceDisplay = `${balance.totalSatoshis} sats (${(balance.totalSatoshis / 1e8).toFixed(8)} ${parsed.currency})`;
                    const unconfirmedNote = balance.unconfirmedSatoshis > 0
                        ? ` (includes ${balance.unconfirmedSatoshis} unconfirmed sats)`
                        : '';
                    return (0, commandResult_1.commandFailed)('insufficient_balance', `Total balance ${balanceDisplay}${unconfirmedNote} is below the required ${totalRequired} sats (${(parsed.satoshis / 1e8).toFixed(8)} ${parsed.currency} + estimated fee ${estimatedFeeSatoshis} sats).`);
                }
                if (!input.confirm) {
                    const currentBalanceDisplay = `${(balance.totalSatoshis / 1e8).toFixed(8)} ${parsed.currency}`;
                    const unconfirmedNote = balance.unconfirmedSatoshis > 0
                        ? ` (includes ${balance.unconfirmedSatoshis} unconfirmed sats)`
                        : '';
                    return (0, commandResult_1.commandAwaitingConfirmation)({
                        fromAddress,
                        currentBalance: currentBalanceDisplay + unconfirmedNote,
                        currentBalanceSatoshis: balance.totalSatoshis,
                        toAddress: input.toAddress,
                        amount: `${(parsed.satoshis / 1e8).toFixed(8)} ${parsed.currency}`,
                        amountSatoshis: parsed.satoshis,
                        estimatedFee: `${(estimatedFeeSatoshis / 1e8).toFixed(8)} ${parsed.currency}`,
                        estimatedFeeSatoshis,
                        feeRateSatPerVb: feeRate,
                        currency: parsed.currency,
                        chain: parsed.chain,
                    });
                }
                const secretStore = (0, fileSecretStore_1.createFileSecretStore)(homeDir);
                const secrets = await secretStore.readIdentitySecrets();
                if (!secrets?.mnemonic) {
                    return (0, commandResult_1.commandFailed)('identity_secrets_missing', 'Identity mnemonic not found in the secret store.');
                }
                try {
                    const result = await (0, localMnemonicSigner_1.executeTransfer)(adapter, {
                        mnemonic: secrets.mnemonic,
                        path: secrets.path ?? state.identity.path ?? "m/44'/10001'/0'/0/0",
                        toAddress: input.toAddress,
                        amountSatoshis: parsed.satoshis,
                        feeRate,
                    });
                    const explorerUrl = `${adapter.explorerBaseUrl}/tx/${result.txid}`;
                    return (0, commandResult_1.commandSuccess)({
                        txid: result.txid,
                        explorerUrl,
                        amount: `${(parsed.satoshis / 1e8).toFixed(8)} ${parsed.currency}`,
                        toAddress: input.toAddress,
                    });
                }
                catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    const lower = msg.toLowerCase();
                    if (lower.includes('insufficient') || lower.includes('not enough') || lower.includes('余额不足')) {
                        return (0, commandResult_1.commandFailed)('insufficient_balance', `Balance is insufficient: ${msg}`);
                    }
                    return (0, commandResult_1.commandFailed)('transfer_broadcast_failed', `Transfer failed: ${msg}. Verify the recipient address is correct and that you have enough total balance to cover the amount plus fees. If UTXO inputs appear stale, wait a few seconds and retry.`);
                }
            },
        },
        trace: {
            get: async (input) => input.sessionId
                ? requestJson(context, 'GET', `/api/trace/sessions/${encodeURIComponent(input.sessionId)}`)
                : requestJson(context, 'GET', `/api/trace/${encodeURIComponent(input.traceId || '')}`),
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
                const rendered = await renderSkillContractWithOnlineServiceContext({
                    context,
                    skill: input.skill,
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
        system: {
            update: async (input) => {
                try {
                    const result = await (0, update_1.runSystemUpdate)({
                        systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
                        host: input.host,
                        version: input.version,
                        dryRun: input.dryRun,
                        env: context.env,
                    });
                    return (0, commandResult_1.commandSuccess)(result);
                }
                catch (error) {
                    if (error && typeof error === 'object' && 'code' in error) {
                        const coded = error;
                        if (coded.manualActionRequired) {
                            return (0, commandResult_1.commandManualActionRequired)(coded.code, coded.message || 'Manual action required.');
                        }
                        return (0, commandResult_1.commandFailed)(coded.code, coded.message || 'System update failed.');
                    }
                    return (0, commandResult_1.commandFailed)('system_update_failed', error instanceof Error ? error.message : String(error));
                }
            },
            uninstall: async (input) => {
                try {
                    const result = await (0, uninstall_1.runSystemUninstall)({
                        systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
                        all: input.all,
                        confirmToken: input.confirmToken,
                        env: context.env,
                    });
                    return (0, commandResult_1.commandSuccess)(result);
                }
                catch (error) {
                    if (error && typeof error === 'object' && 'code' in error) {
                        const coded = error;
                        if (coded.manualActionRequired) {
                            return (0, commandResult_1.commandManualActionRequired)(coded.code, coded.message || 'Manual action required.');
                        }
                        return (0, commandResult_1.commandFailed)(coded.code, coded.message || 'System uninstall failed.');
                    }
                    return (0, commandResult_1.commandFailed)('system_uninstall_failed', error instanceof Error ? error.message : String(error));
                }
            },
        },
        llm: {
            listRuntimes: async () => requestJson(context, 'GET', '/api/llm/runtimes'),
            discoverRuntimes: async () => requestJson(context, 'POST', '/api/llm/runtimes/discover'),
            listBindings: async (input) => requestJson(context, 'GET', `/api/llm/bindings/${encodeURIComponent(input.slug)}`),
            upsertBindings: async (input) => requestJson(context, 'PUT', `/api/llm/bindings/${encodeURIComponent(input.slug)}`, { bindings: input.bindings }),
            removeBinding: async (input) => requestJson(context, 'DELETE', `/api/llm/bindings/${encodeURIComponent(input.bindingId)}/delete`),
            getPreferredRuntime: async (input) => requestJson(context, 'GET', `/api/llm/preferred-runtime/${encodeURIComponent(input.slug)}`),
            setPreferredRuntime: async (input) => requestJson(context, 'PUT', `/api/llm/preferred-runtime/${encodeURIComponent(input.slug)}`, { runtimeId: input.runtimeId }),
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
        provider: { ...defaults.provider, ...provided.provider },
        chat: { ...defaults.chat, ...provided.chat },
        file: { ...defaults.file, ...provided.file },
        wallet: { ...defaults.wallet, ...provided.wallet },
        trace: { ...defaults.trace, ...provided.trace },
        ui: { ...defaults.ui, ...provided.ui },
        skills: { ...defaults.skills, ...provided.skills },
        host: { ...defaults.host, ...provided.host },
        system: { ...defaults.system, ...provided.system },
        llm: { ...defaults.llm, ...provided.llm },
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
    const adapters = (0, registry_1.createDefaultChainAdapterRegistry)();
    const baseSigner = (0, localMnemonicSigner_1.createLocalMnemonicSigner)({ secretStore, adapters });
    const signer = context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
        ? createTestChainWriteSigner(baseSigner)
        : baseSigner;
    const requestMvcGasSubsidy = context.env[TEST_FAKE_SUBSIDY_ENV] === '1'
        ? createTestSubsidyRequester()
        : undefined;
    const fetchPeerChatPublicKey = createTestProviderChatPublicKeyFetcher(context.env);
    const callerReplyWaiter = createTestMetaWebReplyWaiter(context.env);
    const buyerRatingReplyRunner = createTestBuyerRatingReplyRunner(context.env) ?? (0, hostLlmChatReplyRunner_1.createHostLlmChatReplyRunner)();
    const masterReplyWaiter = createTestMasterReplyWaiter(context.env) ?? (0, metawebMasterReplyWaiter_1.createSocketIoMetaWebMasterReplyWaiter)();
    const servicePaymentExecutor = context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
        ? (0, servicePayment_1.createTestServicePaymentExecutor)()
        : undefined;
    const socketPresenceApiBaseUrl = context.env.METABOT_SOCKET_PRESENCE_API_BASE_URL
        || (context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1' ? 'http://127.0.0.1:9' : undefined);
    const sharedAutoReplyConfig = {
        enabled: true,
        acceptPolicy: 'accept_all',
        defaultStrategyId: null,
    };
    const providerLlmBackends = (0, executor_1.createRegistryBackendFactories)();
    const fakeProviderLlmReply = normalizeEnvText(context.env[TEST_FAKE_PROVIDER_LLM_REPLY_ENV]);
    const useFakeProviderLlm = context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1' && Boolean(fakeProviderLlmReply);
    if (useFakeProviderLlm) {
        for (const provider of Object.keys(providerLlmBackends)) {
            providerLlmBackends[provider] = () => ({
                provider,
                async execute(request) {
                    return {
                        status: 'completed',
                        output: fakeProviderLlmReply
                            .replace(/\{\{prompt\}\}/g, request.prompt)
                            .replace(/\{\{skill\}\}/g, request.skills?.[0] ?? ''),
                        durationMs: 1,
                    };
                },
            });
        }
    }
    const llmExecutor = new executor_1.LlmExecutor({
        sessionsRoot: paths.llmExecutorSessionsRoot,
        transcriptsRoot: paths.llmExecutorTranscriptsRoot,
        skillsRoot: paths.skillsRoot,
        backends: providerLlmBackends,
    });
    const handlers = (0, defaultHandlers_1.createDefaultMetabotDaemonHandlers)({
        homeDir,
        systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
        getDaemonRecord: () => daemonRecord,
        secretStore,
        signer,
        adapters,
        chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
        socketPresenceApiBaseUrl,
        socketPresenceFailureMode: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
            ? 'assume_service_providers_online'
            : 'throw',
        identitySyncStepDelayMs: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1' ? 0 : undefined,
        fetchPeerChatPublicKey,
        callerReplyWaiter,
        buyerRatingReplyRunner,
        masterReplyWaiter,
        servicePaymentExecutor,
        requestMvcGasSubsidy,
        autoReplyConfig: sharedAutoReplyConfig,
        llmExecutor,
        providerRuntimeCanStart: useFakeProviderLlm ? async () => true : undefined,
    });
    const daemon = (0, daemon_1.createMetabotDaemon)({
        homeDirOrPaths: paths,
        handlers,
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
    const onlineServiceCacheStore = (0, onlineServiceCache_1.createOnlineServiceCacheStore)(paths);
    const ratingDetailStateStore = (0, ratingDetailState_1.createRatingDetailStateStore)(paths);
    const refreshOnlineServiceCache = async () => {
        await (0, onlineServiceCacheSync_1.refreshOnlineServiceCacheFromChain)({
            store: onlineServiceCacheStore,
            ratingDetailStateStore,
            chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
            socketPresenceApiBaseUrl,
            socketPresenceFailureMode: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
                ? 'assume_service_providers_online'
                : 'throw',
            resolvePeerChatPublicKey: fetchPeerChatPublicKey
                ?? ((globalMetaId) => (0, defaultHandlers_1.fetchPeerChatPublicKey)(globalMetaId, {
                    chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
                })),
        });
    };
    void refreshOnlineServiceCache().catch((error) => {
        console.warn('[online service cache] initial refresh failed:', error instanceof Error ? error.message : String(error));
    });
    const onlineServiceCacheInterval = setInterval(() => {
        void refreshOnlineServiceCache().catch((error) => {
            console.warn('[online service cache] periodic refresh failed:', error instanceof Error ? error.message : String(error));
        });
    }, onlineServiceCache_1.DEFAULT_ONLINE_SERVICE_CACHE_SYNC_INTERVAL_MS);
    onlineServiceCacheInterval.unref?.();
    // ---- LLM runtime discovery and resolver ----
    const llmRuntimeStore = (0, llmRuntimeStore_1.createLlmRuntimeStore)(paths);
    const llmBindingStore = (0, llmBindingStore_1.createLlmBindingStore)(paths);
    const llmResolver = (0, llmRuntimeResolver_1.createLlmRuntimeResolver)({
        runtimeStore: llmRuntimeStore,
        bindingStore: llmBindingStore,
        getPreferredRuntimeId: async (_slug) => {
            try {
                const raw = await node_fs_1.default.promises.readFile(paths.preferredLlmRuntimePath, 'utf8');
                const data = JSON.parse(raw);
                return typeof data.runtimeId === 'string' ? data.runtimeId : null;
            }
            catch {
                return null;
            }
        },
    });
    // Discover LLM runtimes in background (non-blocking).
    const metaBotSlug = node_path_1.default.basename(paths.profileRoot);
    void (0, llmRuntimeDiscovery_1.discoverLlmRuntimes)({ env: context.env }).then(async (result) => {
        for (const runtime of result.runtimes) {
            await llmRuntimeStore.upsertRuntime(runtime).catch(() => { });
        }
    });
    const chatStateStore = (0, privateChatStateStore_1.createPrivateChatStateStore)(paths);
    const chatStrategyStore = (0, chatStrategyStore_1.createChatStrategyStore)(paths);
    const resolvePeerChatPublicKeyForChat = fetchPeerChatPublicKey ?? defaultHandlers_1.fetchPeerChatPublicKey;
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
        replyRunner: (0, hostLlmChatReplyRunner_1.createHostLlmChatReplyRunner)({
            runtimeResolver: llmResolver,
            llmExecutor,
            metaBotSlug,
        }),
    }, sharedAutoReplyConfig);
    const chatAutoReplyBackfill = (0, privateChatAutoReplyBackfill_1.createPrivateChatAutoReplyBackfillLoop)({
        paths,
        stateStore: chatStateStore,
        selfGlobalMetaId: async () => {
            const state = await runtimeStore.readState();
            return state.identity?.globalMetaId ?? null;
        },
        getLocalPrivateChatIdentity: async () => signer.getPrivateChatIdentity(),
        resolvePeerChatPublicKey: resolvePeerChatPublicKeyForChat,
        handleInboundMessage: async (message) => chatAutoReplyOrchestrator.handleInboundMessage(message),
        onError: (error) => {
            console.warn('[private chat auto-reply backfill]', error.message);
        },
    });
    const profileAutoReplyDispatcher = createPrivateChatAutoReplyProfileDispatcher({
        autoReplyConfig: sharedAutoReplyConfig,
        resolvePeerChatPublicKey: resolvePeerChatPublicKeyForChat,
        llmExecutor,
    });
    const daemonConfig = await (0, configStore_1.createConfigStore)(paths).read();
    const simplemsgInboundDispatcher = buildA2ASimplemsgInboundDispatcher({
        handleOrderProtocolMessage: handlers.services?.handleInboundOrderProtocolMessage,
        handleGenericPrivateChatMessage: async (message) => {
            await chatAutoReplyOrchestrator.handleInboundMessage(message);
        },
        logWarning: (scope, error) => {
            console.warn(scope, error instanceof Error ? error.message : String(error));
        },
    });
    const simplemsgListener = (0, simplemsgListener_1.createA2ASimplemsgListenerManager)({
        systemHomeDir: paths.systemHomeDir,
        resolvePeerChatPublicKey: resolvePeerChatPublicKeyForChat,
        onMessage: (profile, message) => {
            if (node_path_1.default.resolve(profile.homeDir) === node_path_1.default.resolve(homeDir)) {
                void simplemsgInboundDispatcher(message).catch((error) => {
                    console.warn('[private chat auto-reply]', error instanceof Error ? error.message : String(error));
                });
                return;
            }
            void profileAutoReplyDispatcher.handleInboundMessage(profile, message).catch((error) => {
                console.warn('[private chat auto-reply]', error instanceof Error ? error.message : String(error));
            });
        },
        onError: (error) => {
            console.warn('[A2A simplemsg listener]', error.message);
        },
    });
    if (daemonConfig.a2a.simplemsgListenerEnabled) {
        await simplemsgListener.start();
        chatAutoReplyBackfill.start();
    }
    let shuttingDown = false;
    const shutdown = async (exitCode) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        simplemsgListener.stop();
        chatAutoReplyBackfill.stop();
        providerHeartbeatLoop.stop();
        clearInterval(onlineServiceCacheInterval);
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
