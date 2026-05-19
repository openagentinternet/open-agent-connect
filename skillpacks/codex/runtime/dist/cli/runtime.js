"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOOM_DEV_ROUND_LLM_TIMEOUT_MS = exports.LOOM_DRAFT_LLM_TIMEOUT_MS = void 0;
exports.buildA2ASimplemsgInboundDispatcher = buildA2ASimplemsgInboundDispatcher;
exports.getDefaultDaemonPort = getDefaultDaemonPort;
exports.getDaemonRuntimeFingerprint = getDaemonRuntimeFingerprint;
exports.buildDaemonConfigHash = buildDaemonConfigHash;
exports.replayUnhandledA2AOrderMessagesForProfiles = replayUnhandledA2AOrderMessagesForProfiles;
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
const configTypes_1 = require("../core/config/configTypes");
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
const loom_1 = require("../core/loom");
const daemon_1 = require("../daemon");
const defaultHandlers_1 = require("../daemon/defaultHandlers");
const simplemsgListener_1 = require("../core/a2a/simplemsgListener");
const simplemsgPresenceWatchdog_1 = require("../core/a2a/simplemsgPresenceWatchdog");
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
const llmRuntimeExecution_1 = require("../core/llm/llmRuntimeExecution");
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
exports.LOOM_DRAFT_LLM_TIMEOUT_MS = 120_000;
exports.LOOM_DEV_ROUND_LLM_TIMEOUT_MS = 900_000;
const LOOM_DRAFT_LLM_POLL_INTERVAL_MS = 500;
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
async function listLocalLoomWorkflowsForTask(paths, taskPinId) {
    const workflowStore = (0, loom_1.createLoomWorkflowStore)(paths);
    const taskWorkflowDir = node_path_1.default.dirname(workflowStore.resolve(taskPinId, 'claim').workflowPath);
    let entries;
    try {
        entries = await node_fs_1.default.promises.readdir(taskWorkflowDir, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const workflows = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            continue;
        }
        const claimPinId = node_path_1.default.basename(entry.name, '.json');
        const workflow = await workflowStore.read(taskPinId, claimPinId);
        if (workflow) {
            workflows.push(workflow);
        }
    }
    return workflows.sort((left, right) => left.claimPinId.localeCompare(right.claimPinId));
}
async function listLocalLoomWorkflowsForRawCache(paths, rawState) {
    const taskPinIds = Array.from(new Set(rawState.records.task.map((record) => record.pinId)));
    const workflows = [];
    for (const taskPinId of taskPinIds) {
        workflows.push(...(await listLocalLoomWorkflowsForTask(paths, taskPinId)));
    }
    return workflows.sort((left, right) => {
        const taskOrder = left.taskPinId.localeCompare(right.taskPinId);
        return taskOrder || left.claimPinId.localeCompare(right.claimPinId);
    });
}
async function refreshLoomRawState(context, cacheStore) {
    const syncResult = await (0, loom_1.readLoomRawChainRecords)({
        chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
    });
    return cacheStore.update(syncResult.records);
}
function loomRefreshFailure(error) {
    const cause = error instanceof Error ? error.message : String(error);
    return (0, commandResult_1.commandFailed)('loom_refresh_failed', 'Loom chain data could not be refreshed before a confirmed payment. Run metabot loom sync and retry after the chain index is reachable.', {
        data: {
            syncCommand: 'metabot loom sync',
            cause,
        },
    });
}
async function readFreshLoomRawState(context, cacheStore) {
    try {
        return await refreshLoomRawState(context, cacheStore);
    }
    catch {
        return cacheStore.read();
    }
}
async function requireFreshLoomRawState(context, cacheStore) {
    try {
        return (0, commandResult_1.commandSuccess)(await refreshLoomRawState(context, cacheStore));
    }
    catch (error) {
        return loomRefreshFailure(error);
    }
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
    'chain.defaultWriteNetwork',
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
    if (key === 'chain.defaultWriteNetwork') {
        return config.chain.defaultWriteNetwork;
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
    if (key === 'chain.defaultWriteNetwork') {
        return {
            ...config,
            chain: {
                ...config.chain,
                defaultWriteNetwork: value,
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
    if (input.key === 'chain.defaultWriteNetwork') {
        const value = typeof input.value === 'string' ? input.value.trim().toLowerCase() : '';
        if (!configTypes_1.DEFAULT_WRITE_NETWORKS.includes(value)) {
            return {
                ok: false,
                message: `Config value for chain.defaultWriteNetwork must be one of ${configTypes_1.DEFAULT_WRITE_NETWORKS.join(', ')}.`,
            };
        }
        return {
            ok: true,
            value: value,
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
async function resolveActorHomeDir(context, from) {
    const requestedFrom = normalizeEnvText(from);
    if (!requestedFrom) {
        return { homeDir: normalizeHomeDir(context.env, context.cwd) };
    }
    const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
    const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir).catch(() => []);
    const resolved = (0, profileNameResolution_1.resolveProfileNameMatch)(requestedFrom, profiles);
    if (resolved.status === 'not_found') {
        return (0, commandResult_1.commandFailed)('profile_not_found', resolved.message);
    }
    if (resolved.status === 'ambiguous') {
        return (0, commandResult_1.commandFailed)('identity_profile_ambiguous', resolved.message);
    }
    return { homeDir: resolved.match.homeDir };
}
function normalizeReadOnlyIdentityProfile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const name = normalizeEnvText(record.name);
    const slug = normalizeEnvText(record.slug);
    const homeDir = normalizeEnvText(record.homeDir);
    const globalMetaId = normalizeEnvText(record.globalMetaId);
    if (!name || !slug || !homeDir) {
        return null;
    }
    return {
        name,
        slug,
        aliases: Array.isArray(record.aliases)
            ? record.aliases.map((alias) => normalizeEnvText(alias)).filter(Boolean)
            : [],
        homeDir: node_path_1.default.resolve(homeDir),
        globalMetaId,
        mvcAddress: normalizeEnvText(record.mvcAddress),
        createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
            ? record.createdAt
            : 0,
        updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
            ? record.updatedAt
            : 0,
    };
}
async function readIdentityProfilesReadonly(systemHomeDir) {
    const layout = (0, homeSelection_1.resolveMetabotManagerLayout)(systemHomeDir);
    let raw;
    try {
        raw = await node_fs_1.default.promises.readFile(layout.identityProfilesPath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return [];
    }
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    const profiles = Array.isArray(record.profiles) ? record.profiles : [];
    return profiles
        .map(normalizeReadOnlyIdentityProfile)
        .filter((profile) => Boolean(profile));
}
async function readActiveHomeReadonly(systemHomeDir) {
    const layout = (0, homeSelection_1.resolveMetabotManagerLayout)(systemHomeDir);
    let raw;
    try {
        raw = await node_fs_1.default.promises.readFile(layout.activeHomePath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
    try {
        const parsed = JSON.parse(raw);
        const homeDir = typeof parsed.homeDir === 'string' ? normalizeEnvText(parsed.homeDir) : '';
        return homeDir ? node_path_1.default.resolve(homeDir) : null;
    }
    catch {
        return null;
    }
}
async function resolveActorProfileReadonly(context, from) {
    const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
    const profiles = await readIdentityProfilesReadonly(systemHomeDir);
    const requestedFrom = normalizeEnvText(from);
    let profile;
    if (requestedFrom) {
        const resolved = (0, profileNameResolution_1.resolveProfileNameMatch)(requestedFrom, profiles);
        if (resolved.status === 'not_found') {
            return (0, commandResult_1.commandFailed)('profile_not_found', resolved.message);
        }
        if (resolved.status === 'ambiguous') {
            return (0, commandResult_1.commandFailed)('identity_profile_ambiguous', resolved.message);
        }
        profile = resolved.match;
    }
    else {
        const explicitHome = normalizeEnvText(context.env.METABOT_HOME);
        const selectedHome = explicitHome ? node_path_1.default.resolve(explicitHome) : await readActiveHomeReadonly(systemHomeDir);
        if (!selectedHome) {
            return (0, commandResult_1.commandFailed)('profile_not_found', 'No active MetaBot profile found for dry-run delivery.');
        }
        profile = profiles.find((entry) => node_path_1.default.resolve(entry.homeDir) === selectedHome);
        if (!profile) {
            return (0, commandResult_1.commandFailed)('profile_not_found', `MetaBot profile not found in the manager index for home: ${selectedHome}`);
        }
    }
    if (!profile.globalMetaId) {
        return (0, commandResult_1.commandFailed)('identity_unavailable', `MetaBot profile ${profile.slug} does not have a globalMetaId in the manager index. Initialize or sync the profile identity before dry-run delivery.`);
    }
    return {
        homeDir: profile.homeDir,
        profile,
    };
}
async function resolveActorProfileSlug(context, input = {}) {
    const requestedSelector = normalizeEnvText(input.from) || normalizeEnvText(input.slug);
    const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
    if (requestedSelector) {
        return { slug: requestedSelector };
    }
    const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir).catch(() => []);
    const activeHomeDir = node_path_1.default.resolve(normalizeHomeDir(context.env, context.cwd));
    const activeProfile = profiles.find((profile) => node_path_1.default.resolve(profile.homeDir) === activeHomeDir);
    if (!activeProfile?.slug) {
        return (0, commandResult_1.commandFailed)('profile_not_found', `Active MetaBot profile not found in the manager index for home: ${activeHomeDir}`);
    }
    return { slug: activeProfile.slug };
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
function resolveRuntimeInputPath(context, filePath) {
    return node_path_1.default.isAbsolute(filePath) ? filePath : node_path_1.default.resolve(context.cwd, filePath);
}
async function readJsonObjectFile(context, filePath) {
    const raw = await context.readTextFile(resolveRuntimeInputPath(context, filePath));
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('payload file must contain a JSON object.');
    }
    return parsed;
}
async function readPreferredLlmRuntimeId(paths) {
    try {
        const raw = await node_fs_1.default.promises.readFile(paths.preferredLlmRuntimePath, 'utf8');
        const data = JSON.parse(raw);
        return typeof data.runtimeId === 'string' ? data.runtimeId : null;
    }
    catch {
        return null;
    }
}
async function refreshLlmRuntimeStoreFromDiscovery(runtimeStore, env) {
    const [previous, result] = await Promise.all([
        runtimeStore.read(),
        (0, llmRuntimeDiscovery_1.discoverLlmRuntimes)({ env }),
    ]);
    const discoveredRuntimeIds = new Set(result.runtimes.map((runtime) => runtime.id));
    for (const runtime of result.runtimes) {
        await runtimeStore.upsertRuntime(runtime);
    }
    for (const runtime of previous.runtimes) {
        if (runtime.provider === 'custom')
            continue;
        if (!discoveredRuntimeIds.has(runtime.id) && runtime.health !== 'unavailable') {
            await runtimeStore.updateHealth(runtime.id, 'unavailable');
        }
    }
}
function createCliLlmRuntimeResolver(paths) {
    return (0, llmRuntimeResolver_1.createLlmRuntimeResolver)({
        runtimeStore: (0, llmRuntimeStore_1.createLlmRuntimeStore)(paths),
        bindingStore: (0, llmBindingStore_1.createLlmBindingStore)(paths),
        getPreferredRuntimeId: async () => readPreferredLlmRuntimeId(paths),
    });
}
async function draftLoomTaskFromWish(context, input) {
    const actor = await resolveActorHomeDir(context, input.from);
    if (!('homeDir' in actor))
        return actor;
    const paths = (0, paths_1.resolveMetabotPaths)(actor.homeDir);
    const metaBotSlug = node_path_1.default.basename(paths.profileRoot);
    const runtimeStore = (0, llmRuntimeStore_1.createLlmRuntimeStore)(paths);
    await refreshLlmRuntimeStoreFromDiscovery(runtimeStore, context.env);
    const runtimeResolver = createCliLlmRuntimeResolver(paths);
    const resolved = await runtimeResolver.resolveRuntime({ metaBotSlug });
    if (!resolved.runtime || resolved.runtime.health !== 'healthy') {
        return (0, commandResult_1.commandFailed)('llm_runtime_unavailable', `No healthy LLM runtime is available for MetaBot ${metaBotSlug}.`);
    }
    const llmExecutor = new executor_1.LlmExecutor({
        sessionsRoot: paths.llmExecutorSessionsRoot,
        transcriptsRoot: paths.llmExecutorTranscriptsRoot,
        skillsRoot: paths.skillsRoot,
        systemHomeDir: paths.systemHomeDir,
        env: context.env,
        backends: (0, executor_1.createRegistryBackendFactories)(),
    });
    try {
        return await (0, loom_1.draftLoomTask)({
            wish: input.wish,
            allowInvalid: input.allowInvalid,
            executePrompt: async ({ prompt, systemPrompt }) => {
                const sessionId = await llmExecutor.execute({
                    runtimeId: resolved.runtime.id,
                    runtime: resolved.runtime,
                    prompt,
                    systemPrompt,
                    timeout: exports.LOOM_DRAFT_LLM_TIMEOUT_MS,
                    cwd: context.cwd,
                    metaBotSlug,
                });
                const deadline = Date.now() + exports.LOOM_DRAFT_LLM_TIMEOUT_MS;
                while (Date.now() <= deadline) {
                    const session = await llmExecutor.getSession(sessionId);
                    if (session?.result) {
                        if (session.result.status === 'completed') {
                            if (resolved.bindingId) {
                                runtimeResolver.markBindingUsed(resolved.bindingId).catch(() => { });
                            }
                            return session.result.output;
                        }
                        throw new Error(session.result.error || `LLM runtime ended with status ${session.result.status}.`);
                    }
                    await sleep(LOOM_DRAFT_LLM_POLL_INTERVAL_MS);
                }
                throw new Error('LLM runtime timed out while drafting Loom task payload.');
            },
        });
    }
    catch (error) {
        await runtimeResolver.markRuntimeUnavailable(resolved.runtime.id).catch(() => { });
        return (0, commandResult_1.commandFailed)('llm_runtime_unavailable', error instanceof Error ? error.message : 'LLM runtime is unavailable.');
    }
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
function normalizeReplayText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeReplayOrderTxid(value) {
    const normalized = normalizeReplayText(value);
    const pinMatch = normalized.match(/^([0-9a-f]{64})i\d+$/iu);
    if (pinMatch) {
        return pinMatch[1].toLowerCase();
    }
    return /^[0-9a-f]{64}$/iu.test(normalized) ? normalized.toLowerCase() : '';
}
function messageOrderTxidForReplay(message) {
    return normalizeReplayOrderTxid(message.orderTxid)
        || normalizeReplayOrderTxid(message.txid)
        || normalizeReplayOrderTxid(message.pinId)
        || normalizeReplayOrderTxid(message.messageId)
        || normalizeReplayOrderTxid(message.id);
}
function extractReplayOrderLineValue(content, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = content.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+?)\\s*$`, 'imu'));
    return normalizeReplayText(match?.[1]);
}
function conversationHasServiceOrderSession(conversation, input) {
    const sessions = Array.isArray(conversation.sessions) ? conversation.sessions : [];
    const indexedOrderSession = conversation.indexes
        && typeof conversation.indexes === 'object'
        && !Array.isArray(conversation.indexes)
        ? conversation.indexes
        : null;
    const orderIndex = indexedOrderSession?.orderTxidToSessionId
        && typeof indexedOrderSession.orderTxidToSessionId === 'object'
        && !Array.isArray(indexedOrderSession.orderTxidToSessionId)
        ? indexedOrderSession.orderTxidToSessionId
        : {};
    const paymentIndex = indexedOrderSession?.paymentTxidToSessionId
        && typeof indexedOrderSession.paymentTxidToSessionId === 'object'
        && !Array.isArray(indexedOrderSession.paymentTxidToSessionId)
        ? indexedOrderSession.paymentTxidToSessionId
        : {};
    if (input.orderTxid && normalizeReplayText(orderIndex[input.orderTxid])) {
        return true;
    }
    if (input.paymentTxid && normalizeReplayText(paymentIndex[input.paymentTxid])) {
        return true;
    }
    return sessions.some((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return false;
        }
        const session = entry;
        if (normalizeReplayText(session.type) !== 'service_order') {
            return false;
        }
        return Boolean((input.orderTxid && normalizeReplayOrderTxid(session.orderTxid) === input.orderTxid)
            || (input.paymentTxid && normalizeReplayText(session.paymentTxid) === input.paymentTxid));
    });
}
async function readA2AConversationStateForReplay(filePath) {
    try {
        const parsed = JSON.parse(await node_fs_1.default.promises.readFile(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
function buildReplayOrderMessage(input) {
    const content = String(input.rawMessage.content ?? '');
    const classification = (0, simplemsgClassifier_1.classifySimplemsgContent)(content);
    if (classification.kind !== 'order_protocol' || classification.tag !== 'ORDER') {
        return null;
    }
    if (normalizeReplayText(input.rawMessage.direction) !== 'incoming') {
        return null;
    }
    const sender = input.rawMessage.sender
        && typeof input.rawMessage.sender === 'object'
        && !Array.isArray(input.rawMessage.sender)
        ? input.rawMessage.sender
        : null;
    const peer = input.conversation.peer
        && typeof input.conversation.peer === 'object'
        && !Array.isArray(input.conversation.peer)
        ? input.conversation.peer
        : null;
    const fromGlobalMetaId = normalizeReplayText(sender?.globalMetaId) || normalizeReplayText(peer?.globalMetaId);
    if (!fromGlobalMetaId) {
        return null;
    }
    const activeHomeDir = normalizeReplayText(input.activeHomeDir);
    const profileHomeDir = normalizeReplayText(input.profile.homeDir);
    const localProfileSlug = activeHomeDir && profileHomeDir && node_path_1.default.resolve(profileHomeDir) === node_path_1.default.resolve(activeHomeDir)
        ? null
        : input.profile.slug;
    const raw = input.rawMessage.raw
        && typeof input.rawMessage.raw === 'object'
        && !Array.isArray(input.rawMessage.raw)
        ? input.rawMessage.raw
        : null;
    return {
        fromGlobalMetaId,
        content,
        messagePinId: normalizeReplayText(input.rawMessage.pinId)
            || normalizeReplayText(input.rawMessage.messageId)
            || null,
        fromChatPublicKey: normalizeReplayText(sender?.chatPublicKey)
            || normalizeReplayText(peer?.chatPublicKey)
            || null,
        timestamp: Number.isFinite(input.rawMessage.timestamp)
            ? Math.trunc(Number(input.rawMessage.timestamp))
            : Date.now(),
        rawMessage: raw,
        localProfileSlug,
    };
}
async function replayUnhandledA2AOrderMessagesForProfiles(input) {
    const result = {
        profiles: 0,
        conversations: 0,
        scanned: 0,
        replayed: 0,
        skipped: 0,
        failed: 0,
    };
    const handler = input.handleOrderProtocolMessage;
    if (!handler) {
        return result;
    }
    const listProfilesForReplay = input.listProfiles ?? identityProfiles_1.listIdentityProfiles;
    const profiles = await listProfilesForReplay(input.systemHomeDir).catch((error) => {
        input.logWarning?.('[A2A order replay profiles]', error);
        return [];
    });
    const maxMessagesPerProfile = Math.max(1, Math.floor(Number(input.maxMessagesPerProfile) || 200));
    const replayedOrderKeys = new Set();
    for (const profile of profiles) {
        result.profiles += 1;
        const paths = (0, paths_1.resolveMetabotPaths)(profile.homeDir);
        let entries = [];
        try {
            entries = await node_fs_1.default.promises.readdir(paths.a2aRoot);
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                input.logWarning?.('[A2A order replay read]', error);
            }
            continue;
        }
        const candidates = [];
        for (const entry of entries) {
            if (!entry.startsWith('chat-') || !entry.endsWith('.json')) {
                continue;
            }
            const conversation = await readA2AConversationStateForReplay(node_path_1.default.join(paths.a2aRoot, entry));
            if (!conversation) {
                continue;
            }
            result.conversations += 1;
            const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
            for (const rawMessage of messages.slice(-maxMessagesPerProfile)) {
                if (!rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) {
                    continue;
                }
                const message = rawMessage;
                const content = String(message.content ?? '');
                const classification = (0, simplemsgClassifier_1.classifySimplemsgContent)(content);
                if (normalizeReplayText(message.direction) !== 'incoming'
                    || classification.kind !== 'order_protocol'
                    || classification.tag !== 'ORDER') {
                    continue;
                }
                const orderTxid = messageOrderTxidForReplay(message);
                const paymentTxid = normalizeReplayText(message.paymentTxid)
                    || extractReplayOrderLineValue(content, 'txid');
                const replayKey = orderTxid || paymentTxid || normalizeReplayText(message.messageId);
                if (!replayKey) {
                    result.skipped += 1;
                    continue;
                }
                result.scanned += 1;
                if (replayedOrderKeys.has(replayKey)
                    || conversationHasServiceOrderSession(conversation, { orderTxid, paymentTxid })) {
                    result.skipped += 1;
                    continue;
                }
                candidates.push({ conversation, message, orderTxid, paymentTxid });
                replayedOrderKeys.add(replayKey);
            }
        }
        candidates.sort((left, right) => {
            const leftTime = Number.isFinite(left.message.timestamp) ? Number(left.message.timestamp) : 0;
            const rightTime = Number.isFinite(right.message.timestamp) ? Number(right.message.timestamp) : 0;
            return leftTime - rightTime;
        });
        for (const candidate of candidates) {
            const replayMessage = buildReplayOrderMessage({
                profile,
                activeHomeDir: normalizeReplayText(input.activeHomeDir),
                conversation: candidate.conversation,
                rawMessage: candidate.message,
            });
            if (!replayMessage) {
                result.skipped += 1;
                continue;
            }
            try {
                await handler(replayMessage);
                result.replayed += 1;
            }
            catch (error) {
                result.failed += 1;
                input.logWarning?.('[A2A order replay handler]', error);
            }
        }
    }
    return result;
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
            if (!input.handleOrderProtocolMessageForProfile) {
                await orchestrator.handleInboundMessage(message);
                return;
            }
            const dispatcher = buildA2ASimplemsgInboundDispatcher({
                handleOrderProtocolMessage: async (orderMessage) => input.handleOrderProtocolMessageForProfile(profile, orderMessage),
                handleGenericPrivateChatMessage: async (genericMessage) => {
                    await orchestrator.handleInboundMessage(genericMessage);
                },
            });
            await dispatcher(message);
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
async function runWalletTransferRuntime(context, input) {
    const actor = await resolveActorHomeDir(context, input.from);
    if (!('homeDir' in actor)) {
        return actor;
    }
    const homeDir = actor.homeDir;
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
}
function createDefaultCliDependencies(context) {
    return {
        config: {
            get: async (input) => {
                if (!isSupportedConfigKey(input.key)) {
                    return (0, commandResult_1.commandFailed)('unsupported_config_key', `Unsupported config key: ${input.key}`);
                }
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor)) {
                    return actor;
                }
                const homeDir = actor.homeDir;
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
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor)) {
                    return actor;
                }
                const homeDir = actor.homeDir;
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
            trace: async (input) => {
                const params = new URLSearchParams();
                if (input.from)
                    params.set('from', input.from);
                const suffix = params.size ? `?${params.toString()}` : '';
                return requestJson(context, 'GET', `/api/master/trace/${encodeURIComponent(input.traceId)}${suffix}`);
            },
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
            listPublishSkills: async (input = {}) => {
                let homeDir = normalizeHomeDir(context.env, context.cwd);
                const requestedFrom = normalizeEnvText(input.from);
                if (requestedFrom) {
                    const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
                    const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir).catch(() => []);
                    const resolved = (0, profileNameResolution_1.resolveProfileNameMatch)(requestedFrom, profiles);
                    if (resolved.status === 'not_found') {
                        return (0, commandResult_1.commandFailed)('profile_not_found', resolved.message);
                    }
                    if (resolved.status === 'ambiguous') {
                        return (0, commandResult_1.commandFailed)('identity_profile_ambiguous', resolved.message);
                    }
                    homeDir = resolved.match.homeDir;
                }
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
            listOwned: async (input) => {
                const query = new URLSearchParams({
                    page: String(input.page),
                    pageSize: String(input.pageSize),
                    refresh: input.refresh ? 'true' : 'false',
                    all: input.all ? 'true' : 'false',
                });
                if (input.from) {
                    query.set('from', input.from);
                }
                return requestJson(context, 'GET', `/api/services/owned?${query.toString()}`);
            },
            listOwnedOrders: async (input) => {
                const query = new URLSearchParams({
                    serviceId: input.serviceId,
                    page: String(input.page),
                    pageSize: String(input.pageSize),
                    refresh: input.refresh ? 'true' : 'false',
                    all: input.all ? 'true' : 'false',
                });
                if (input.from) {
                    query.set('from', input.from);
                }
                return requestJson(context, 'GET', `/api/services/owned/orders?${query.toString()}`);
            },
            modifyOwned: async (input) => requestJson(context, 'POST', '/api/services/owned/modify', input),
            revokeOwned: async (input) => requestJson(context, 'POST', '/api/services/owned/revoke', input),
            listRefunds: async (input) => {
                const query = new URLSearchParams();
                if (input.from) {
                    query.set('from', input.from);
                }
                query.set('all', input.all ? 'true' : 'false');
                query.set('kind', input.kind);
                return requestJson(context, 'GET', `/api/services/refunds?${query.toString()}`);
            },
            settleRefund: async (input) => requestJson(context, 'POST', '/api/services/refunds/settle', input),
            inspectOrder: async (input) => {
                const query = new URLSearchParams();
                if (input.orderId) {
                    query.set('orderId', input.orderId);
                }
                if (input.paymentTxid) {
                    query.set('paymentTxid', input.paymentTxid);
                }
                if (input.from) {
                    query.set('from', input.from);
                }
                const suffix = query.size ? `?${query.toString()}` : '';
                return requestJson(context, 'GET', `/api/services/orders/inspect${suffix}`);
            },
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
                if (input.from) {
                    query.set('from', input.from);
                }
                const suffix = query.size ? `?${query.toString()}` : '';
                return requestJson(context, 'GET', `/api/services/orders/inspect${suffix}`);
            },
            settleRefund: async (input) => requestJson(context, 'POST', '/api/services/refunds/settle', input),
        },
        chat: {
            private: async (input) => requestJson(context, 'POST', '/api/chat/private', input),
            conversations: async (input = {}) => {
                const params = new URLSearchParams();
                if (input.from)
                    params.set('from', input.from);
                const suffix = params.size ? `?${params.toString()}` : '';
                return requestJson(context, 'GET', `/api/chat/private/conversations${suffix}`);
            },
            messages: async (input) => {
                const params = new URLSearchParams({ conversationId: input.conversationId });
                if (input.limit != null)
                    params.set('limit', String(input.limit));
                if (input.from)
                    params.set('from', input.from);
                return requestJson(context, 'GET', `/api/chat/private/messages?${params.toString()}`);
            },
            autoReplyStatus: async (input = {}) => {
                const params = new URLSearchParams();
                if (input.from)
                    params.set('from', input.from);
                const suffix = params.size ? `?${params.toString()}` : '';
                return requestJson(context, 'GET', `/api/chat/auto-reply/status${suffix}`);
            },
            setAutoReply: async (input) => requestJson(context, 'POST', '/api/chat/auto-reply/config', input),
        },
        file: {
            upload: async (input) => requestJson(context, 'POST', '/api/file/upload', input),
        },
        wallet: {
            balance: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor)) {
                    return actor;
                }
                const homeDir = actor.homeDir;
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
                return runWalletTransferRuntime(context, input);
            },
        },
        trace: {
            get: async (input) => {
                const query = new URLSearchParams();
                if (input.from)
                    query.set('from', input.from);
                const suffix = query.size ? `?${query.toString()}` : '';
                return input.sessionId
                    ? requestJson(context, 'GET', `/api/trace/sessions/${encodeURIComponent(input.sessionId)}${suffix}`)
                    : requestJson(context, 'GET', `/api/trace/${encodeURIComponent(input.traceId || '')}${suffix}`);
            },
            watch: async (input) => {
                const query = new URLSearchParams();
                if (input.from)
                    query.set('from', input.from);
                const suffix = query.size ? `?${query.toString()}` : '';
                return requestText(context, 'GET', `/api/trace/${encodeURIComponent(input.traceId)}/watch${suffix}`);
            },
            listSessions: async (input) => {
                const query = new URLSearchParams({
                    all: input.all ? 'true' : 'false',
                    limit: String(input.limit),
                });
                if (input.from)
                    query.set('from', input.from);
                return requestJson(context, 'GET', `/api/trace/sessions?${query.toString()}`);
            },
        },
        ui: {
            open: async (input) => {
                const baseUrl = await ensureDaemonBaseUrl(context);
                const query = new URLSearchParams();
                if (input.from)
                    query.set('from', input.from);
                if (input.traceId)
                    query.set('traceId', input.traceId);
                if (input.sessionId)
                    query.set('sessionId', input.sessionId);
                if (input.serviceId)
                    query.set('serviceId', input.serviceId);
                const suffix = query.size ? `?${query.toString()}` : '';
                return (0, commandResult_1.commandSuccess)({
                    page: input.page,
                    localUiUrl: `${baseUrl}${resolveLocalUiPath(input.page)}${suffix}`,
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
            listBindings: async (input = {}) => {
                const actor = await resolveActorProfileSlug(context, input);
                if (!('slug' in actor))
                    return actor;
                return requestJson(context, 'GET', `/api/llm/bindings/${encodeURIComponent(actor.slug)}`);
            },
            upsertBindings: async (input) => {
                const actor = await resolveActorProfileSlug(context, input);
                if (!('slug' in actor))
                    return actor;
                const bindings = input.bindings.map((binding) => {
                    const runtimeId = typeof binding.llmRuntimeId === 'string' ? normalizeEnvText(binding.llmRuntimeId) : '';
                    const role = typeof binding.role === 'string' ? normalizeEnvText(binding.role) : '';
                    const existingId = typeof binding.id === 'string' ? normalizeEnvText(binding.id) : '';
                    const id = existingId || (runtimeId && role ? `lb_${actor.slug}_${runtimeId}_${role}` : '');
                    return {
                        ...binding,
                        id,
                        metaBotSlug: actor.slug,
                    };
                });
                return requestJson(context, 'PUT', `/api/llm/bindings/${encodeURIComponent(actor.slug)}`, { bindings });
            },
            removeBinding: async (input) => {
                const actor = await resolveActorProfileSlug(context, { from: input.from });
                if (!('slug' in actor))
                    return actor;
                const query = new URLSearchParams({ from: actor.slug });
                return requestJson(context, 'DELETE', `/api/llm/bindings/${encodeURIComponent(input.bindingId)}/delete?${query.toString()}`);
            },
            getPreferredRuntime: async (input = {}) => {
                const actor = await resolveActorProfileSlug(context, input);
                if (!('slug' in actor))
                    return actor;
                return requestJson(context, 'GET', `/api/llm/preferred-runtime/${encodeURIComponent(actor.slug)}`);
            },
            setPreferredRuntime: async (input) => {
                const actor = await resolveActorProfileSlug(context, input);
                if (!('slug' in actor))
                    return actor;
                return requestJson(context, 'PUT', `/api/llm/preferred-runtime/${encodeURIComponent(actor.slug)}`, { runtimeId: input.runtimeId });
            },
        },
        evolution: {
            status: async (input = {}) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const homeDir = actor.homeDir;
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
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const homeDir = actor.homeDir;
                const actorContext = cloneContextWithHomeDir(context, homeDir);
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
                        context: actorContext,
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
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const homeDir = actor.homeDir;
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
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const homeDir = actor.homeDir;
                const actorContext = cloneContextWithHomeDir(context, homeDir);
                const configStore = (0, configStore_1.createConfigStore)(homeDir);
                const config = await configStore.read();
                if (!config.evolution_network.enabled) {
                    return (0, commandResult_1.commandFailed)('evolution_network_disabled', 'Evolution network import is disabled.');
                }
                try {
                    const resolvedScopeHash = await resolveEvolutionScopeHashForSkill({
                        context: actorContext,
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
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const homeDir = actor.homeDir;
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
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const homeDir = actor.homeDir;
                const actorContext = cloneContextWithHomeDir(context, homeDir);
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
                            context: actorContext,
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
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const rollback = await clearActiveVariantMapping(cloneContextWithHomeDir(context, actor.homeDir), input.skill);
                return (0, commandResult_1.commandSuccess)({
                    skillName: input.skill,
                    rolledBack: rollback.removed,
                    previousVariantId: rollback.previousVariantId,
                });
            },
        },
        loom: {
            sync: async (input) => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const paths = (0, paths_1.resolveMetabotPaths)(homeDir);
                const cacheStore = (0, loom_1.createLoomRawCacheStore)(paths);
                const pageSize = input.limit ? Math.max(1, Math.floor(input.limit)) : undefined;
                const maxPages = input.limit ? 1 : undefined;
                const syncResult = await (0, loom_1.readLoomRawChainRecords)({
                    chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
                    pageSize,
                    maxPages,
                });
                const state = await cacheStore.update(syncResult.records);
                const cachedRecords = Object.values(state.records).reduce((total, records) => total + records.length, 0);
                return (0, commandResult_1.commandSuccess)({
                    fetchedRecords: syncResult.records.length,
                    fetchedByProtocol: syncResult.byProtocol,
                    cachedRecords,
                    cachePath: cacheStore.cachePath,
                    updatedAt: state.updatedAt,
                });
            },
            list: async (input) => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const paths = (0, paths_1.resolveMetabotPaths)(homeDir);
                const cacheStore = (0, loom_1.createLoomRawCacheStore)(paths);
                let refreshed = false;
                if (input.refresh) {
                    const syncResult = await (0, loom_1.readLoomRawChainRecords)({
                        chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
                    });
                    await cacheStore.update(syncResult.records);
                    refreshed = true;
                }
                const state = await cacheStore.read();
                return (0, commandResult_1.commandSuccess)({
                    ...(0, loom_1.listLoomTasksFromCache)(state, {
                        limit: input.limit,
                        tag: input.tag,
                        currency: input.currency,
                    }),
                    cache: {
                        path: cacheStore.cachePath,
                        updatedAt: state.updatedAt,
                        refreshed,
                    },
                });
            },
            show: async (input) => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const paths = (0, paths_1.resolveMetabotPaths)(homeDir);
                const cacheStore = (0, loom_1.createLoomRawCacheStore)(paths);
                let refreshed = false;
                if (input.refresh) {
                    const syncResult = await (0, loom_1.readLoomRawChainRecords)({
                        chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
                    });
                    await cacheStore.update(syncResult.records);
                    refreshed = true;
                }
                const state = await cacheStore.read();
                const projection = (0, loom_1.showLoomTaskFromCache)(state, input.taskPinId);
                if (!projection.found) {
                    return {
                        ...(0, commandResult_1.commandFailed)('task_not_found', `Loom task not found in cache: ${input.taskPinId}`),
                        data: projection,
                    };
                }
                return (0, commandResult_1.commandSuccess)({
                    ...projection,
                    cache: {
                        path: cacheStore.cachePath,
                        updatedAt: state.updatedAt,
                        refreshed,
                    },
                });
            },
            dashboard: async (input) => {
                const actor = await resolveActorProfileReadonly(context, input.from);
                if (!('homeDir' in actor)) {
                    return actor;
                }
                const paths = (0, paths_1.resolveMetabotPaths)(actor.homeDir);
                const rawCacheStore = (0, loom_1.createLoomRawCacheStore)(paths);
                const dashboardStore = (0, loom_1.createLoomDashboardStore)(paths);
                const service = (0, loom_1.createLoomDashboardService)({
                    rawCacheStore,
                    dashboardStore,
                    refreshRawCache: async (refreshInput) => {
                        const pageSize = refreshInput.limit ? Math.max(1, Math.floor(refreshInput.limit)) : undefined;
                        const maxPages = refreshInput.limit ? 1 : undefined;
                        const syncResult = await (0, loom_1.readLoomRawChainRecords)({
                            chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
                            pageSize,
                            maxPages,
                        });
                        return rawCacheStore.update(syncResult.records);
                    },
                    readWorkflowStates: async () => {
                        const rawState = await rawCacheStore.read();
                        return listLocalLoomWorkflowsForRawCache(paths, rawState);
                    },
                    resolveActorContext: async () => ({
                        globalMetaId: actor.profile.globalMetaId,
                        address: actor.profile.mvcAddress,
                        profileSlug: actor.profile.slug,
                    }),
                });
                return service.getDashboard(input);
            },
            state: async (input) => {
                const homeDir = normalizeHomeDir(context.env, context.cwd);
                const paths = (0, paths_1.resolveMetabotPaths)(homeDir);
                const cacheStore = (0, loom_1.createLoomRawCacheStore)(paths);
                let refreshed = false;
                if (input.refresh) {
                    const syncResult = await (0, loom_1.readLoomRawChainRecords)({
                        chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
                    });
                    await cacheStore.update(syncResult.records);
                    refreshed = true;
                }
                const rawState = await cacheStore.read();
                const projection = (0, loom_1.buildLoomWorkflowTaskState)(rawState, input.taskPinId);
                const localWorkflows = await listLocalLoomWorkflowsForTask(paths, input.taskPinId);
                const cache = {
                    path: cacheStore.cachePath,
                    updatedAt: rawState.updatedAt,
                    refreshed,
                };
                const data = {
                    ...projection,
                    cache,
                    localWorkflows,
                };
                if (!projection.found) {
                    return {
                        ...(0, commandResult_1.commandFailed)('task_not_found', projection.message),
                        data,
                    };
                }
                return (0, commandResult_1.commandSuccess)(data);
            },
            draftTask: async (input) => {
                return draftLoomTaskFromWish(context, input);
            },
            postTask: async (input) => {
                if (input.from) {
                    const actor = await resolveActorHomeDir(context, input.from);
                    if (!('homeDir' in actor))
                        return actor;
                }
                return (0, loom_1.runLoomPostTaskWorkflow)({
                    from: input.from,
                    payloadFile: input.payloadFile,
                    wish: input.wish,
                    chain: input.chain,
                    dryRun: input.dryRun,
                    readPayloadFile: (payloadFile) => readJsonObjectFile(context, payloadFile),
                    draftTask: (wish) => draftLoomTaskFromWish(context, {
                        wish,
                        from: input.from,
                        allowInvalid: false,
                    }),
                    writeChain: async (request) => context.dependencies.chain?.write?.(request)
                        ?? (0, commandResult_1.commandFailed)('dependency_unavailable', 'Chain write dependency is unavailable.'),
                });
            },
            claimAndStart: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const homeDir = actor.homeDir;
                const paths = (0, paths_1.resolveMetabotPaths)(homeDir);
                const rawCacheStore = (0, loom_1.createLoomRawCacheStore)(paths);
                const workflowStore = (0, loom_1.createLoomWorkflowStore)(paths);
                const rawState = await readFreshLoomRawState(context, rawCacheStore);
                const taskState = (0, loom_1.buildLoomWorkflowTaskState)(rawState, input.taskPinId);
                const signer = createCliSigner(context, homeDir);
                const identity = await signer.getIdentity();
                const runner = (0, loom_1.createNodeLoomCommandRunner)();
                const developerMetaBotSlug = node_path_1.default.basename(paths.profileRoot);
                const runtimeStore = (0, llmRuntimeStore_1.createLlmRuntimeStore)(paths);
                await refreshLlmRuntimeStoreFromDiscovery(runtimeStore, context.env);
                const runtimeResolver = createCliLlmRuntimeResolver(paths);
                const resolvedRuntime = await runtimeResolver.resolveRuntime({ metaBotSlug: developerMetaBotSlug });
                if (!resolvedRuntime.runtime) {
                    return (0, commandResult_1.commandFailed)('llm_runtime_unavailable', `No healthy LLM runtime is available for MetaBot ${developerMetaBotSlug}.`);
                }
                const developerRuntime = (0, llmRuntimeResolver_1.summarizeResolvedLlmRuntime)(resolvedRuntime);
                return (0, loom_1.runLoomClaimAndStartWorkflow)({
                    from: input.from,
                    taskPinId: input.taskPinId,
                    payoutAddress: input.payoutAddress,
                    claimPinId: input.claimPinId,
                    chain: input.chain,
                    fileChain: input.fileChain,
                    message: input.message,
                    developerRuntime,
                    dryRun: input.dryRun,
                    resetWorkspace: input.resetWorkspace,
                    developerMetaBotSlug,
                    developerGlobalMetaId: identity.globalMetaId,
                    state: taskState,
                    workflowStore,
                    runner,
                    github: {
                        assertToolsReady: loom_1.assertGitHubToolsReady,
                        prepareForkWorkspace: loom_1.prepareGitHubForkWorkspace,
                    },
                    writeChain: async (request) => {
                        const result = await signer.writePin(request);
                        return (0, commandResult_1.commandSuccess)({
                            pinId: result.pinId,
                            txids: result.txids,
                            network: result.network,
                            globalMetaId: result.globalMetaId,
                            mvcAddress: result.mvcAddress,
                        });
                    },
                    uploadFile: async (uploadInput) => (0, uploadFile_1.uploadLocalFileToChain)({
                        filePath: uploadInput.filePath,
                        contentType: uploadInput.contentType,
                        network: uploadInput.network,
                        signer,
                    }),
                    writeLogFile: loom_1.writeLoomProcessLogFile,
                    removePath: async (targetPath) => {
                        await node_fs_1.default.promises.rm(targetPath, { recursive: true, force: true });
                    },
                    renamePath: async (from, to) => {
                        await node_fs_1.default.promises.mkdir(node_path_1.default.dirname(to), { recursive: true });
                        await node_fs_1.default.promises.rename(from, to);
                    },
                    pathExists: async (targetPath) => {
                        try {
                            await node_fs_1.default.promises.access(targetPath);
                            return true;
                        }
                        catch (error) {
                            if (error.code === 'ENOENT') {
                                return false;
                            }
                            throw error;
                        }
                    },
                });
            },
            runDevRound: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const homeDir = actor.homeDir;
                const paths = (0, paths_1.resolveMetabotPaths)(homeDir);
                const rawCacheStore = (0, loom_1.createLoomRawCacheStore)(paths);
                const workflowStore = (0, loom_1.createLoomWorkflowStore)(paths);
                const rawState = await readFreshLoomRawState(context, rawCacheStore);
                const taskState = (0, loom_1.buildLoomWorkflowTaskState)(rawState, input.taskPinId);
                const signer = createCliSigner(context, homeDir);
                const identity = await signer.getIdentity();
                const runner = (0, loom_1.createNodeLoomCommandRunner)();
                const developerMetaBotSlug = node_path_1.default.basename(paths.profileRoot);
                const workflow = await workflowStore.read(input.taskPinId, input.claimPinId);
                if (!workflow) {
                    return (0, commandResult_1.commandFailed)('claim_not_found', `Local Loom workflow state was not found for claim ${input.claimPinId}.`);
                }
                if (workflow.developerGlobalMetaId && workflow.developerGlobalMetaId !== identity.globalMetaId) {
                    return (0, commandResult_1.commandFailed)('permission_denied', `Loom claim ${input.claimPinId} belongs to another developer.`);
                }
                const runtimeStore = (0, llmRuntimeStore_1.createLlmRuntimeStore)(paths);
                await refreshLlmRuntimeStoreFromDiscovery(runtimeStore, context.env);
                const runtimeResolver = createCliLlmRuntimeResolver(paths);
                const resolved = await runtimeResolver.resolveRuntime({ metaBotSlug: developerMetaBotSlug });
                if (!resolved.runtime || resolved.runtime.health !== 'healthy') {
                    return (0, commandResult_1.commandFailed)('llm_runtime_unavailable', `No healthy LLM runtime is available for MetaBot ${developerMetaBotSlug}.`);
                }
                const llmExecutor = new executor_1.LlmExecutor({
                    sessionsRoot: paths.llmExecutorSessionsRoot,
                    transcriptsRoot: paths.llmExecutorTranscriptsRoot,
                    skillsRoot: paths.skillsRoot,
                    systemHomeDir: paths.systemHomeDir,
                    env: context.env,
                    backends: (0, executor_1.createRegistryBackendFactories)(),
                });
                return (0, loom_1.runLoomDevRoundWorkflow)({
                    from: input.from,
                    taskPinId: input.taskPinId,
                    claimPinId: input.claimPinId,
                    chain: input.chain,
                    fileChain: input.fileChain,
                    checks: input.checks,
                    roundNote: input.roundNote,
                    developerMetaBotSlug,
                    developerGlobalMetaId: identity.globalMetaId,
                    state: taskState,
                    workflowStore,
                    runner,
                    executeLlmRound: async (prompt, cwd) => (0, llmRuntimeExecution_1.runLlmPromptWithRuntimeFallback)({
                        runtimeResolver,
                        llmExecutor,
                        metaBotSlug: developerMetaBotSlug,
                        prompt,
                        timeoutMs: exports.LOOM_DEV_ROUND_LLM_TIMEOUT_MS,
                        pollIntervalMs: LOOM_DRAFT_LLM_POLL_INTERVAL_MS,
                        cwd,
                    }),
                    writeChain: async (request) => {
                        const result = await signer.writePin(request);
                        return (0, commandResult_1.commandSuccess)({
                            pinId: result.pinId,
                            txids: result.txids,
                            network: result.network,
                            globalMetaId: result.globalMetaId,
                            mvcAddress: result.mvcAddress,
                        });
                    },
                    uploadFile: async (uploadInput) => (0, uploadFile_1.uploadLocalFileToChain)({
                        filePath: uploadInput.filePath,
                        contentType: uploadInput.contentType,
                        network: uploadInput.network,
                        signer,
                    }),
                    writeLogFile: loom_1.writeLoomProcessLogFile,
                });
            },
            deliver: async (input) => {
                const actor = input.dryRun
                    ? await resolveActorProfileReadonly(context, input.from)
                    : await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor)) {
                    return actor;
                }
                const homeDir = actor.homeDir;
                const paths = (0, paths_1.resolveMetabotPaths)(homeDir);
                const rawCacheStore = (0, loom_1.createLoomRawCacheStore)(paths);
                const workflowStore = (0, loom_1.createLoomWorkflowStore)(paths);
                const rawState = await readFreshLoomRawState(context, rawCacheStore);
                const taskState = (0, loom_1.buildLoomWorkflowTaskState)(rawState, input.taskPinId);
                const runner = (0, loom_1.createNodeLoomCommandRunner)();
                const developerMetaBotSlug = node_path_1.default.basename(paths.profileRoot);
                const signer = input.dryRun ? null : createCliSigner(context, homeDir);
                const dryRunProfile = actor.profile;
                const developerGlobalMetaId = dryRunProfile
                    ? dryRunProfile.globalMetaId
                    : (await signer.getIdentity()).globalMetaId;
                return (0, loom_1.runLoomDeliverWorkflow)({
                    from: input.from,
                    taskPinId: input.taskPinId,
                    claimPinId: input.claimPinId,
                    chain: input.chain,
                    prTitle: input.prTitle,
                    deliverySummary: input.deliverySummary,
                    dryRun: input.dryRun,
                    developerMetaBotSlug,
                    developerGlobalMetaId,
                    state: taskState,
                    workflowStore,
                    runner,
                    github: {
                        assertToolsReady: loom_1.assertGitHubToolsReady,
                        pushLoomBranch: loom_1.pushLoomBranch,
                        createLoomPullRequest: loom_1.createLoomPullRequest,
                    },
                    writeChain: async (request) => {
                        if (!signer) {
                            return (0, commandResult_1.commandFailed)('chain_write_unavailable', 'Dry-run delivery must not write chain data.');
                        }
                        const result = await signer.writePin(request);
                        return (0, commandResult_1.commandSuccess)({
                            pinId: result.pinId,
                            txids: result.txids,
                            network: result.network,
                            globalMetaId: result.globalMetaId,
                            mvcAddress: result.mvcAddress,
                        });
                    },
                });
            },
            acceptAndPay: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor)) {
                    return actor;
                }
                const homeDir = actor.homeDir;
                const paths = (0, paths_1.resolveMetabotPaths)(homeDir);
                const rawCacheStore = (0, loom_1.createLoomRawCacheStore)(paths);
                const workflowStore = (0, loom_1.createLoomWorkflowStore)(paths);
                const rawStateResult = input.confirmPayment
                    ? await requireFreshLoomRawState(context, rawCacheStore)
                    : (0, commandResult_1.commandSuccess)(await readFreshLoomRawState(context, rawCacheStore));
                if (!rawStateResult.ok) {
                    return rawStateResult;
                }
                const rawState = rawStateResult.data;
                const taskState = (0, loom_1.buildLoomWorkflowTaskState)(rawState, input.taskPinId);
                const signer = createCliSigner(context, homeDir);
                const identity = await signer.getIdentity();
                return (0, loom_1.runLoomAcceptAndPayWorkflow)({
                    from: input.from,
                    taskPinId: input.taskPinId,
                    deliveryPinId: input.deliveryPinId,
                    score: input.score,
                    comment: input.comment,
                    chain: input.chain,
                    confirmPayment: input.confirmPayment,
                    requesterGlobalMetaId: identity.globalMetaId,
                    state: taskState,
                    workflowStore,
                    walletTransfer: async (transferInput) => runWalletTransferRuntime(context, transferInput),
                    writeChain: async (request) => {
                        const result = await signer.writePin(request);
                        return (0, commandResult_1.commandSuccess)({
                            pinId: result.pinId,
                            txids: result.txids,
                            network: result.network,
                            globalMetaId: result.globalMetaId,
                            mvcAddress: result.mvcAddress,
                        });
                    },
                });
            },
            reviewDelivery: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor)) {
                    return actor;
                }
                const homeDir = actor.homeDir;
                const paths = (0, paths_1.resolveMetabotPaths)(homeDir);
                const rawCacheStore = (0, loom_1.createLoomRawCacheStore)(paths);
                const workflowStore = (0, loom_1.createLoomWorkflowStore)(paths);
                const rawState = await readFreshLoomRawState(context, rawCacheStore);
                const taskState = (0, loom_1.buildLoomWorkflowTaskState)(rawState, input.taskPinId);
                const signer = createCliSigner(context, homeDir);
                const identity = await signer.getIdentity();
                return (0, loom_1.runLoomReviewDeliveryWorkflow)({
                    from: input.from,
                    taskPinId: input.taskPinId,
                    deliveryPinId: input.deliveryPinId,
                    verdict: input.verdict,
                    score: input.score,
                    comment: input.comment,
                    chain: input.chain,
                    attachments: input.attachments,
                    requesterGlobalMetaId: identity.globalMetaId,
                    state: taskState,
                    workflowStore,
                    writeChain: async (request) => {
                        const result = await signer.writePin(request);
                        return (0, commandResult_1.commandSuccess)({
                            pinId: result.pinId,
                            txids: result.txids,
                            network: result.network,
                            globalMetaId: result.globalMetaId,
                            mvcAddress: result.mvcAddress,
                        });
                    },
                });
            },
        },
        bot: {
            listProfiles: async () => requestJson(context, 'GET', '/api/bot/profiles'),
            getProfile: async (input) => requestJson(context, 'GET', `/api/bot/profiles/${encodeURIComponent(input.slug)}`),
            createProfile: async (input) => requestJson(context, 'POST', '/api/bot/profiles', input),
            updateProfile: async (input) => {
                const { slug, ...body } = input;
                return requestJson(context, 'PUT', `/api/bot/profiles/${encodeURIComponent(slug)}`, body);
            },
            deleteProfile: async (input) => requestJson(context, 'DELETE', `/api/bot/profiles/${encodeURIComponent(input.slug)}`),
            getConfig: async (input) => requestJson(context, 'GET', `/api/bot/profiles/${encodeURIComponent(input.slug)}/config`),
            setConfig: async (input) => {
                const { slug, ...body } = input;
                return requestJson(context, 'PUT', `/api/bot/profiles/${encodeURIComponent(slug)}/config`, body);
            },
            getWallet: async (input) => requestJson(context, 'GET', `/api/bot/profiles/${encodeURIComponent(input.slug)}/wallet`),
            getBackup: async (input) => requestJson(context, 'GET', `/api/bot/profiles/${encodeURIComponent(input.slug)}/backup`),
            listRuntimes: async (input = {}) => {
                const query = new URLSearchParams();
                if (input.from)
                    query.set('from', input.from);
                const suffix = query.size ? `?${query.toString()}` : '';
                return requestJson(context, 'GET', `/api/bot/runtimes${suffix}`);
            },
            discoverRuntimes: async (input = {}) => {
                const query = new URLSearchParams();
                if (input.from)
                    query.set('from', input.from);
                const suffix = query.size ? `?${query.toString()}` : '';
                return requestJson(context, 'POST', `/api/bot/runtimes/discover${suffix}`);
            },
            listSessions: async (input) => {
                const query = new URLSearchParams({ limit: String(input.limit) });
                if (input.slug)
                    query.set('slug', input.slug);
                return requestJson(context, 'GET', `/api/bot/sessions?${query.toString()}`);
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
        loom: { ...defaults.loom, ...provided.loom },
        bot: { ...defaults.bot, ...provided.bot },
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
        systemHomeDir: paths.systemHomeDir,
        env: context.env,
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
        createSignerForHome: (profileHomeDir) => {
            const profileBaseSigner = (0, localMnemonicSigner_1.createLocalMnemonicSigner)({
                secretStore: (0, fileSecretStore_1.createFileSecretStore)(profileHomeDir),
                adapters,
            });
            return context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
                ? createTestChainWriteSigner(profileBaseSigner)
                : profileBaseSigner;
        },
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
        handleOrderProtocolMessageForProfile: async (profile, message) => {
            const handler = handlers.services?.handleInboundOrderProtocolMessage;
            if (!handler) {
                return (0, commandResult_1.commandSuccess)({ handled: false });
            }
            return handler({
                ...message,
                localProfileSlug: profile.slug,
            });
        },
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
    const simplemsgPresenceWatchdog = (0, simplemsgPresenceWatchdog_1.createA2ASimplemsgPresenceWatchdog)({
        manager: simplemsgListener,
        onRestart: (event) => {
            const missingNames = event.missing
                .map((profile) => `${profile.name || profile.slug} (${profile.globalMetaId})`)
                .join(', ');
            console.warn(`[A2A simplemsg listener] restarted after socket presence missed local profiles: ${missingNames}`);
        },
        onError: (error) => {
            console.warn('[A2A simplemsg listener watchdog]', error.message);
        },
    });
    if (daemonConfig.a2a.simplemsgListenerEnabled) {
        await simplemsgListener.start();
        simplemsgPresenceWatchdog.start();
        chatAutoReplyBackfill.start();
        void replayUnhandledA2AOrderMessagesForProfiles({
            systemHomeDir: paths.systemHomeDir,
            activeHomeDir: homeDir,
            handleOrderProtocolMessage: handlers.services?.handleInboundOrderProtocolMessage,
            logWarning: (scope, error) => {
                console.warn(scope, error instanceof Error ? error.message : String(error));
            },
        }).catch((error) => {
            console.warn('[A2A order replay]', error instanceof Error ? error.message : String(error));
        });
    }
    let shuttingDown = false;
    const shutdown = async (exitCode) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        simplemsgPresenceWatchdog.stop();
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
