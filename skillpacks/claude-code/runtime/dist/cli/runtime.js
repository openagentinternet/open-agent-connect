"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildA2ASimplemsgInboundDispatcher = buildA2ASimplemsgInboundDispatcher;
exports.refreshA2ASimplemsgListenerForIdentityProfileRegistration = refreshA2ASimplemsgListenerForIdentityProfileRegistration;
exports.createServiceRefundSyncLoop = createServiceRefundSyncLoop;
exports.getDefaultDaemonPort = getDefaultDaemonPort;
exports.getDaemonRuntimeFingerprint = getDaemonRuntimeFingerprint;
exports.buildDaemonConfigHash = buildDaemonConfigHash;
exports.probeDaemonStatus = probeDaemonStatus;
exports.createPrivateChatReplyRunnerForProfile = createPrivateChatReplyRunnerForProfile;
exports.replayUnhandledA2AOrderMessagesForProfiles = replayUnhandledA2AOrderMessagesForProfiles;
exports.resumePendingA2ACallerReplyWaitsForProfiles = resumePendingA2ACallerReplyWaitsForProfiles;
exports.createPrivateChatAutoReplyProfileDispatcher = createPrivateChatAutoReplyProfileDispatcher;
exports.resolvePeerChatPublicKeyFromLocalProfiles = resolvePeerChatPublicKeyFromLocalProfiles;
exports.createPeerChatPublicKeyResolver = createPeerChatPublicKeyResolver;
exports.createDefaultCliDependencies = createDefaultCliDependencies;
exports.mergeCliDependencies = mergeCliDependencies;
exports.serveCliDaemonProcess = serveCliDaemonProcess;
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const node_net_1 = __importDefault(require("node:net"));
const daemonStartupDiagnostics_1 = require("./daemonStartupDiagnostics");
const version_1 = require("./version");
const commandResult_1 = require("../core/contracts/commandResult");
const configStore_1 = require("../core/config/configStore");
const infrastructureConfigStore_1 = require("../core/config/infrastructureConfigStore");
const configTypes_1 = require("../core/config/configTypes");
const hostSkillBinding_1 = require("../core/host/hostSkillBinding");
const hostPersonaProjection_1 = require("../core/host/hostPersonaProjection");
const twinRole_1 = require("../core/bot/twinRole");
const identityProfiles_1 = require("../core/identity/identityProfiles");
const profileWorkspace_1 = require("../core/identity/profileWorkspace");
const profileNameResolution_1 = require("../core/identity/profileNameResolution");
const ownerIdentity_1 = require("../core/owner/ownerIdentity");
const skillResolver_1 = require("../core/skills/skillResolver");
const paths_1 = require("../core/state/paths");
const memoryStore_1 = require("../core/memory/memoryStore");
const memoryPolicy_1 = require("../core/memory/memoryPolicy");
const memoryService_1 = require("../core/memory/memoryService");
const transcriptStore_1 = require("../core/memory/transcriptStore");
const dreamStore_1 = require("../core/memory/dreamStore");
const dreamService_1 = require("../core/memory/dreamService");
const experiencePromptBlocks_1 = require("../core/memory/experiencePromptBlocks");
const dreamPrompt_1 = require("../core/memory/dreamPrompt");
const experienceStore_1 = require("../core/memory/experienceStore");
const impressionStore_1 = require("../core/memory/impressionStore");
const knowledgeStore_1 = require("../core/memory/knowledgeStore");
const knowledgePromptBlocks_1 = require("../core/memory/knowledgePromptBlocks");
const chatPersonaLoader_1 = require("../core/chat/chatPersonaLoader");
const orchestrationStore_1 = require("../core/memory/orchestrationStore");
const twinRole_2 = require("../core/bot/twinRole");
const homeSelection_1 = require("../core/state/homeSelection");
const runtimeStateStore_1 = require("../core/state/runtimeStateStore");
const daemonStateStore_1 = require("../core/state/daemonStateStore");
const providerPresenceState_1 = require("../core/provider/providerPresenceState");
const onlineServiceCache_1 = require("../core/discovery/onlineServiceCache");
const onlineServiceCacheSync_1 = require("../core/discovery/onlineServiceCacheSync");
const remoteCall_1 = require("../core/delegation/remoteCall");
const ratingDetailState_1 = require("../core/ratings/ratingDetailState");
const socketPresenceDirectory_1 = require("../core/discovery/socketPresenceDirectory");
const metasoInfrastructure_1 = require("../core/network/metasoInfrastructure");
const metaAppSearchApi_1 = require("../core/metaapp/metaAppSearchApi");
const metaIdSearchApi_1 = require("../core/metaid/metaIdSearchApi");
const metaAppSource_1 = require("../core/metaapp/metaAppSource");
const fileSecretStore_1 = require("../core/secrets/fileSecretStore");
const localMnemonicSigner_1 = require("../core/signing/localMnemonicSigner");
const writePin_1 = require("../core/chain/writePin");
const registry_1 = require("../core/chain/adapters/registry");
const nativeWallet_1 = require("../core/wallet/nativeWallet");
const daemon_1 = require("../daemon");
const defaultHandlers_1 = require("../daemon/defaultHandlers");
const grouptaskHandlers_1 = require("../daemon/grouptaskHandlers");
const engine_1 = require("../core/grouptask/engine");
const simplemsgListener_1 = require("../core/a2a/simplemsgListener");
const simplemsgPresenceWatchdog_1 = require("../core/a2a/simplemsgPresenceWatchdog");
const simplemsgClassifier_1 = require("../core/a2a/simplemsgClassifier");
const sessionStateStore_1 = require("../core/a2a/sessionStateStore");
const orderLifecycle_1 = require("../core/orders/orderLifecycle");
const orderChatSuppression_1 = require("../core/orders/orderChatSuppression");
const privateChatAutoReply_1 = require("../core/chat/privateChatAutoReply");
const privateChatSendFailureLog_1 = require("../core/chat/privateChatSendFailureLog");
const privateChatAutoReplyBackfill_1 = require("../core/chat/privateChatAutoReplyBackfill");
const privateChatStateStore_1 = require("../core/chat/privateChatStateStore");
const privateConversation_1 = require("../core/chat/privateConversation");
const privateChatPeerDiscovery_1 = require("../core/chat/privateChatPeerDiscovery");
const chatStrategyStore_1 = require("../core/chat/chatStrategyStore");
const hostLlmChatReplyRunner_1 = require("../core/chat/hostLlmChatReplyRunner");
const privateChatAllowedSkills_1 = require("../core/chat/privateChatAllowedSkills");
const chatSkillWaitNotice_1 = require("../core/chat/chatSkillWaitNotice");
const orderProtocolTextGenerator_1 = require("../core/a2a/orderProtocolTextGenerator");
const providerWorkspaceCleanup_1 = require("../core/a2a/provider/providerWorkspaceCleanup");
const servicePayment_1 = require("../core/payments/servicePayment");
const llmRuntimeStore_1 = require("../core/llm/llmRuntimeStore");
const llmBindingStore_1 = require("../core/llm/llmBindingStore");
const llmRuntimeResolver_1 = require("../core/llm/llmRuntimeResolver");
const llmRuntimeDiscovery_1 = require("../core/llm/llmRuntimeDiscovery");
const llmAvailabilityRecovery_1 = require("../core/llm/llmAvailabilityRecovery");
const platformSkillCatalog_1 = require("../core/services/platformSkillCatalog");
const executor_1 = require("../core/llm/executor");
const llmRuntimeExecution_1 = require("../core/llm/llmRuntimeExecution");
const update_1 = require("../core/system/update");
const uninstall_1 = require("../core/system/uninstall");
const DEFAULT_DAEMON_BASE_URL = 'http://127.0.0.1:10001';
const DEFAULT_DAEMON_HOST = '127.0.0.1';
const DEFAULT_DAEMON_START_TIMEOUT_MS = 30_000;
const DAEMON_START_POLL_INTERVAL_MS = 100;
const DAEMON_HEALTH_TIMEOUT_MS = 1_500;
const DAEMON_PREFERRED_PORT_ENV = 'METABOT_DAEMON_PREFERRED_PORT';
const DEFAULT_DAEMON_PORT = 10_001;
const DAEMON_FALLBACK_PORT_START = 10_002;
const DAEMON_FALLBACK_PORT_END = 10_020;
const TEST_FAKE_CHAIN_WRITE_ENV = 'METABOT_TEST_FAKE_CHAIN_WRITE';
const TEST_FAKE_SUBSIDY_ENV = 'METABOT_TEST_FAKE_SUBSIDY';
const TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY_ENV = 'METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY';
const TEST_FAKE_METAWEB_REPLY_ENV = 'METABOT_TEST_FAKE_METAWEB_REPLY';
const TEST_FAKE_BUYER_RATING_REPLY_ENV = 'METABOT_TEST_FAKE_BUYER_RATING_REPLY';
const TEST_FAKE_PROVIDER_LLM_REPLY_ENV = 'METABOT_TEST_FAKE_PROVIDER_LLM_REPLY';
const TEST_SKIP_BACKGROUND_LLM_DISCOVERY_ENV = 'METABOT_TEST_SKIP_BACKGROUND_LLM_DISCOVERY';
const ALLOW_UNINDEXED_HOME_ENV = 'METABOT_ALLOW_UNINDEXED_HOME';
const DAEMON_CONFIG_RESTART_TIMEOUT_MS = 5_000;
const METALET_HOST = 'https://www.metalet.space';
const CHAIN_NET = 'livenet';
const DEFAULT_SERVICE_REFUND_SYNC_INTERVAL_MS = 10 * 60 * 1000;
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
async function refreshA2ASimplemsgListenerForIdentityProfileRegistration(input) {
    if (!input.enabled) {
        return {
            refreshed: false,
            report: null,
        };
    }
    input.watchdog?.stop();
    input.listener.stop();
    input.backfill?.stop();
    const report = await input.listener.start();
    await input.backfill?.start();
    input.watchdog?.start();
    return {
        refreshed: true,
        report,
    };
}
function createServiceRefundSyncLoop(input) {
    const intervalMs = Math.max(60_000, Math.floor(input.intervalMs ?? DEFAULT_SERVICE_REFUND_SYNC_INTERVAL_MS));
    const setIntervalFn = input.setIntervalFn
        ?? ((callback, nextIntervalMs) => setInterval(callback, nextIntervalMs));
    const clearIntervalFn = input.clearIntervalFn
        ?? ((handle) => clearInterval(handle));
    const logWarning = input.logWarning ?? ((message) => console.warn(message));
    let running = false;
    let stopped = false;
    let cleared = false;
    const runOnce = async () => {
        if (running || stopped) {
            return;
        }
        running = true;
        try {
            await input.syncRefunds();
        }
        catch (error) {
            logWarning(`[service refund sync] ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            running = false;
        }
    };
    const handle = setIntervalFn(runOnce, intervalMs);
    handle.unref?.();
    return {
        runOnce,
        stop() {
            stopped = true;
            if (cleared) {
                return;
            }
            cleared = true;
            clearIntervalFn(handle);
        },
    };
}
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
function parseDaemonPort(value) {
    const parsed = Number.parseInt(normalizeEnvText(value), 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        return null;
    }
    return parsed;
}
function getDefaultDaemonPort(_systemHomeDir) {
    return DEFAULT_DAEMON_PORT;
}
const SUPPORTED_CONFIG_KEYS = new Set([
    'a2a.simplemsgListenerEnabled',
    'chain.defaultWriteNetwork',
    'chain.mvcSponsorUploadEnabled',
]);
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isSupportedConfigKey(key) {
    return SUPPORTED_CONFIG_KEYS.has(key);
}
function isSupportedBooleanConfigKey(key) {
    return key === 'a2a.simplemsgListenerEnabled' || key === 'chain.mvcSponsorUploadEnabled';
}
function readConfigValue(config, key) {
    if (key === 'a2a.simplemsgListenerEnabled') {
        return config.a2a.simplemsgListenerEnabled;
    }
    if (key === 'chain.defaultWriteNetwork') {
        return config.chain.defaultWriteNetwork;
    }
    if (key === 'chain.mvcSponsorUploadEnabled') {
        return config.chain.mvcSponsorUploadEnabled;
    }
    return config.chain.defaultWriteNetwork;
}
function writeConfigValue(config, key, value) {
    if (key === 'chain.defaultWriteNetwork') {
        return {
            ...config,
            chain: {
                ...config.chain,
                defaultWriteNetwork: value,
            },
        };
    }
    if (key === 'chain.mvcSponsorUploadEnabled') {
        return {
            ...config,
            chain: {
                ...config.chain,
                mvcSponsorUploadEnabled: value === true,
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
    return config;
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
        const selectedHome = explicitHome ? node_path_1.default.resolve(explicitHome) : await (0, twinRole_1.resolveTwinHomeDir)(systemHomeDir);
        if (!selectedHome) {
            return (0, commandResult_1.commandFailed)('profile_not_found', 'No Twin Bot profile found for dry-run delivery.');
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
    const twinHomeDir = node_path_1.default.resolve(normalizeHomeDir(context.env, context.cwd));
    const twinProfile = profiles.find((profile) => node_path_1.default.resolve(profile.homeDir) === twinHomeDir);
    if (!twinProfile?.slug) {
        return (0, commandResult_1.commandFailed)('profile_not_found', `Twin Bot profile not found in the manager index for home: ${twinHomeDir}`);
    }
    return { slug: twinProfile.slug };
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
const BROWSER_DEEP_LINK_SCHEMES = new Set(['metaid', 'metaapp', 'metafile', 'pin']);
const BROWSER_PIN_ID_PATTERN = /^[0-9a-f]{64}i0$/iu;
const BROWSER_DOMAIN_ALIAS_PATTERN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;
// preview-metaapp://localhost<path-to-dir-or-entry> carries an absolute path, so
// unlike the host-only deep links above it needs its own RESTful Browser path.
const PREVIEW_METAAPP_URI_PATTERN = /^preview-metaapp:\/\/([^/?#]+)(\/.*)?$/iu;
function resolveLocalBrowserPath(uri) {
    const trimmedUri = uri.trim();
    const match = trimmedUri === uri
        ? /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)$/iu.exec(uri)
        : null;
    const scheme = match?.[1]?.toLowerCase();
    const resourceId = match?.[2];
    if (scheme && resourceId && BROWSER_DEEP_LINK_SCHEMES.has(scheme)) {
        return `/browser/${scheme}/${encodeURIComponent(resourceId)}`;
    }
    // Render preview-metaapp://localhost<path> as a path-style Browser URL so it
    // survives chat surfaces that mangle the ?uri=<encoded> query form. The host
    // and each absolute-path segment are encoded independently.
    const previewMatch = trimmedUri === uri ? PREVIEW_METAAPP_URI_PATTERN.exec(uri) : null;
    if (previewMatch) {
        const host = previewMatch[1];
        const rawPath = previewMatch[2] || '';
        const segments = rawPath.split('/').filter(Boolean).map((segment) => encodeURIComponent(segment));
        const pathSuffix = segments.length ? '/' + segments.join('/') : '';
        return `/browser/preview-metaapp/${encodeURIComponent(host)}${pathSuffix}`;
    }
    if (!match && trimmedUri === uri && BROWSER_PIN_ID_PATTERN.test(uri)) {
        return `/browser/pin/${encodeURIComponent(uri)}`;
    }
    if (!match && trimmedUri === uri && BROWSER_DOMAIN_ALIAS_PATTERN.test(uri)) {
        return `/browser/metaid/${encodeURIComponent(uri)}`;
    }
    const query = new URLSearchParams();
    query.set('uri', uri);
    return `/browser?${query.toString()}`;
}
/**
 * Best-effort daemon base URL for decorating read-only results with clickable
 * http links. Unlike ensureDaemonBaseUrl this never starts or restarts a
 * daemon: links are only attached when a base URL is already configured or a
 * running daemon is reachable.
 */
async function readReachableDaemonBaseUrl(context) {
    const explicitBaseUrl = normalizeEnvText(context.env.METABOT_DAEMON_BASE_URL);
    if (explicitBaseUrl) {
        return normalizeBaseUrl(explicitBaseUrl);
    }
    const daemonRecord = await resolveDaemonRecord(context);
    if (daemonRecord?.baseUrl
        && daemonConfigMatchesContext(daemonRecord, context)
        && await isDaemonReachable(daemonRecord.baseUrl, daemonRecord.ownerId)) {
        return normalizeBaseUrl(daemonRecord.baseUrl);
    }
    return null;
}
/**
 * Adds clickable per-item http links for hosts whose markdown renderer cannot
 * intercept metaapp:// or metaid:// deep links: `localUiUrl` opens the app in
 * the local Browser, `publisherLocalUiUrl` opens the publisher's Bot page.
 */
function withMetaAppCandidateLinks(items, daemonBaseUrl) {
    if (!daemonBaseUrl) {
        return items;
    }
    return items.map((item) => ({
        ...item,
        ...(item.pinId
            ? { localUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(`metaapp://${item.pinId}`)}` }
            : {}),
        ...(item.publisherGlobalMetaId
            ? { publisherLocalUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(`metaid://${item.publisherGlobalMetaId}`)}` }
            : {}),
    }));
}
/**
 * Same link decoration for MetaID search candidates: `localUiUrl` opens the
 * identity's Bot page in the local Browser, `avatarLocalUiUrl` the avatar
 * metafile. Only attached when a daemon base URL is reachable.
 */
function withMetaIdCandidateLinks(items, daemonBaseUrl) {
    if (!daemonBaseUrl) {
        return items;
    }
    return items.map((item) => ({
        ...item,
        ...(item.globalMetaId
            ? { localUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(`metaid://${item.globalMetaId}`)}` }
            : {}),
        ...(item.avatarId
            ? { avatarLocalUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(`metafile://${item.avatarId}`)}` }
            : {}),
    }));
}
/**
 * Link decoration for a MetaID detail record: Bot page, avatar metafile, and
 * the declared custom homepage when its URI resolves to a Browser surface.
 */
function withMetaIdDetailLinks(detail, daemonBaseUrl) {
    if (!daemonBaseUrl) {
        return detail;
    }
    const homepage = detail.homepage;
    const homepageRecord = homepage && typeof homepage === 'object' && !Array.isArray(homepage)
        ? homepage
        : null;
    const homepageUri = normalizeEnvText(typeof homepageRecord?.uri === 'string' ? homepageRecord.uri : undefined);
    return {
        ...detail,
        ...(detail.globalMetaId
            ? { localUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(`metaid://${detail.globalMetaId}`)}` }
            : {}),
        ...(detail.avatarId
            ? { avatarLocalUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(`metafile://${detail.avatarId}`)}` }
            : {}),
        ...(homepageUri
            ? { homepageLocalUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(homepageUri)}` }
            : {}),
    };
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
    const previous = await runtimeStore.read();
    const result = await (0, llmRuntimeDiscovery_1.discoverLlmRuntimes)({ env, knownRuntimes: previous.runtimes });
    const discoveredRuntimeIds = new Set(result.runtimes.map((runtime) => runtime.id));
    for (const runtime of result.runtimes) {
        await runtimeStore.upsertRuntime(runtime, { preserveRecentHealthyOnDetected: true });
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
function parseDreamLimits(payload) {
    const source = payload.limits && typeof payload.limits === 'object' && !Array.isArray(payload.limits)
        ? payload.limits
        : payload;
    const contextWindow = typeof source.contextWindow === 'number' && Number.isFinite(source.contextWindow)
        ? source.contextWindow
        : undefined;
    const maxOutputTokens = typeof source.maxOutputTokens === 'number' && Number.isFinite(source.maxOutputTokens)
        ? source.maxOutputTokens
        : undefined;
    if (contextWindow === undefined && maxOutputTokens === undefined)
        return undefined;
    return {
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    };
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
async function selectDaemonInstallation(context) {
    const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
    const store = (0, daemonStateStore_1.createDaemonStateStore)(systemHomeDir);
    const existing = await store.readInstallation();
    if (existing) {
        return existing;
    }
    const explicitPort = parseDaemonPort(context.env.METABOT_DAEMON_PORT)
        ?? parseDaemonPort(context.env[DAEMON_PREFERRED_PORT_ENV]);
    const candidates = explicitPort
        ? [explicitPort]
        : [
            DEFAULT_DAEMON_PORT,
            ...Array.from({ length: DAEMON_FALLBACK_PORT_END - DAEMON_FALLBACK_PORT_START + 1 }, (_value, index) => DAEMON_FALLBACK_PORT_START + index),
        ];
    for (const port of candidates) {
        if (!await isPortBindable(DEFAULT_DAEMON_HOST, port)) {
            continue;
        }
        const record = {
            schemaVersion: 1,
            host: DEFAULT_DAEMON_HOST,
            port,
            selectionOrigin: explicitPort
                ? 'explicit_migration'
                : port === DEFAULT_DAEMON_PORT
                    ? 'default'
                    : 'fallback',
            updatedAt: Date.now(),
        };
        return store.writeInstallation(record);
    }
    if (explicitPort) {
        throw new Error(`daemon_port_unavailable: ${DEFAULT_DAEMON_HOST}:${explicitPort} is unavailable.`);
    }
    throw new Error(`daemon_port_unavailable: no free loopback port in ${DEFAULT_DAEMON_PORT} or ${DAEMON_FALLBACK_PORT_START}-${DAEMON_FALLBACK_PORT_END}.`);
}
async function probeDaemonStatus(baseUrl, timeoutMs = DAEMON_HEALTH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/daemon/status`, {
            signal: controller.signal,
        });
        if (!response.ok) {
            return { reachable: false, ownerId: null, pid: null };
        }
        const payload = await response.json();
        if (payload.ok !== true) {
            return { reachable: false, ownerId: null, pid: null };
        }
        return {
            reachable: true,
            ownerId: typeof payload.data?.daemonId === 'string'
                ? normalizeEnvText(payload.data.daemonId) || null
                : null,
            pid: typeof payload.data?.pid === 'number' && Number.isInteger(payload.data.pid)
                ? payload.data.pid
                : null,
        };
    }
    catch {
        return { reachable: false, ownerId: null, pid: null };
    }
    finally {
        clearTimeout(timeout);
    }
}
async function isDaemonReachable(baseUrl, expectedOwnerId) {
    const status = await probeDaemonStatus(baseUrl);
    return status.reachable
        && (!expectedOwnerId || status.ownerId === expectedOwnerId);
}
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        const code = error.code;
        return code !== 'ESRCH';
    }
}
async function readDaemonLockInfo(lockPath) {
    try {
        const raw = await node_fs_1.default.promises.readFile(lockPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            ownerId: typeof parsed.ownerId === 'string'
                ? normalizeEnvText(parsed.ownerId) || null
                : null,
            pid: typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) ? parsed.pid : null,
        };
    }
    catch {
        return { ownerId: null, pid: null };
    }
}
async function readProcessCommand(pid) {
    return new Promise((resolve) => {
        (0, node_child_process_1.execFile)('ps', ['-p', String(pid), '-o', 'command='], (error, stdout) => {
            if (error) {
                resolve(null);
                return;
            }
            const command = stdout.trim();
            resolve(command || null);
        });
    });
}
class DaemonOwnershipVerificationError extends Error {
    constructor(pid, lockPath) {
        super(`Unable to verify ownership of daemon process ${pid}. It was not stopped. Inspect ${lockPath} and the daemon record before retrying.`);
        this.name = 'DaemonOwnershipVerificationError';
    }
}
async function verifyDaemonProcessOwnership(input) {
    const { daemonRecord, lockPath } = input;
    if (!isProcessAlive(daemonRecord.pid)) {
        return 'dead';
    }
    const status = await probeDaemonStatus(daemonRecord.baseUrl);
    if (status.reachable
        && status.ownerId === daemonRecord.ownerId
        && status.pid === daemonRecord.pid) {
        return 'verified';
    }
    const lock = await readDaemonLockInfo(lockPath);
    if (lock.ownerId !== daemonRecord.ownerId || lock.pid !== daemonRecord.pid) {
        return 'unverified';
    }
    const command = await readProcessCommand(daemonRecord.pid);
    return command?.includes('daemon serve') ? 'verified' : 'unverified';
}
async function resolveDaemonRecord(context) {
    const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
    const store = (0, daemonStateStore_1.createDaemonStateStore)(systemHomeDir);
    return store.readDaemon();
}
function daemonConfigMatchesContext(daemonRecord, context) {
    if (!daemonRecord) {
        return false;
    }
    return normalizeEnvText(daemonRecord.configHash) === buildDaemonConfigHash(context.env);
}
async function stopRunningDaemon(input) {
    const { daemonRecord, lockPath } = input;
    if (!Number.isFinite(daemonRecord.pid) || daemonRecord.pid <= 0) {
        return 'already_stopped';
    }
    const ownership = await verifyDaemonProcessOwnership({ daemonRecord, lockPath });
    if (ownership === 'dead') {
        const portReleased = await isPortBindable(daemonRecord.host || DEFAULT_DAEMON_HOST, daemonRecord.port);
        if (!portReleased) {
            throw new Error(`Daemon process ${daemonRecord.pid} is already gone, but ${daemonRecord.host || DEFAULT_DAEMON_HOST}:${daemonRecord.port} is still occupied.`);
        }
        return 'already_stopped';
    }
    if (ownership !== 'verified') {
        throw new DaemonOwnershipVerificationError(daemonRecord.pid, lockPath);
    }
    try {
        process.kill(daemonRecord.pid, 'SIGTERM');
    }
    catch (error) {
        const code = error.code;
        if (code === 'ESRCH') {
            return 'already_stopped';
        }
        throw error;
    }
    const waitForStop = async () => {
        const startedAt = Date.now();
        while ((Date.now() - startedAt) < DAEMON_CONFIG_RESTART_TIMEOUT_MS) {
            if (!isProcessAlive(daemonRecord.pid)
                && await isPortBindable(daemonRecord.host || DEFAULT_DAEMON_HOST, daemonRecord.port)) {
                return true;
            }
            await sleep(DAEMON_START_POLL_INTERVAL_MS);
        }
        return false;
    };
    if (await waitForStop()) {
        return 'stopped';
    }
    try {
        process.kill(daemonRecord.pid, 'SIGKILL');
    }
    catch (error) {
        const code = error.code;
        if (code !== 'ESRCH') {
            throw error;
        }
    }
    if (await waitForStop()) {
        return 'stopped';
    }
    throw new Error(`Timed out while stopping the verified local MetaBot daemon process ${daemonRecord.pid}.`);
}
async function quarantineLegacyDaemonPath(filePath) {
    try {
        await node_fs_1.default.promises.rename(filePath, `${filePath}.migrated-${Date.now()}`);
    }
    catch (error) {
        const code = error.code;
        if (code !== 'ENOENT') {
            throw error;
        }
    }
}
async function writeDaemonMigrationSnapshot(input) {
    const paths = (0, paths_1.resolveMetabotDaemonPaths)(input.systemHomeDir);
    await node_fs_1.default.promises.mkdir(paths.recoveryRoot, { recursive: true });
    const content = `${JSON.stringify({
        schemaVersion: 1,
        updatedAt: Date.now(),
        entries: input.entries,
    }, null, 2)}\n`;
    const temporaryPath = `${paths.migrationStatePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        await node_fs_1.default.promises.writeFile(temporaryPath, content, 'utf8');
        await node_fs_1.default.promises.rename(temporaryPath, paths.migrationStatePath);
    }
    catch (error) {
        await node_fs_1.default.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
async function migrateLegacyProfileDaemons(systemHomeDir) {
    const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir);
    const entries = [];
    for (const profile of profiles) {
        const paths = (0, paths_1.resolveMetabotPaths)(profile.homeDir);
        const legacyStore = (0, runtimeStateStore_1.createRuntimeStateStore)(paths);
        const daemonRecord = await legacyStore.readDaemon();
        const lock = await readDaemonLockInfo(paths.daemonLockPath);
        if (!daemonRecord) {
            if (lock.pid && isProcessAlive(lock.pid)) {
                throw new Error(`daemon_migration_blocked: legacy daemon lock for profile ${profile.slug} belongs to live process ${lock.pid}; ownership cannot be proven.`);
            }
            if (lock.pid || lock.ownerId) {
                await quarantineLegacyDaemonPath(paths.daemonLockPath);
                entries.push({ profile: profile.slug, state: 'quarantined_lock_without_record' });
            }
            continue;
        }
        const ownership = await verifyDaemonProcessOwnership({
            daemonRecord,
            lockPath: paths.daemonLockPath,
        });
        if (ownership === 'unverified') {
            throw new Error(`daemon_migration_blocked: unable to verify legacy daemon ownership for profile ${profile.slug}, pid ${daemonRecord.pid}.`);
        }
        if (ownership === 'verified') {
            await stopRunningDaemon({ daemonRecord, lockPath: paths.daemonLockPath });
        }
        await quarantineLegacyDaemonPath(paths.daemonStatePath);
        await quarantineLegacyDaemonPath(paths.daemonLockPath);
        entries.push({
            profile: profile.slug,
            state: ownership === 'verified' ? 'stopped_and_quarantined' : 'quarantined_stale_record',
            pid: daemonRecord.pid,
            port: daemonRecord.port,
        });
    }
    if (entries.length > 0) {
        await writeDaemonMigrationSnapshot({ systemHomeDir, entries });
    }
}
async function ensureDaemonBaseUrl(context, options = {}) {
    const explicitBaseUrl = typeof context.env.METABOT_DAEMON_BASE_URL === 'string'
        ? context.env.METABOT_DAEMON_BASE_URL.trim()
        : '';
    if (explicitBaseUrl) {
        return normalizeBaseUrl(explicitBaseUrl);
    }
    const daemonRecord = await resolveDaemonRecord(context);
    if (daemonRecord) {
        const daemonPaths = (0, paths_1.resolveMetabotDaemonPaths)(normalizeSystemHomeDir(context.env, context.cwd));
        if (daemonRecord.baseUrl
            && await isDaemonReachable(daemonRecord.baseUrl, daemonRecord.ownerId)) {
            if (daemonConfigMatchesContext(daemonRecord, context)) {
                return daemonRecord.baseUrl;
            }
        }
        await stopRunningDaemon({ daemonRecord, lockPath: daemonPaths.daemonLockPath });
        return startDetachedDaemon(context, options);
    }
    return startDetachedDaemon(context, options);
}
async function startDetachedDaemon(context, options = {}) {
    const homeDir = normalizeHomeDir(context.env, context.cwd, options);
    const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
    const store = (0, daemonStateStore_1.createDaemonStateStore)(systemHomeDir);
    const expectedConfigHash = buildDaemonConfigHash(context.env);
    const persistedRecord = await store.readDaemon();
    if (!persistedRecord) {
        await migrateLegacyProfileDaemons(systemHomeDir);
    }
    const installation = await selectDaemonInstallation(context);
    const preferredPort = installation.port;
    if (persistedRecord) {
        const daemonPaths = (0, paths_1.resolveMetabotDaemonPaths)(systemHomeDir);
        if (persistedRecord.baseUrl
            && await isDaemonReachable(persistedRecord.baseUrl, persistedRecord.ownerId)) {
            if (daemonConfigMatchesContext(persistedRecord, context)) {
                return persistedRecord.baseUrl;
            }
        }
        await stopRunningDaemon({ daemonRecord: persistedRecord, lockPath: daemonPaths.daemonLockPath });
    }
    if (!persistedRecord && !await isPortBindable(installation.host, installation.port)) {
        throw new Error(`daemon_port_in_use: the configured daemon endpoint ${installation.host}:${installation.port} is occupied. Use an explicit port migration to change it.`);
    }
    await store.clearDaemon();
    const child = (0, node_child_process_1.spawn)(process.execPath, [resolveCliEntrypoint(), 'daemon', 'serve'], {
        cwd: systemHomeDir,
        detached: true,
        stdio: 'ignore',
        env: {
            ...context.env,
            HOME: systemHomeDir,
            METABOT_HOME: homeDir,
            ...(options.allowUnindexedExplicitHome ? { [ALLOW_UNINDEXED_HOME_ENV]: '1' } : {}),
            [DAEMON_PREFERRED_PORT_ENV]: String(preferredPort),
        },
    });
    child.unref();
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < DEFAULT_DAEMON_START_TIMEOUT_MS) {
        const daemonRecord = await store.readDaemon();
        if (daemonRecord?.baseUrl
            && normalizeEnvText(daemonRecord.configHash) === expectedConfigHash
            && await isDaemonReachable(daemonRecord.baseUrl, daemonRecord.ownerId)) {
            return daemonRecord.baseUrl;
        }
        await sleep(DAEMON_START_POLL_INTERVAL_MS);
    }
    const diagnostics = await (0, daemonStartupDiagnostics_1.collectDaemonStartupDiagnostics)({
        systemHomeDir,
        preferredPort,
    });
    throw new Error((0, daemonStartupDiagnostics_1.formatDaemonStartupTimeoutMessage)(diagnostics));
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
function createTestChainWriteSigner(baseSigner) {
    let writeCount = 0;
    return {
        getIdentity: () => baseSigner.getIdentity(),
        getPrivateChatIdentity: () => baseSigner.getPrivateChatIdentity(),
        writePin: async (rawInput) => {
            const request = (0, writePin_1.normalizeChainWriteRequest)(rawInput);
            const identity = await baseSigner.getIdentity();
            writeCount += 1;
            const isMetaAppWrite = request.path === '/protocols/metaapp'
                || request.path === '/protocols/paycomment'
                || request.path.startsWith('@');
            const pinDigest = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({
                writeCount,
                operation: request.operation,
                path: request.path,
                encryption: request.encryption,
                version: request.version,
                contentType: request.contentType,
                payload: request.payload,
                encoding: request.encoding,
                network: request.network,
                globalMetaId: identity.globalMetaId,
                mvcAddress: identity.mvcAddress,
            })).digest('hex');
            const legacyPinId = `${request.path || 'metaid'}-pin-${writeCount}`;
            const legacyTxid = `${request.path || 'metaid'}-tx-${writeCount}`;
            return {
                txids: [isMetaAppWrite ? pinDigest : legacyTxid],
                pinId: isMetaAppWrite ? `${pinDigest}i0` : legacyPinId,
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
function createCliSigner(context, homeDir) {
    const secretStore = (0, fileSecretStore_1.createFileSecretStore)(homeDir);
    const adapters = (0, registry_1.createDefaultChainAdapterRegistry)();
    const baseSigner = (0, localMnemonicSigner_1.createLocalMnemonicSigner)({ secretStore, adapters });
    if (context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1') {
        return createTestChainWriteSigner(baseSigner);
    }
    return baseSigner;
}
// Set while the daemon runtime is up (spec R5.3): chat turns that find no
// selectable runtime nudge this loop to re-probe their profile's store soon.
let activeLlmAvailabilityRecovery = null;
function createPrivateChatReplyRunnerForProfile(input) {
    return (0, hostLlmChatReplyRunner_1.createHostLlmChatReplyRunner)({
        runtimeResolver: input.runtimeResolver,
        llmExecutor: input.llmExecutor,
        metaBotSlug: input.metaBotSlug,
        chatWorkspaceDir: node_path_1.default.join(input.paths.profileRoot, '.runtime', 'private-chat-work'),
        requestAvailabilityRecovery: () => {
            activeLlmAvailabilityRecovery?.requestSoon(input.paths.profileRoot);
        },
        allowedChatSkillsResolver: (0, privateChatAllowedSkills_1.createPrivateChatAllowedSkillsResolver)({
            paths: input.paths,
            metaBotSlug: input.metaBotSlug,
            runtimeStore: input.runtimeStore,
            bindingStore: input.bindingStore,
            env: input.env,
            logWarning: input.logWarning,
        }),
        logWarning: input.logWarning,
    });
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
                const handled = await handler(replayMessage);
                if (!handled.ok) {
                    result.failed += 1;
                    input.logWarning?.('[A2A order replay handler]', new Error(`${handled.code || handled.state}: ${handled.message || 'ORDER handler returned a non-success result.'}`));
                    continue;
                }
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
// Buyer-side counterpart of replayUnhandledA2AOrderMessagesForProfiles: caller
// reply waits live in daemon memory, so a restart would otherwise strand paid
// orders in 'requesting_remote' with no timeout and no refund. Re-arm them (or
// settle already-expired waits straight into the timeout + refund path).
async function resumePendingA2ACallerReplyWaitsForProfiles(input) {
    const result = {
        profiles: 0,
        scanned: 0,
        armed: 0,
        timedOut: 0,
        skipped: 0,
        failed: 0,
    };
    const resume = input.resumeCallerReplyWait;
    if (!resume) {
        return result;
    }
    const listProfilesForResume = input.listProfiles ?? identityProfiles_1.listIdentityProfiles;
    const profiles = await listProfilesForResume(input.systemHomeDir).catch((error) => {
        input.logWarning?.('[A2A caller reply resume profiles]', error);
        return [];
    });
    const activeHomeDir = normalizeReplayText(input.activeHomeDir);
    for (const profile of profiles) {
        result.profiles += 1;
        const profileHomeDir = normalizeReplayText(profile.homeDir);
        const localProfileSlug = activeHomeDir && profileHomeDir && node_path_1.default.resolve(profileHomeDir) === node_path_1.default.resolve(activeHomeDir)
            ? null
            : profile.slug;
        try {
            const report = await resume({ localProfileSlug });
            result.scanned += Number(report?.scanned) || 0;
            result.armed += Number(report?.armed) || 0;
            result.timedOut += Number(report?.timedOut) || 0;
            result.skipped += Number(report?.skipped) || 0;
            result.failed += Number(report?.failed) || 0;
        }
        catch (error) {
            result.failed += 1;
            input.logWarning?.('[A2A caller reply resume]', error);
        }
    }
    return result;
}
function createPrivateChatAutoReplyProfileDispatcher(input) {
    const orchestrators = new Map();
    const createOrchestrator = input.createOrchestrator ?? privateChatAutoReply_1.createPrivateChatAutoReplyOrchestrator;
    async function getOrCreateOrchestrator(profile) {
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
                runtimeStore: profileRuntimeStoreForLlm,
                bindingStore: profileBindingStore,
                llmExecutor: input.llmExecutor,
            })
            : createPrivateChatReplyRunnerForProfile({
                paths: profilePaths,
                metaBotSlug,
                runtimeResolver: profileRuntimeResolver,
                runtimeStore: profileRuntimeStoreForLlm,
                bindingStore: profileBindingStore,
                llmExecutor: input.llmExecutor,
                env: process.env,
                logWarning: (scope, message) => console.warn(scope, message),
            });
        const profileGlobalMetaId = normalizeEnvText(profile.globalMetaId);
        // Use the live per-home config (the same object setAutoReply mutates) so a
        // runtime toggle-off is observed by this orchestrator immediately. Fall
        // back to the shared config when no resolver is wired (tests/legacy).
        const profileAutoReplyConfig = input.resolveAutoReplyConfigForHome
            ? await input.resolveAutoReplyConfigForHome(profileHomeDir)
            : input.autoReplyConfig;
        const concurrentlyCreated = orchestrators.get(cacheKey);
        if (concurrentlyCreated)
            return concurrentlyCreated;
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
            logSendFailure: (0, privateChatSendFailureLog_1.createPrivateChatSendFailureFileLogger)(profilePaths),
            hasActiveOrderWithPeer: (0, orderChatSuppression_1.createHasActiveOrderWithPeer)({
                runtimeStateStore: profileRuntimeStore,
                sessionStateStore: (0, sessionStateStore_1.createSessionStateStore)(profilePaths),
            }),
            chatSkillWaitNotice: (0, chatSkillWaitNotice_1.createChatSkillWaitNoticeGenerator)({
                runtimeResolver: profileRuntimeResolver,
                llmExecutor: input.llmExecutor,
                metaBotSlug,
            }),
        }, profileAutoReplyConfig);
        orchestrators.set(cacheKey, orchestrator);
        return orchestrator;
    }
    return {
        async retryPendingInboundMessage(profile, peerGlobalMetaId) {
            const orchestrator = await getOrCreateOrchestrator(profile);
            return orchestrator?.retryPendingInboundMessage(peerGlobalMetaId) ?? false;
        },
        async retryOutboundMessage(profile, peerGlobalMetaId, message) {
            const orchestrator = await getOrCreateOrchestrator(profile);
            return orchestrator?.retryOutboundMessage(peerGlobalMetaId, message) ?? false;
        },
        async handleInboundMessage(profile, message) {
            const orchestrator = await getOrCreateOrchestrator(profile);
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
async function resolvePeerChatPublicKeyFromLocalProfiles(systemHomeDir, globalMetaId) {
    const normalizedGlobalMetaId = normalizeEnvText(globalMetaId);
    if (!normalizedGlobalMetaId) {
        return null;
    }
    const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir).catch(() => []);
    for (const profile of profiles) {
        const profileGlobalMetaId = normalizeEnvText(profile.globalMetaId);
        const profileMatches = profileGlobalMetaId === normalizedGlobalMetaId;
        const runtimeState = await (0, runtimeStateStore_1.createRuntimeStateStore)(profile.homeDir).readState().catch(() => null);
        const runtimeIdentity = runtimeState?.identity ?? null;
        const runtimeIdentityMatches = normalizeEnvText(runtimeIdentity?.globalMetaId) === normalizedGlobalMetaId;
        if (profileMatches || runtimeIdentityMatches) {
            const runtimeChatPublicKey = normalizeEnvText(runtimeIdentity?.chatPublicKey);
            if (runtimeChatPublicKey) {
                return runtimeChatPublicKey;
            }
        }
        const secrets = await (0, fileSecretStore_1.createFileSecretStore)(profile.homeDir)
            .readIdentitySecrets()
            .catch(() => null);
        const secretGlobalMetaId = normalizeEnvText(secrets?.globalMetaId);
        const secretsMatch = secretGlobalMetaId === normalizedGlobalMetaId || (!secretGlobalMetaId && profileMatches);
        if (secretsMatch) {
            const secretChatPublicKey = normalizeEnvText(secrets?.chatPublicKey);
            if (secretChatPublicKey) {
                return secretChatPublicKey;
            }
        }
    }
    return null;
}
function createPeerChatPublicKeyResolver(input) {
    return async (globalMetaId) => {
        const normalizedGlobalMetaId = normalizeEnvText(globalMetaId);
        if (!normalizedGlobalMetaId) {
            return null;
        }
        const primary = input.fetchPeerChatPublicKey
            ? await input.fetchPeerChatPublicKey(normalizedGlobalMetaId)
            : await (0, defaultHandlers_1.fetchPeerChatPublicKey)(normalizedGlobalMetaId, {
                chainApiBaseUrl: input.chainApiBaseUrl,
            });
        const primaryChatPublicKey = normalizeEnvText(primary);
        if (primaryChatPublicKey) {
            return primaryChatPublicKey;
        }
        return resolvePeerChatPublicKeyFromLocalProfiles(input.systemHomeDir, normalizedGlobalMetaId);
    };
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
                artifacts: [],
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
    if (!input.confirm) {
        return (0, nativeWallet_1.previewWalletTransfer)({
            identity: state.identity,
            adapters,
            toAddress: input.toAddress,
            amountRaw: input.amountRaw,
        });
    }
    return (0, nativeWallet_1.confirmWalletTransfer)({
        identity: state.identity,
        adapters,
        toAddress: input.toAddress,
        amountRaw: input.amountRaw,
        secretStore: (0, fileSecretStore_1.createFileSecretStore)(homeDir),
    });
}
async function runHostPersonaProjection(operation) {
    try {
        return (0, commandResult_1.commandSuccess)(await operation());
    }
    catch (error) {
        if (error instanceof hostPersonaProjection_1.HostPersonaProjectionError) {
            return {
                ok: false,
                state: 'failed',
                code: error.code,
                message: error.message,
                data: error.data,
            };
        }
        return (0, commandResult_1.commandFailed)('host_persona_projection_failed', error instanceof Error ? error.message : String(error));
    }
}
function createDefaultCliDependencies(context) {
    async function requestJsonForSelectedActor(method, routePath, from, body) {
        const requestedFrom = normalizeEnvText(from);
        return requestJson(context, method, routePath, body && requestedFrom ? { ...body, from: requestedFrom } : body);
    }
    async function requestTextForSelectedActor(method, routePath, from) {
        return requestText(context, method, routePath);
    }
    async function openLocalUiPage(input) {
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
        if (input.mode)
            query.set('mode', input.mode);
        if (input.host)
            query.set('host', input.host);
        if (input.pinId)
            query.set('pinId', input.pinId);
        if (input.firstPinId)
            query.set('firstPinId', input.firstPinId);
        if (input.mine)
            query.set('mine', 'true');
        if (input.local)
            query.set('local', input.local);
        if (input.peer)
            query.set('peer', input.peer);
        const suffix = query.size ? `?${query.toString()}` : '';
        return (0, commandResult_1.commandSuccess)({
            page: input.page,
            localUiUrl: `${baseUrl}${resolveLocalUiPath(input.page)}${suffix}`,
        });
    }
    // Non-fatal resolve probe for metaapp:// opens. Broken app versions (for
    // example a pin whose MetaApp protocol lacks a content reference) otherwise
    // surface only as an error page inside the Browser; reporting the resolve
    // outcome in the envelope lets the agent skip to the next candidate. Other
    // schemes stay fire-and-forget so metaid/metafile/map opens are not slowed
    // by chain lookups.
    async function probeMetaAppResolve(uri) {
        const trimmed = uri.trim();
        if (!/^metaapp:\/\//iu.test(trimmed)) {
            return null;
        }
        const response = await requestJson(context, 'GET', `/api/browser/resolve?uri=${encodeURIComponent(trimmed)}`);
        if (!response.ok) {
            return {
                ok: false,
                code: response.code ?? 'browser_resolve_failed',
                message: response.message ?? 'MetaApp resolve failed.',
            };
        }
        const data = response.data ?? {};
        return {
            ok: true,
            ...(typeof data.title === 'string' && data.title ? { title: data.title } : {}),
        };
    }
    async function openLocalBrowserPage(input) {
        const baseUrl = await ensureDaemonBaseUrl(context);
        const browserPath = input.uri
            ? resolveLocalBrowserPath(input.uri)
            : '/browser';
        const resolve = input.uri ? await probeMetaAppResolve(input.uri) : null;
        return (0, commandResult_1.commandSuccess)({
            ...(input.uri ? { uri: input.uri } : {}),
            localUiUrl: `${baseUrl}${browserPath}`,
            ...(resolve ? { resolve } : {}),
        });
    }
    // Ask every currently-open Browser page to open a URI in a new tab. The daemon
    // fans the request out via the Browser tab SSE transport; ABC's client-only
    // AgentBrowserTabs.openTab performs the actual open. No tab id is returned —
    // tab ids are client-only and never reach the daemon.
    async function openBrowserTab(input) {
        const baseUrl = await readReachableDaemonBaseUrl(context);
        const resolve = await probeMetaAppResolve(input.uri);
        const response = await requestJson(context, 'POST', '/api/browser/tabs/open', { uri: input.uri });
        if (!response.ok) {
            return (0, commandResult_1.commandFailed)(response.code ?? 'browser_tab_open_failed', response.message ?? 'Browser tab open failed.');
        }
        const data = response.data ?? {};
        const resultUri = typeof data.uri === 'string' ? data.uri : input.uri;
        return (0, commandResult_1.commandSuccess)({
            uri: resultUri,
            // Same clickable path-form link as `browser open`/`browser link`, so the
            // agent never has to hand-build a Browser URL (preview-metaapp included).
            ...(baseUrl ? { localUiUrl: `${baseUrl}${resolveLocalBrowserPath(resultUri)}` } : {}),
            pagesReached: typeof data.pagesReached === 'number' ? data.pagesReached : 0,
            ...(data.note ? { note: data.note } : {}),
            ...(resolve ? { resolve } : {}),
        });
    }
    // Pure URI -> localUiUrl resolver for agents that need to render a clickable
    // http link for a deep-link URI (metaapp://, metaid://, metafile://, pin://,
    // map://, ...) without opening anything. Never starts a daemon: when no
    // daemon base URL is reachable the URI itself is returned without a link.
    async function resolveBrowserDeepLink(input) {
        const baseUrl = await readReachableDaemonBaseUrl(context);
        if (!baseUrl) {
            return (0, commandResult_1.commandSuccess)({ uri: input.uri });
        }
        return (0, commandResult_1.commandSuccess)({
            uri: input.uri,
            localUiUrl: `${baseUrl}${resolveLocalBrowserPath(input.uri)}`,
        });
    }
    // MetaApp aggregation search/forks run directly against the metaso-p2p API:
    // they are read-only and the only local state they need (the Bot registry
    // globalMetaIds behind `isOwn`) is readable from this process.
    async function listOwnGlobalMetaIds() {
        // Same local Bot registry that backs `bot list` (the daemon's
        // /api/bot/profiles handler builds its full profiles on these records).
        const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
        const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir).catch(() => []);
        return new Set(profiles
            .map((profile) => normalizeEnvText(profile.globalMetaId))
            .filter(Boolean));
    }
    function mapMetaAppSearchError(error) {
        if (error instanceof metaAppSearchApi_1.MetaAppSearchNotFoundError) {
            return (0, commandResult_1.commandFailed)('metaapp_not_found', error.message);
        }
        if (error instanceof metaAppSearchApi_1.MetaAppSearchApiError && error.apiCode === 40000) {
            return (0, commandResult_1.commandFailed)('invalid_argument', error.message);
        }
        const message = error instanceof Error ? error.message : String(error);
        return (0, commandResult_1.commandFailed)('metaapp_search_failed', message);
    }
    function readMetaAppSearchOptions() {
        const baseUrl = normalizeEnvText(context.env.METASO_P2P_BASE_URL);
        return baseUrl ? { baseUrl } : {};
    }
    function readPositiveField(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : undefined;
    }
    async function runMetaAppSearch(input) {
        try {
            const [page, ownGlobalMetaIds, daemonBaseUrl] = await Promise.all([
                (0, metaAppSearchApi_1.searchMetaApps)({
                    keyword: normalizeEnvText(typeof input.query === 'string' ? input.query : undefined) || undefined,
                    tag: normalizeEnvText(typeof input.tag === 'string' ? input.tag : undefined) || undefined,
                    chainName: normalizeEnvText(typeof input.chain === 'string' ? input.chain : undefined) || undefined,
                    runtime: normalizeEnvText(typeof input.runtime === 'string' ? input.runtime : undefined) || undefined,
                    publisher: normalizeEnvText(typeof input.publisher === 'string' ? input.publisher : undefined) || undefined,
                    since: readPositiveField(input.since),
                    until: readPositiveField(input.until),
                    size: readPositiveField(input.limit),
                    cursor: normalizeEnvText(typeof input.cursor === 'string' ? input.cursor : undefined) || undefined,
                }, readMetaAppSearchOptions()),
                listOwnGlobalMetaIds(),
                readReachableDaemonBaseUrl(context),
            ]);
            return (0, commandResult_1.commandSuccess)({
                items: withMetaAppCandidateLinks((0, metaAppSearchApi_1.trimMetaAppSearchItems)(page.items, ownGlobalMetaIds), daemonBaseUrl),
                hasMore: page.hasMore,
                nextCursor: page.nextCursor,
            });
        }
        catch (error) {
            return mapMetaAppSearchError(error);
        }
    }
    async function runMetaAppForks(input) {
        const pinId = normalizeEnvText(typeof input.pinId === 'string' ? input.pinId : undefined);
        if (!pinId) {
            return (0, commandResult_1.commandFailed)('invalid_argument', 'pinId is required to list MetaApp forks.');
        }
        try {
            const [page, ownGlobalMetaIds, daemonBaseUrl] = await Promise.all([
                (0, metaAppSearchApi_1.listMetaAppForks)({
                    pinId,
                    size: readPositiveField(input.limit),
                    cursor: normalizeEnvText(typeof input.cursor === 'string' ? input.cursor : undefined) || undefined,
                }, readMetaAppSearchOptions()),
                listOwnGlobalMetaIds(),
                readReachableDaemonBaseUrl(context),
            ]);
            return (0, commandResult_1.commandSuccess)({
                items: withMetaAppCandidateLinks((0, metaAppSearchApi_1.trimMetaAppSearchItems)(page.items, ownGlobalMetaIds), daemonBaseUrl),
                hasMore: page.hasMore,
                nextCursor: page.nextCursor,
            });
        }
        catch (error) {
            return mapMetaAppSearchError(error);
        }
    }
    // MetaID search/detail run directly against the metaso-p2p API, sharing the
    // MetaApp aggregation client conventions (same base URL env, same envelope)
    // and the same local Bot registry behind `isOwn`.
    function mapMetaIdSearchError(error) {
        if (error instanceof metaIdSearchApi_1.MetaIdSearchNotFoundError) {
            return (0, commandResult_1.commandFailed)('metaid_not_found', error.message);
        }
        if (error instanceof metaIdSearchApi_1.MetaIdSearchApiError && error.apiCode === 40000) {
            return (0, commandResult_1.commandFailed)('invalid_argument', error.message);
        }
        const message = error instanceof Error ? error.message : String(error);
        return (0, commandResult_1.commandFailed)('metaid_search_failed', message);
    }
    async function runMetaIdSearch(input) {
        try {
            const [page, ownGlobalMetaIds, daemonBaseUrl] = await Promise.all([
                (0, metaIdSearchApi_1.searchMetaIds)({
                    keyword: normalizeEnvText(typeof input.query === 'string' ? input.query : undefined) || undefined,
                    skill: normalizeEnvText(typeof input.skill === 'string' ? input.skill : undefined) || undefined,
                    chainName: normalizeEnvText(typeof input.chain === 'string' ? input.chain : undefined) || undefined,
                    hasChatPubkey: input.chatPubkey === true,
                    hasHomepage: input.homepage === true,
                    since: readPositiveField(input.since),
                    until: readPositiveField(input.until),
                    size: readPositiveField(input.limit),
                    cursor: normalizeEnvText(typeof input.cursor === 'string' ? input.cursor : undefined) || undefined,
                }, readMetaAppSearchOptions()),
                listOwnGlobalMetaIds(),
                readReachableDaemonBaseUrl(context),
            ]);
            return (0, commandResult_1.commandSuccess)({
                items: withMetaIdCandidateLinks((0, metaIdSearchApi_1.trimMetaIdSearchItems)(page.items, ownGlobalMetaIds), daemonBaseUrl),
                hasMore: page.hasMore,
                nextCursor: page.nextCursor,
            });
        }
        catch (error) {
            return mapMetaIdSearchError(error);
        }
    }
    async function runMetaIdDetail(input) {
        const identity = normalizeEnvText(typeof input.identity === 'string' ? input.identity : undefined);
        if (!identity) {
            return (0, commandResult_1.commandFailed)('invalid_argument', 'identity is required to read a MetaID detail.');
        }
        try {
            const [detail, daemonBaseUrl] = await Promise.all([
                (0, metaIdSearchApi_1.getMetaIdDetail)(identity, readMetaAppSearchOptions()),
                readReachableDaemonBaseUrl(context),
            ]);
            return (0, commandResult_1.commandSuccess)(withMetaIdDetailLinks(detail, daemonBaseUrl));
        }
        catch (error) {
            return mapMetaIdSearchError(error);
        }
    }
    // MetaApp source materialization runs in-process like search/forks: it is
    // read-only (download into the local artifact cache plus an optional
    // workspace copy) and shares the artifact cache with the daemon Browser
    // flow by using the same actor home directory.
    async function runMetaAppSource(input) {
        const pinId = normalizeEnvText(typeof input.pinId === 'string' ? input.pinId : undefined);
        if (!pinId) {
            return (0, commandResult_1.commandFailed)('invalid_argument', 'pinId is required to materialize MetaApp source.');
        }
        const actor = await resolveActorHomeDir(context, normalizeEnvText(typeof input.from === 'string' ? input.from : undefined) || undefined);
        if (!('homeDir' in actor)) {
            return actor;
        }
        // The indexer endpoints the daemon Browser adapter resolves pins and
        // metafile content against; they live in the infrastructure config.
        const infrastructure = await (0, infrastructureConfigStore_1.createInfrastructureConfigStore)(normalizeSystemHomeDir(context.env, context.cwd)).read();
        return (0, metaAppSource_1.materializeMetaAppSource)({
            pinId,
            ...(typeof input.outDir === 'string' && input.outDir.trim()
                ? { outDir: resolveRuntimeInputPath(context, input.outDir) }
                : {}),
        }, {
            homeDir: actor.homeDir,
            manApiBaseUrl: infrastructure.manApiBaseUrl,
            metafileContentBaseUrl: infrastructure.metafileContentBaseUrl,
        }).catch((error) => (0, commandResult_1.commandFailed)('metaapp_source_failed', error instanceof Error ? error.message : String(error)));
    }
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
        metaapp: {
            preview: async (input) => requestJsonForSelectedActor('POST', '/api/metaapp/preview', typeof input.from === 'string' ? input.from : undefined, {
                ...input,
                projectDir: typeof input.projectDir === 'string' ? resolveRuntimeInputPath(context, input.projectDir) : input.projectDir,
                manifestFile: typeof input.manifestFile === 'string' ? resolveRuntimeInputPath(context, input.manifestFile) : input.manifestFile,
            }),
            publish: async (input) => requestJsonForSelectedActor('POST', '/api/metaapp/publish', typeof input.from === 'string' ? input.from : undefined, input),
            update: async (input) => requestJsonForSelectedActor('POST', '/api/metaapp/update', typeof input.from === 'string' ? input.from : undefined, input),
            delete: async (input) => requestJsonForSelectedActor('POST', '/api/metaapp/delete', typeof input.from === 'string' ? input.from : undefined, input),
            list: async (input) => {
                const query = new URLSearchParams();
                if (typeof input.from === 'string') {
                    query.set('from', input.from);
                }
                if (typeof input.cursor === 'string') {
                    query.set('cursor', input.cursor);
                }
                if (typeof input.size === 'number') {
                    query.set('size', String(input.size));
                }
                if (input.refresh === true) {
                    query.set('refresh', 'true');
                }
                const suffix = query.size ? `?${query.toString()}` : '';
                return requestJsonForSelectedActor('GET', `/api/metaapp/list${suffix}`, typeof input.from === 'string' ? input.from : undefined);
            },
            publishProject: async (input) => requestJsonForSelectedActor('POST', '/api/metaapp/publish-project', typeof input.from === 'string' ? input.from : undefined, {
                ...input,
                projectDir: typeof input.projectDir === 'string' ? resolveRuntimeInputPath(context, input.projectDir) : input.projectDir,
                manifestFile: typeof input.manifestFile === 'string' ? resolveRuntimeInputPath(context, input.manifestFile) : input.manifestFile,
            }),
            updateProject: async (input) => requestJsonForSelectedActor('POST', '/api/metaapp/update-project', typeof input.from === 'string' ? input.from : undefined, {
                ...input,
                projectDir: typeof input.projectDir === 'string' ? resolveRuntimeInputPath(context, input.projectDir) : input.projectDir,
                manifestFile: typeof input.manifestFile === 'string' ? resolveRuntimeInputPath(context, input.manifestFile) : input.manifestFile,
            }),
            share: async (input) => requestJsonForSelectedActor('POST', '/api/metaapp/share', typeof input.from === 'string' ? input.from : undefined, input),
            view: async (input) => openLocalUiPage({
                page: 'apps',
                ...(typeof input.from === 'string' ? { from: input.from } : {}),
                ...(typeof input.pinId === 'string' ? { pinId: input.pinId } : {}),
                ...(typeof input.firstPinId === 'string' ? { firstPinId: input.firstPinId } : {}),
                ...(input.mine === true ? { mine: true } : {}),
            }),
            comment: async (input) => requestJsonForSelectedActor('POST', '/api/metaapp/comment', typeof input.from === 'string' ? input.from : undefined, input),
            search: async (input) => runMetaAppSearch(input),
            forks: async (input) => runMetaAppForks(input),
            source: async (input) => runMetaAppSource(input),
        },
        metaid: {
            search: async (input) => runMetaIdSearch(input),
            detail: async (input) => runMetaIdDetail(input),
        },
        buzz: {
            post: async (input) => requestJsonForSelectedActor('POST', '/api/buzz/post', typeof input.from === 'string' ? input.from : undefined, input),
        },
        browser: {
            open: async (input) => openLocalBrowserPage(input),
            tabOpen: async (input) => openBrowserTab(input),
            link: async (input) => resolveBrowserDeepLink(input),
        },
        chain: {
            write: async (input) => requestJsonForSelectedActor('POST', '/api/chain/write', typeof input.from === 'string' ? input.from : undefined, input),
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
                const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
                const daemonStore = (0, daemonStateStore_1.createDaemonStateStore)(systemHomeDir);
                const daemonRecord = await daemonStore.readDaemon();
                if (!daemonRecord || !daemonRecord.pid) {
                    return (0, commandResult_1.commandFailed)('daemon_not_running', 'No local daemon process is currently tracked.');
                }
                const pid = daemonRecord.pid;
                try {
                    const stopped = await stopRunningDaemon({
                        daemonRecord,
                        lockPath: (0, paths_1.resolveMetabotDaemonPaths)(systemHomeDir).daemonLockPath,
                    });
                    await daemonStore.clearDaemon(pid);
                    return (0, commandResult_1.commandSuccess)({
                        pid,
                        stopped: stopped === 'stopped',
                        alreadyStopped: stopped === 'already_stopped',
                    });
                }
                catch (error) {
                    if (error instanceof DaemonOwnershipVerificationError) {
                        return (0, commandResult_1.commandFailed)('daemon_ownership_unverified', error.message);
                    }
                    const code = error.code;
                    return (0, commandResult_1.commandFailed)('daemon_stop_failed', `Failed to stop daemon process ${pid}: ${code || error}`);
                }
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
                const twinHomeDir = await (0, twinRole_1.resolveTwinHomeDir)(systemHomeDir);
                let targetHomeDir = null;
                if (explicitHomeDir) {
                    const explicitState = await (0, runtimeStateStore_1.createRuntimeStateStore)(explicitHomeDir).readState();
                    const explicitName = normalizeEnvText(explicitState.identity?.name);
                    if (explicitName && explicitName !== normalizedName) {
                        return (0, commandResult_1.commandFailed)('identity_name_conflict', `Current local identity is "${explicitName}". Update that profile or choose the same name.`);
                    }
                    if (explicitState.identity || explicitHomeDir === twinHomeDir) {
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
                if (targetHomeDir) {
                    const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir);
                    const selectedProfile = profiles.find((profile) => (node_path_1.default.resolve(profile.homeDir) === node_path_1.default.resolve(targetHomeDir)));
                    if (selectedProfile) {
                        createInput.profileSlug = selectedProfile.slug;
                    }
                }
                return requestJson(cloneContextWithHomeDir(context, targetHomeDir), 'POST', '/api/identity/create', createInput, {
                    allowUnindexedExplicitHome: true,
                });
            },
            who: async () => {
                const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
                const twinHomeDir = await (0, twinRole_1.resolveTwinHomeDir)(systemHomeDir);
                if (!twinHomeDir) {
                    return (0, commandResult_1.commandFailed)('identity_profile_not_initialized', 'No Twin Bot initialized.');
                }
                const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir);
                const twinProfile = profiles.find((profile) => profile.homeDir === twinHomeDir);
                if (!twinProfile) {
                    return (0, commandResult_1.commandFailed)('identity_profile_not_initialized', 'No Twin Bot initialized.');
                }
                return (0, commandResult_1.commandSuccess)({
                    activeHomeDir: twinHomeDir,
                    systemHomeDir,
                    identity: {
                        name: twinProfile.name,
                        slug: twinProfile.slug,
                        aliases: twinProfile.aliases,
                        globalMetaId: twinProfile.globalMetaId,
                        mvcAddress: twinProfile.mvcAddress,
                    },
                });
            },
            list: async () => {
                const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
                const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir);
                const twinHomeDir = await (0, twinRole_1.resolveTwinHomeDir)(systemHomeDir);
                return (0, commandResult_1.commandSuccess)({
                    systemHomeDir,
                    activeHomeDir: twinHomeDir || null,
                    profiles,
                });
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
            publish: async (input) => requestJsonForSelectedActor('POST', '/api/services/publish', typeof input.from === 'string' ? input.from : undefined, input),
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
            call: async (input) => requestJsonForSelectedActor('POST', '/api/services/call', typeof input.from === 'string' ? input.from : undefined, input),
            rate: async (input) => requestJsonForSelectedActor('POST', '/api/services/rate', typeof input.from === 'string' ? input.from : undefined, input),
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
                return requestJsonForSelectedActor('GET', `/api/services/owned?${query.toString()}`, input.from);
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
                return requestJsonForSelectedActor('GET', `/api/services/owned/orders?${query.toString()}`, input.from);
            },
            modifyOwned: async (input) => requestJsonForSelectedActor('POST', '/api/services/owned/modify', typeof input.from === 'string' ? input.from : undefined, input),
            revokeOwned: async (input) => requestJsonForSelectedActor('POST', '/api/services/owned/revoke', typeof input.from === 'string' ? input.from : undefined, input),
            listRefunds: async (input) => {
                const query = new URLSearchParams();
                if (input.from) {
                    query.set('from', input.from);
                }
                query.set('all', input.all ? 'true' : 'false');
                query.set('kind', input.kind);
                return requestJsonForSelectedActor('GET', `/api/services/refunds?${query.toString()}`, input.from);
            },
            syncRefunds: async (input) => requestJsonForSelectedActor('POST', '/api/services/refunds/sync', typeof input.from === 'string' ? input.from : undefined, input),
            settleRefund: async (input) => requestJsonForSelectedActor('POST', '/api/services/refunds/settle', typeof input.from === 'string' ? input.from : undefined, input),
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
                return requestJsonForSelectedActor('GET', `/api/services/orders/inspect${suffix}`, input.from);
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
                return requestJsonForSelectedActor('GET', `/api/services/orders/inspect${suffix}`, input.from);
            },
            settleRefund: async (input) => requestJsonForSelectedActor('POST', '/api/services/refunds/settle', typeof input.from === 'string' ? input.from : undefined, input),
        },
        chat: {
            private: async (input) => {
                if (context.env[hostLlmChatReplyRunner_1.PRIVATE_CHAT_REPLY_GENERATION_ENV] === '1') {
                    return (0, commandResult_1.commandFailed)('private_chat_delivery_owned_by_orchestrator', 'Private-chat reply generation cannot send messages directly; Open Agent Connect owns delivery.');
                }
                return requestJsonForSelectedActor('POST', '/api/chat/private', typeof input.from === 'string' ? input.from : undefined, input);
            },
            conversations: async (input = {}) => {
                const params = new URLSearchParams();
                if (input.from)
                    params.set('from', input.from);
                const suffix = params.size ? `?${params.toString()}` : '';
                return requestJsonForSelectedActor('GET', `/api/chat/private/conversations${suffix}`, input.from);
            },
            messages: async (input) => {
                const params = new URLSearchParams({ conversationId: input.conversationId });
                if (input.limit != null)
                    params.set('limit', String(input.limit));
                if (input.from)
                    params.set('from', input.from);
                return requestJsonForSelectedActor('GET', `/api/chat/private/messages?${params.toString()}`, input.from);
            },
            autoReplyStatus: async (input = {}) => {
                const params = new URLSearchParams();
                if (input.from)
                    params.set('from', input.from);
                const suffix = params.size ? `?${params.toString()}` : '';
                return requestJsonForSelectedActor('GET', `/api/chat/auto-reply/status${suffix}`, input.from);
            },
            setAutoReply: async (input) => requestJsonForSelectedActor('POST', '/api/chat/auto-reply/config', typeof input.from === 'string' ? input.from : undefined, input),
        },
        grouptask: (() => {
            const post = (routePath) => async (input) => requestJsonForSelectedActor('POST', routePath, undefined, input);
            const get = (routePath) => async (input) => {
                const params = new URLSearchParams();
                for (const [key, value] of Object.entries(input)) {
                    if (value == null || value === '')
                        continue;
                    params.set(key, String(value));
                }
                const suffix = params.size ? `?${params.toString()}` : '';
                return requestJsonForSelectedActor('GET', `${routePath}${suffix}`, undefined);
            };
            return {
                create: post('/api/grouptask/create'),
                list: get('/api/grouptask/list'),
                detail: get('/api/grouptask/detail'),
                messages: get('/api/grouptask/messages'),
                postMessage: post('/api/grouptask/message'),
                close: post('/api/grouptask/close'),
                reopen: post('/api/grouptask/reopen'),
                kickMember: post('/api/grouptask/member/kick'),
                setMemberStatus: post('/api/grouptask/member/status'),
                rename: post('/api/grouptask/rename'),
                setPinned: post('/api/grouptask/pin'),
                setArchived: post('/api/grouptask/archive'),
                invite: post('/api/grouptask/invite'),
                invites: get('/api/grouptask/invites'),
                collabs: get('/api/grouptask/collabs'),
                collabMessages: get('/api/grouptask/collab-messages'),
            };
        })(),
        conversations: {
            list: async (input) => {
                const params = new URLSearchParams();
                if (input.local)
                    params.set('local', input.local);
                if (input.limit != null)
                    params.set('limit', String(input.limit));
                const suffix = params.size ? `?${params.toString()}` : '';
                return requestJsonForSelectedActor('GET', `/api/conversations${suffix}`, input.local);
            },
            messages: async (input) => {
                const params = new URLSearchParams();
                if (input.local)
                    params.set('local', input.local);
                if (input.peer)
                    params.set('peer', input.peer);
                if (input.limit != null)
                    params.set('limit', String(input.limit));
                if (input.before != null)
                    params.set('before', String(input.before));
                if (input.after != null)
                    params.set('after', String(input.after));
                const suffix = params.size ? `?${params.toString()}` : '';
                return requestJsonForSelectedActor('GET', `/api/conversations/messages${suffix}`, input.local);
            },
            guidance: async (input) => requestJsonForSelectedActor('POST', '/api/conversations/guidance', input.local, { local: input.local, peer: input.peer, guidance: input.guidance }),
        },
        memory: {
            list: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, memoryStore_1.createMemoryStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const entries = await store.list({
                    ...(input.scopeKind ? { scopeKind: input.scopeKind } : {}),
                    ...(input.scopeKey ? { scopeKey: input.scopeKey } : {}),
                    ...(input.usageClass ? { usageClass: input.usageClass } : {}),
                    ...(input.status ? { status: input.status } : {}),
                    ...(input.origin ? { origin: input.origin } : {}),
                    ...(input.query ? { query: input.query } : {}),
                    ...(input.limit !== undefined ? { limit: input.limit } : {}),
                    ...(input.includeDeleted ? { includeDeleted: true } : {}),
                });
                return (0, commandResult_1.commandSuccess)({ entries });
            },
            add: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, memoryStore_1.createMemoryStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const payload = input.payload;
                const memory = await store.create({
                    text: String(payload.text ?? ''),
                    ...(typeof payload.scopeKind === 'string' ? { scopeKind: payload.scopeKind } : {}),
                    ...(typeof payload.scopeKey === 'string' ? { scopeKey: payload.scopeKey } : {}),
                    ...(typeof payload.usageClass === 'string' ? { usageClass: payload.usageClass } : {}),
                    ...(typeof payload.visibility === 'string' ? { visibility: payload.visibility } : {}),
                    ...(typeof payload.confidence === 'number' ? { confidence: payload.confidence } : {}),
                    ...(typeof payload.isExplicit === 'boolean' ? { isExplicit: payload.isExplicit } : {}),
                    ...(typeof payload.origin === 'string' ? { origin: payload.origin } : {}),
                    ...(payload.source && typeof payload.source === 'object' && !Array.isArray(payload.source)
                        ? { source: payload.source }
                        : {}),
                });
                return (0, commandResult_1.commandSuccess)({ memory });
            },
            update: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, memoryStore_1.createMemoryStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const payload = input.payload;
                const memory = await store.update({
                    id: String(payload.id ?? ''),
                    ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
                    ...(typeof payload.scopeKind === 'string' ? { scopeKind: payload.scopeKind } : {}),
                    ...(typeof payload.scopeKey === 'string' ? { scopeKey: payload.scopeKey } : {}),
                    ...(typeof payload.usageClass === 'string' ? { usageClass: payload.usageClass } : {}),
                    ...(typeof payload.visibility === 'string' ? { visibility: payload.visibility } : {}),
                    ...(typeof payload.confidence === 'number' ? { confidence: payload.confidence } : {}),
                    ...(typeof payload.isExplicit === 'boolean' ? { isExplicit: payload.isExplicit } : {}),
                    ...(typeof payload.status === 'string' ? { status: payload.status } : {}),
                });
                if (!memory) {
                    return (0, commandResult_1.commandFailed)('not_found', 'Memory entry not found in the resolved scope (or it is protected).');
                }
                return (0, commandResult_1.commandSuccess)({ memory });
            },
            delete: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, memoryStore_1.createMemoryStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const deleted = await store.remove({
                    id: String(input.payload.id ?? ''),
                    ...(typeof input.payload.scopeKind === 'string' ? { scopeKind: input.payload.scopeKind } : {}),
                    ...(typeof input.payload.scopeKey === 'string' ? { scopeKey: input.payload.scopeKey } : {}),
                });
                if (!deleted) {
                    return (0, commandResult_1.commandFailed)('not_found', 'Memory entry not found in the resolved scope (or it is protected).');
                }
                return (0, commandResult_1.commandSuccess)({ deleted: true });
            },
            blocks: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const result = await (0, memoryService_1.buildMemoryBlocksForRequest)((0, paths_1.resolveMetabotPaths)(actor.homeDir), {
                    channel: typeof input.payload.channel === 'string' ? input.payload.channel : undefined,
                    peerGlobalMetaId: typeof input.payload.peerGlobalMetaId === 'string' ? input.payload.peerGlobalMetaId : undefined,
                    externalConversationId: typeof input.payload.externalConversationId === 'string'
                        ? input.payload.externalConversationId
                        : undefined,
                    userText: typeof input.payload.userText === 'string' ? input.payload.userText : undefined,
                });
                return (0, commandResult_1.commandSuccess)({
                    xml: result.xml,
                    resolutionReason: result.resolution.resolutionReason,
                    writeScope: result.resolution.writeScope,
                    memoryEnabled: result.policy.memoryEnabled,
                });
            },
            extract: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const result = await (0, memoryService_1.applyTurnMemoryExtraction)((0, paths_1.resolveMetabotPaths)(actor.homeDir), {
                    userText: String(input.payload.userText ?? ''),
                    assistantText: String(input.payload.assistantText ?? ''),
                    sessionId: typeof input.payload.sessionId === 'string' ? input.payload.sessionId : undefined,
                    channel: typeof input.payload.channel === 'string' ? input.payload.channel : undefined,
                    peerGlobalMetaId: typeof input.payload.peerGlobalMetaId === 'string' ? input.payload.peerGlobalMetaId : undefined,
                    externalConversationId: typeof input.payload.externalConversationId === 'string'
                        ? input.payload.externalConversationId
                        : undefined,
                    userMessageId: typeof input.payload.userMessageId === 'string' ? input.payload.userMessageId : undefined,
                    assistantMessageId: typeof input.payload.assistantMessageId === 'string' ? input.payload.assistantMessageId : undefined,
                });
                return (0, commandResult_1.commandSuccess)(result);
            },
            policyGet: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, memoryPolicy_1.createMemoryPolicyStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                return (0, commandResult_1.commandSuccess)({
                    effective: await store.effectivePolicy(),
                    override: await store.readOverride(),
                });
            },
            policySet: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, memoryPolicy_1.createMemoryPolicyStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const allowed = [
                    'memoryEnabled',
                    'memoryImplicitUpdateEnabled',
                    'memoryLlmJudgeEnabled',
                    'memoryGuardLevel',
                    'memoryUserMemoriesMaxItems',
                    'memoryPromptMaxChars',
                    'dreamEnabled',
                ];
                const updates = {};
                for (const key of allowed) {
                    if (input.payload[key] !== undefined)
                        updates[key] = input.payload[key];
                }
                const policy = await store.setOverride(updates);
                return (0, commandResult_1.commandSuccess)({ policy });
            },
            policyDelete: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, memoryPolicy_1.createMemoryPolicyStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                return (0, commandResult_1.commandSuccess)({ deleted: await store.deleteOverride() });
            },
            scopes: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, memoryStore_1.createMemoryStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                return (0, commandResult_1.commandSuccess)({ scopes: await store.listScopes() });
            },
            stats: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, memoryStore_1.createMemoryStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const stats = await store.stats({
                    ...(input.scopeKind ? { scopeKind: input.scopeKind } : {}),
                    ...(input.scopeKey ? { scopeKey: input.scopeKey } : {}),
                });
                return (0, commandResult_1.commandSuccess)({ stats });
            },
            transcriptAppend: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                await (0, transcriptStore_1.appendTranscriptTurn)((0, paths_1.resolveMetabotPaths)(actor.homeDir), {
                    sessionId: String(input.payload.sessionId ?? ''),
                    role: input.payload.role === 'assistant' ? 'assistant' : 'user',
                    text: String(input.payload.text ?? ''),
                    ts: typeof input.payload.ts === 'number' && Number.isFinite(input.payload.ts)
                        ? input.payload.ts
                        : Date.now(),
                    channel: typeof input.payload.channel === 'string' && input.payload.channel.trim()
                        ? input.payload.channel.trim()
                        : 'dsh',
                    ...(typeof input.payload.turn === 'number' && Number.isFinite(input.payload.turn)
                        ? { turn: input.payload.turn }
                        : {}),
                    ...(typeof input.payload.peerGlobalMetaId === 'string' && input.payload.peerGlobalMetaId.trim()
                        ? { peerGlobalMetaId: input.payload.peerGlobalMetaId.trim() }
                        : {}),
                });
                return (0, commandResult_1.commandSuccess)({ appended: true });
            },
            chats: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const chats = await (0, transcriptStore_1.listRecentChats)((0, paths_1.resolveMetabotPaths)(actor.homeDir), {
                    ...(input.limit !== undefined ? { limit: input.limit } : {}),
                    ...(input.sortOrder ? { sortOrder: input.sortOrder } : {}),
                });
                return (0, commandResult_1.commandSuccess)({ chats });
            },
            search: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const records = await (0, transcriptStore_1.searchConversations)((0, paths_1.resolveMetabotPaths)(actor.homeDir), {
                    query: String(input.payload.query ?? ''),
                    ...(typeof input.payload.maxResults === 'number' ? { maxResults: input.payload.maxResults } : {}),
                    ...(typeof input.payload.before === 'number' ? { before: input.payload.before } : {}),
                    ...(typeof input.payload.after === 'number' ? { after: input.payload.after } : {}),
                });
                return (0, commandResult_1.commandSuccess)({ records });
            },
            recall: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const paths = (0, paths_1.resolveMetabotPaths)(actor.homeDir);
                const dreamStore = (0, dreamStore_1.createDreamStore)(paths);
                const query = (0, experiencePromptBlocks_1.resolveExperienceRecallQuery)({
                    query: typeof input.payload.query === 'string' ? input.payload.query : undefined,
                    date_from: typeof input.payload.dateFrom === 'string' ? input.payload.dateFrom : undefined,
                    date_to: typeof input.payload.dateTo === 'string' ? input.payload.dateTo : undefined,
                    granularity: typeof input.payload.granularity === 'string'
                        ? input.payload.granularity
                        : undefined,
                    ...(typeof input.payload.limit === 'number' ? { limit: input.payload.limit } : {}),
                });
                const summaries = await dreamStore.searchDailySummaries({
                    query: query.query,
                    dateFrom: query.dateFrom,
                    dateTo: query.dateTo,
                    limit: query.limit,
                });
                let text;
                if (summaries.length > 0) {
                    text = (0, experiencePromptBlocks_1.formatExperienceRecallResults)(summaries.map((summary) => ({
                        summaryDate: summary.summaryDate,
                        summaryText: summary.summaryText,
                        sessionRefs: summary.sessionRefs,
                    })), query.granularity);
                }
                else {
                    // Raw-episode timeline fallback so un-dreamed days are never blind.
                    const experienceStore = (0, experienceStore_1.createExperienceStore)(paths);
                    const fromTime = query.dateFrom ? (0, dreamPrompt_1.getDayBoundsMs)(query.dateFrom).startMs : undefined;
                    const toTime = query.dateTo ? (0, dreamPrompt_1.getDayBoundsMs)(query.dateTo).endMs : undefined;
                    const episodes = await experienceStore.listEpisodes({
                        ...(fromTime !== undefined ? { fromTime } : {}),
                        ...(toTime !== undefined ? { toTime } : {}),
                        limit: 30,
                    });
                    text = (0, experiencePromptBlocks_1.formatExperienceTimelineFallback)({
                        dateFrom: query.dateFrom,
                        dateTo: query.dateTo,
                        episodes: episodes.map((episode) => ({
                            startedAt: episode.startedAt,
                            sourceChannel: episode.sourceChannel,
                            episodeType: episode.episodeType,
                            title: typeof episode.metadata.title === 'string' ? episode.metadata.title : null,
                        })),
                    });
                }
                return (0, commandResult_1.commandSuccess)({ text, summaries, query });
            },
            knowledgeList: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, knowledgeStore_1.createKnowledgeStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const entries = await store.listKnowledge({
                    ...(input.kind ? { kind: input.kind } : {}),
                    ...(input.category ? { category: input.category } : {}),
                    ...(input.status ? { status: input.status } : {}),
                    ...(input.query ? { query: input.query } : {}),
                    ...(input.limit !== undefined ? { limit: input.limit } : {}),
                });
                return (0, commandResult_1.commandSuccess)({ entries });
            },
            knowledgeUpsert: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, knowledgeStore_1.createKnowledgeStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const result = await store.upsertKnowledge({
                    topic: String(input.payload.topic ?? ''),
                    summary: String(input.payload.summary ?? ''),
                    ...(typeof input.payload.kind === 'string' ? { kind: input.payload.kind } : {}),
                    ...(typeof input.payload.category === 'string' ? { category: input.payload.category } : {}),
                    ...(Array.isArray(input.payload.tags)
                        ? { tags: input.payload.tags.filter((tag) => typeof tag === 'string') }
                        : {}),
                    ...(typeof input.payload.origin === 'string' ? { origin: input.payload.origin } : {}),
                    ...(Array.isArray(input.payload.sources)
                        ? { sources: input.payload.sources }
                        : {}),
                });
                return (0, commandResult_1.commandSuccess)({
                    entry: result.entry,
                    created: result.created,
                    revised: result.revised,
                    text: (0, knowledgePromptBlocks_1.formatKnowledgeUpsertResult)({
                        topic: result.entry.topic,
                        created: result.created,
                        revised: result.revised,
                        version: result.entry.version,
                        kind: result.entry.kind,
                    }),
                });
            },
            knowledgeUpdate: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, knowledgeStore_1.createKnowledgeStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const entry = await store.updateKnowledge({
                    id: String(input.payload.id ?? ''),
                    ...(typeof input.payload.topic === 'string' ? { topic: input.payload.topic } : {}),
                    ...(typeof input.payload.summary === 'string' ? { summary: input.payload.summary } : {}),
                    ...(typeof input.payload.kind === 'string' ? { kind: input.payload.kind } : {}),
                });
                if (!entry)
                    return (0, commandResult_1.commandFailed)('not_found', 'Knowledge entry not found.');
                return (0, commandResult_1.commandSuccess)({ entry });
            },
            knowledgeArchive: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, knowledgeStore_1.createKnowledgeStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const entry = await store.archiveKnowledge(String(input.payload.id ?? ''));
                if (!entry)
                    return (0, commandResult_1.commandFailed)('not_found', 'Knowledge entry not found.');
                return (0, commandResult_1.commandSuccess)({ entry });
            },
            knowledgeDelete: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, knowledgeStore_1.createKnowledgeStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const deleted = await store.deleteKnowledge(String(input.payload.id ?? ''));
                if (!deleted)
                    return (0, commandResult_1.commandFailed)('not_found', 'Knowledge entry not found.');
                return (0, commandResult_1.commandSuccess)({ deleted: true });
            },
            impressionsList: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const paths = (0, paths_1.resolveMetabotPaths)(actor.homeDir);
                const persona = await (0, chatPersonaLoader_1.loadChatPersona)(paths);
                const observerGlobalMetaId = persona.identity?.globalMetaId ?? '';
                if (!observerGlobalMetaId) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'No local MetaBot identity is loaded for this profile.');
                }
                const store = (0, impressionStore_1.createImpressionStore)(paths);
                const snapshots = await store.listSnapshots(observerGlobalMetaId);
                return (0, commandResult_1.commandSuccess)({ observerGlobalMetaId, snapshots });
            },
            impressionsShow: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const paths = (0, paths_1.resolveMetabotPaths)(actor.homeDir);
                const persona = await (0, chatPersonaLoader_1.loadChatPersona)(paths);
                const observerGlobalMetaId = persona.identity?.globalMetaId ?? '';
                if (!observerGlobalMetaId) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'No local MetaBot identity is loaded for this profile.');
                }
                const store = (0, impressionStore_1.createImpressionStore)(paths);
                const snapshot = await store.getSnapshot(observerGlobalMetaId, input.subject);
                const observations = await store.listObservations({
                    observerGlobalMetaId,
                    subjectGlobalMetaId: input.subject,
                    includeSuperseded: true,
                });
                return (0, commandResult_1.commandSuccess)({ observerGlobalMetaId, subject: input.subject, snapshot, observations });
            },
        },
        dream: {
            due: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const due = await (0, dreamService_1.dueDreamDates)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                return (0, commandResult_1.commandSuccess)(due);
            },
            status: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const status = await (0, dreamService_1.dreamStatus)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                return (0, commandResult_1.commandSuccess)(status);
            },
            plan: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                if (!input.date) {
                    return (0, commandResult_1.commandFailed)('missing_flag', '--date is required for dream plan.');
                }
                const limits = parseDreamLimits(input.payload);
                const plan = await (0, dreamService_1.planDream)((0, paths_1.resolveMetabotPaths)(actor.homeDir), {
                    date: input.date,
                    llm: typeof input.payload.llm === 'string' ? input.payload.llm : null,
                    limits,
                });
                return (0, commandResult_1.commandSuccess)(plan);
            },
            synthesize: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const fragmentOutputs = {};
                for (const [key, value] of Object.entries(input.payload.fragmentOutputs)) {
                    if (typeof value === 'string')
                        fragmentOutputs[key] = value;
                }
                const prompt = await (0, dreamService_1.synthesizeDream)((0, paths_1.resolveMetabotPaths)(actor.homeDir), {
                    date: String(input.payload.date),
                    llm: typeof input.payload.llm === 'string' ? input.payload.llm : null,
                    limits: parseDreamLimits(input.payload),
                    fragmentOutputs,
                });
                return (0, commandResult_1.commandSuccess)(prompt);
            },
            commit: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const result = await (0, dreamService_1.commitDream)((0, paths_1.resolveMetabotPaths)(actor.homeDir), {
                    date: String(input.payload.date),
                    outputText: String(input.payload.outputText ?? ''),
                    llm: typeof input.payload.llm === 'string' ? input.payload.llm : null,
                    isRepair: input.payload.isRepair === true,
                });
                if (!result.ok) {
                    return (0, commandResult_1.commandFailed)('dream_commit_failed', result.error ?? 'dream commit failed');
                }
                return (0, commandResult_1.commandSuccess)(result);
            },
            run: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const paths = (0, paths_1.resolveMetabotPaths)(actor.homeDir);
                const slug = node_path_1.default.basename(paths.profileRoot);
                const now = new Date();
                const date = input.date ?? (0, experiencePromptBlocks_1.formatLocalDate)(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
                const runtimeResolver = createCliLlmRuntimeResolver(paths);
                const executor = new executor_1.LlmExecutor({
                    sessionsRoot: paths.llmExecutorSessionsRoot,
                    transcriptsRoot: paths.llmExecutorTranscriptsRoot,
                    skillsRoot: paths.skillsRoot,
                    systemHomeDir: paths.systemHomeDir,
                    env: context.env,
                    backends: (0, executor_1.createRegistryBackendFactories)(),
                });
                const complete = async (request) => {
                    const resolved = await runtimeResolver.resolveRuntime({ metaBotSlug: slug });
                    if (!resolved.runtime) {
                        throw new Error('No LLM runtime binding available for this MetaBot. Bind one with "metabot llm" '
                            + 'or drive dreams from the DSH plugin (dream plan/commit with ctx.llm).');
                    }
                    return executor.execute({
                        runtimeId: resolved.runtime.id,
                        runtime: resolved.runtime,
                        prompt: request.user,
                        systemPrompt: request.system,
                        metaBotSlug: slug,
                        timeout: 180_000,
                        outputMode: 'final',
                    });
                };
                const result = await (0, dreamService_1.runDream)(paths, {
                    date,
                    llm: typeof input.payload.llm === 'string' ? input.payload.llm : null,
                    limits: parseDreamLimits(input.payload),
                    isRepair: input.payload.isRepair === true,
                }, complete);
                if (result.kind === 'failed') {
                    return (0, commandResult_1.commandFailed)('dream_run_failed', result.error ?? 'dream run failed');
                }
                return (0, commandResult_1.commandSuccess)(result);
            },
            summaries: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const dreamStore = (0, dreamStore_1.createDreamStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const summaries = await dreamStore.listDailySummaries({
                    ...(input.limit !== undefined ? { limit: input.limit } : {}),
                    ...(input.before ? { before: input.before } : {}),
                });
                return (0, commandResult_1.commandSuccess)({ summaries });
            },
            selfIdentity: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const memoryStore = (0, memoryStore_1.createMemoryStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const entries = await memoryStore.list({
                    usageClass: 'self_identity',
                    status: 'created',
                    limit: 1,
                });
                return (0, commandResult_1.commandSuccess)({
                    text: entries[0]?.text ?? '',
                    updatedAt: entries[0]?.updatedAt ?? null,
                });
            },
        },
        file: {
            upload: async (input) => requestJsonForSelectedActor('POST', '/api/file/upload', typeof input.from === 'string' ? input.from : undefined, input),
            uploadLarge: async (input) => requestJsonForSelectedActor('POST', '/api/file/upload-large', typeof input.from === 'string' ? input.from : undefined, input),
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
                return (0, nativeWallet_1.queryWalletBalances)({
                    identity: state.identity,
                    adapters,
                    chain: input.chain,
                });
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
                    ? requestJsonForSelectedActor('GET', `/api/trace/sessions/${encodeURIComponent(input.sessionId)}${suffix}`, input.from)
                    : requestJsonForSelectedActor('GET', `/api/trace/${encodeURIComponent(input.traceId || '')}${suffix}`, input.from);
            },
            watch: async (input) => {
                const query = new URLSearchParams();
                if (input.from)
                    query.set('from', input.from);
                const suffix = query.size ? `?${query.toString()}` : '';
                return requestTextForSelectedActor('GET', `/api/trace/${encodeURIComponent(input.traceId)}/watch${suffix}`, input.from);
            },
            listSessions: async (input) => {
                const query = new URLSearchParams({
                    all: input.all ? 'true' : 'false',
                    limit: String(input.limit),
                });
                if (input.from)
                    query.set('from', input.from);
                return requestJsonForSelectedActor('GET', `/api/trace/sessions?${query.toString()}`, input.from);
            },
        },
        ui: {
            open: async (input) => openLocalUiPage(input),
        },
        skills: {
            resolve: async (input) => {
                let rendered;
                try {
                    rendered = await renderSkillContractWithOnlineServiceContext({
                        context,
                        skill: input.skill,
                        host: input.host,
                        format: input.format,
                    });
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    if (/^Unknown base skill contract:/.test(message)) {
                        return (0, commandResult_1.commandFailed)('unknown_skill', message);
                    }
                    throw error;
                }
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
            bindPersona: async (input) => runHostPersonaProjection(() => (0, hostPersonaProjection_1.bindHostPersonaProjection)({
                systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
                host: input.host,
                from: input.from,
                env: context.env,
            })),
            personaStatus: async (input) => runHostPersonaProjection(() => (0, hostPersonaProjection_1.getHostPersonaProjectionStatus)({
                systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
                host: input.host,
                from: input.from,
                env: context.env,
            })),
            unbindPersona: async (input) => runHostPersonaProjection(() => (0, hostPersonaProjection_1.unbindHostPersonaProjection)({
                systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
                host: input.host,
                from: input.from,
                env: context.env,
            })),
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
                return requestJsonForSelectedActor('GET', `/api/llm/bindings/${encodeURIComponent(actor.slug)}`, input.from);
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
                return requestJsonForSelectedActor('PUT', `/api/llm/bindings/${encodeURIComponent(actor.slug)}`, input.from, { bindings });
            },
            removeBinding: async (input) => {
                const actor = await resolveActorProfileSlug(context, { from: input.from });
                if (!('slug' in actor))
                    return actor;
                const query = new URLSearchParams({ from: actor.slug });
                return requestJsonForSelectedActor('DELETE', `/api/llm/bindings/${encodeURIComponent(input.bindingId)}/delete?${query.toString()}`, input.from);
            },
            getPreferredRuntime: async (input = {}) => {
                const actor = await resolveActorProfileSlug(context, input);
                if (!('slug' in actor))
                    return actor;
                return requestJsonForSelectedActor('GET', `/api/llm/preferred-runtime/${encodeURIComponent(actor.slug)}`, input.from);
            },
            setPreferredRuntime: async (input) => {
                const actor = await resolveActorProfileSlug(context, input);
                if (!('slug' in actor))
                    return actor;
                return requestJsonForSelectedActor('PUT', `/api/llm/preferred-runtime/${encodeURIComponent(actor.slug)}`, input.from, { runtimeId: input.runtimeId });
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
                return requestJsonForSelectedActor('GET', `/api/bot/runtimes${suffix}`, input.from);
            },
            discoverRuntimes: async (input = {}) => {
                const query = new URLSearchParams();
                if (input.from)
                    query.set('from', input.from);
                const suffix = query.size ? `?${query.toString()}` : '';
                return requestJsonForSelectedActor('POST', `/api/bot/runtimes/discover${suffix}`, input.from);
            },
            listSessions: async (input) => {
                const query = new URLSearchParams({ limit: String(input.limit) });
                if (input.slug)
                    query.set('slug', input.slug);
                return requestJson(context, 'GET', `/api/bot/sessions?${query.toString()}`);
            },
            bindOwner: async (input) => {
                let ownerGlobalMetaId = typeof input.ownerGlobalMetaId === 'string' && input.ownerGlobalMetaId.trim()
                    ? input.ownerGlobalMetaId.trim()
                    : '';
                if (!input.unbind && !ownerGlobalMetaId) {
                    // Default owner: the local human owner identity first, then the
                    // Twin Bot identity as a fallback.
                    const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
                    const ownerIdentity = await (0, ownerIdentity_1.readOwnerIdentity)(systemHomeDir).catch(() => null);
                    ownerGlobalMetaId = ownerIdentity?.globalMetaId?.trim() ?? '';
                    if (!ownerGlobalMetaId) {
                        const [profiles, twinHomeDir] = await Promise.all([
                            (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir).catch(() => []),
                            (0, twinRole_1.resolveTwinHomeDir)(systemHomeDir),
                        ]);
                        const twin = profiles.find((profile) => profile.homeDir === twinHomeDir);
                        ownerGlobalMetaId = twin?.globalMetaId?.trim() ?? '';
                    }
                    if (!ownerGlobalMetaId) {
                        return (0, commandResult_1.commandFailed)('identity_unavailable', 'No local owner identity or Twin Bot with a GlobalMetaID. Pass --owner <globalMetaId> explicitly.');
                    }
                }
                return requestJson(context, 'PUT', `/api/bot/profiles/${encodeURIComponent(input.slug)}`, { ownerGlobalMetaId: input.unbind ? null : ownerGlobalMetaId });
            },
        },
        twin: {
            current: async () => {
                const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
                const twinSlug = await (0, twinRole_2.resolveCurrentTwinSlug)(systemHomeDir);
                return (0, commandResult_1.commandSuccess)({ twinSlug });
            },
            workers: async (input) => {
                const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
                let twinSlug = input.from?.trim() ?? '';
                if (!twinSlug) {
                    twinSlug = await (0, twinRole_2.resolveCurrentTwinSlug)(systemHomeDir) ?? '';
                }
                if (!twinSlug) {
                    return (0, commandResult_1.commandFailed)('twin_not_found', 'No Twin Bot exists yet. Designate one with: metabot bot update --from <bot-slug> --payload-file <file> (payload: {"botType":"twin"}).');
                }
                const roster = await (0, twinRole_2.buildTwinWorkerRoster)(systemHomeDir, twinSlug);
                return (0, commandResult_1.commandSuccess)({
                    twinSlug,
                    workers: roster,
                    rosterBlock: (0, twinRole_2.formatTwinWorkerRosterBlock)(roster),
                });
            },
            tasksCreate: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, orchestrationStore_1.createOrchestrationStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const payload = input.payload;
                const task = await store.createTask({
                    title: String(payload.title ?? ''),
                    goal: typeof payload.goal === 'string' ? payload.goal : '',
                    ...(typeof payload.intent === 'string' ? { intent: payload.intent } : {}),
                    ...(typeof payload.ownerGlobalMetaId === 'string' ? { ownerGlobalMetaId: payload.ownerGlobalMetaId } : {}),
                    ...(Array.isArray(payload.steps)
                        ? {
                            steps: payload.steps.map((step) => ({
                                workerSlug: String(step.workerSlug ?? ''),
                                objective: typeof step.objective === 'string' ? step.objective : '',
                                ...(Array.isArray(step.acceptanceCriteria)
                                    ? { acceptanceCriteria: step.acceptanceCriteria.filter((item) => typeof item === 'string') }
                                    : {}),
                                ...(step.permissionScope && typeof step.permissionScope === 'object' && !Array.isArray(step.permissionScope)
                                    ? { permissionScope: step.permissionScope }
                                    : {}),
                                ...(Array.isArray(step.dependsOn)
                                    ? { dependsOn: step.dependsOn.filter((item) => typeof item === 'string') }
                                    : {}),
                                ...(typeof step.idempotencyKey === 'string' ? { idempotencyKey: step.idempotencyKey } : {}),
                            })),
                        }
                        : {}),
                });
                return (0, commandResult_1.commandSuccess)({ task });
            },
            tasksList: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, orchestrationStore_1.createOrchestrationStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const tasks = await store.listTasks({
                    ...(input.status ? { status: input.status } : {}),
                    ...(input.limit !== undefined ? { limit: input.limit } : {}),
                });
                return (0, commandResult_1.commandSuccess)({ tasks });
            },
            tasksShow: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, orchestrationStore_1.createOrchestrationStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const task = await store.getTask(input.taskId);
                if (!task)
                    return (0, commandResult_1.commandFailed)('not_found', `Orchestration task not found: ${input.taskId}`);
                return (0, commandResult_1.commandSuccess)({ task });
            },
            tasksUpdate: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, orchestrationStore_1.createOrchestrationStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const payload = input.payload;
                const taskId = String(payload.taskId ?? '');
                if (payload.taskStatus) {
                    const task = await store.updateTaskStatus(taskId, payload.taskStatus);
                    if (!task)
                        return (0, commandResult_1.commandFailed)('not_found', `Orchestration task not found: ${taskId}`);
                    return (0, commandResult_1.commandSuccess)({ task });
                }
                if (payload.markNotified === true && payload.stepId && payload.attemptId) {
                    await store.markAttemptNotified(taskId, String(payload.stepId), String(payload.attemptId));
                    return (0, commandResult_1.commandSuccess)({ notified: true });
                }
                if (payload.newAttempt === true && payload.stepId) {
                    const attempt = await store.addAttempt(taskId, String(payload.stepId), {
                        ...(typeof payload.dshSessionId === 'string' ? { dshSessionId: payload.dshSessionId } : {}),
                    });
                    if (!attempt)
                        return (0, commandResult_1.commandFailed)('not_found', 'Orchestration step not found.');
                    return (0, commandResult_1.commandSuccess)({ attempt });
                }
                if (payload.stepId && payload.attemptId) {
                    const attempt = await store.updateAttempt(taskId, String(payload.stepId), String(payload.attemptId), {
                        ...(typeof payload.attemptStatus === 'string' ? { status: payload.attemptStatus } : {}),
                        ...(typeof payload.dshSessionId === 'string' ? { dshSessionId: payload.dshSessionId } : {}),
                        ...(typeof payload.handoff === 'string' ? { handoff: payload.handoff } : {}),
                        ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
                    });
                    if (!attempt)
                        return (0, commandResult_1.commandFailed)('not_found', 'Orchestration attempt not found.');
                    return (0, commandResult_1.commandSuccess)({ attempt });
                }
                if (payload.stepId) {
                    const step = await store.updateStep(taskId, String(payload.stepId), {
                        ...(typeof payload.stepStatus === 'string' ? { status: payload.stepStatus } : {}),
                        ...(typeof payload.workerSlug === 'string' ? { workerSlug: payload.workerSlug } : {}),
                    });
                    if (!step)
                        return (0, commandResult_1.commandFailed)('not_found', 'Orchestration step not found.');
                    return (0, commandResult_1.commandSuccess)({ step });
                }
                return (0, commandResult_1.commandFailed)('invalid_payload', 'payload must carry taskStatus, stepId(+attemptId), or markNotified.');
            },
            tasksPendingNotify: async (input) => {
                const actor = await resolveActorHomeDir(context, input.from);
                if (!('homeDir' in actor))
                    return actor;
                const store = (0, orchestrationStore_1.createOrchestrationStore)((0, paths_1.resolveMetabotPaths)(actor.homeDir));
                const pending = await store.listUnnotifiedTerminalAttempts();
                return (0, commandResult_1.commandSuccess)({
                    pending: pending.map(({ task, step, attempt }) => ({
                        taskId: task.id,
                        taskTitle: task.title,
                        taskStatus: task.status,
                        stepId: step.id,
                        workerSlug: step.workerSlug,
                        attemptId: attempt.id,
                        attemptStatus: attempt.status,
                        handoff: attempt.handoff,
                        error: attempt.error,
                        endedAt: attempt.endedAt,
                    })),
                });
            },
        },
    };
}
function mergeCliDependencies(context) {
    const defaults = createDefaultCliDependencies(context);
    const provided = context.dependencies;
    return {
        config: { ...defaults.config, ...provided.config },
        buzz: { ...defaults.buzz, ...provided.buzz },
        browser: { ...defaults.browser, ...provided.browser },
        metaapp: { ...defaults.metaapp, ...provided.metaapp },
        metaid: { ...defaults.metaid, ...provided.metaid },
        chain: { ...defaults.chain, ...provided.chain },
        daemon: { ...defaults.daemon, ...provided.daemon },
        doctor: { ...defaults.doctor, ...provided.doctor },
        identity: { ...defaults.identity, ...provided.identity },
        network: { ...defaults.network, ...provided.network },
        services: { ...defaults.services, ...provided.services },
        provider: { ...defaults.provider, ...provided.provider },
        chat: { ...defaults.chat, ...provided.chat },
        grouptask: { ...defaults.grouptask, ...provided.grouptask },
        conversations: { ...defaults.conversations, ...provided.conversations },
        memory: { ...defaults.memory, ...provided.memory },
        dream: { ...defaults.dream, ...provided.dream },
        twin: { ...defaults.twin, ...provided.twin },
        file: { ...defaults.file, ...provided.file },
        wallet: { ...defaults.wallet, ...provided.wallet },
        trace: { ...defaults.trace, ...provided.trace },
        ui: { ...defaults.ui, ...provided.ui },
        skills: { ...defaults.skills, ...provided.skills },
        host: { ...defaults.host, ...provided.host },
        system: { ...defaults.system, ...provided.system },
        llm: { ...defaults.llm, ...provided.llm },
        bot: { ...defaults.bot, ...provided.bot },
    };
}
async function serveCliDaemonProcess(context) {
    const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
    const homeDir = normalizeHomeDir(context.env, context.cwd, {
        allowUnindexedExplicitHome: context.env[ALLOW_UNINDEXED_HOME_ENV] === '1',
    });
    const paths = (0, paths_1.resolveMetabotPaths)(homeDir);
    const daemonPaths = (0, paths_1.resolveMetabotDaemonPaths)(systemHomeDir);
    const infrastructureConfigStore = (0, infrastructureConfigStore_1.createInfrastructureConfigStore)(daemonPaths);
    const daemonStore = (0, daemonStateStore_1.createDaemonStateStore)(daemonPaths);
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
    const resolvePeerChatPublicKey = createPeerChatPublicKeyResolver({
        systemHomeDir: paths.systemHomeDir,
        fetchPeerChatPublicKey,
        chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
    });
    const callerReplyWaiter = createTestMetaWebReplyWaiter(context.env);
    const servicePaymentExecutor = context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
        ? (0, servicePayment_1.createTestServicePaymentExecutor)()
        : undefined;
    const socketPresenceApiBaseUrl = context.env.METABOT_SOCKET_PRESENCE_API_BASE_URL
        || (context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1' ? 'http://127.0.0.1:9' : undefined);
    const persistedAutoReplyConfig = await (0, configStore_1.createConfigStore)(paths).read().then((config) => config.autoReply, () => null);
    const sharedAutoReplyConfig = {
        enabled: persistedAutoReplyConfig ? persistedAutoReplyConfig.enabled : true,
        acceptPolicy: 'accept_all',
        defaultStrategyId: null,
        maxTurns: persistedAutoReplyConfig ? persistedAutoReplyConfig.maxTurns : configTypes_1.DEFAULT_AUTO_REPLY_MAX_TURNS,
        cooldownMs: persistedAutoReplyConfig ? persistedAutoReplyConfig.cooldownMs : configTypes_1.DEFAULT_AUTO_REPLY_COOLDOWN_MS,
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
    const daemonMetaBotSlug = node_path_1.default.basename(paths.profileRoot);
    const daemonRuntimeResolver = (0, llmRuntimeResolver_1.createLlmRuntimeResolver)({
        runtimeStore: (0, llmRuntimeStore_1.createLlmRuntimeStore)(paths),
        bindingStore: (0, llmBindingStore_1.createLlmBindingStore)(paths),
        getPreferredRuntimeId: async () => {
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
    const buyerRatingHostReplyRunner = (0, hostLlmChatReplyRunner_1.createHostLlmChatReplyRunner)({
        runtimeResolver: daemonRuntimeResolver,
        llmExecutor,
        metaBotSlug: daemonMetaBotSlug,
    });
    const buyerRatingReplyRunner = createTestBuyerRatingReplyRunner(context.env) ?? buyerRatingHostReplyRunner;
    const orderProtocolTextGenerator = (0, orderProtocolTextGenerator_1.createLlmOrderProtocolTextGenerator)({
        llmExecutor,
        timeoutMs: 45_000,
    });
    let pendingA2ASimplemsgRefreshAfterIdentityRegistration = false;
    let refreshA2ASimplemsgListenerAfterIdentityRegistration = async () => {
        pendingA2ASimplemsgRefreshAfterIdentityRegistration = true;
    };
    let refreshA2ASimplemsgListenerAfterInfrastructureChange = async () => { };
    let onProviderPresenceChanged = async () => { };
    const handlers = (0, defaultHandlers_1.createDefaultMetabotDaemonHandlers)({
        homeDir,
        systemHomeDir,
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
        fetchPeerChatPublicKey: resolvePeerChatPublicKey,
        callerReplyWaiter,
        buyerRatingReplyRunner,
        buyerRatingTextGenerator: orderProtocolTextGenerator.generateBuyerRatingText,
        callerOrderTextGenerator: orderProtocolTextGenerator.generateCallerOrderText,
        providerOrderTextGenerator: orderProtocolTextGenerator.generateProviderOrderText,
        servicePaymentExecutor,
        serviceOrderPaymentVerifier: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
            ? async (verificationInput) => ({
                verified: true,
                outcome: 'verified',
                paymentTxid: verificationInput.paymentTxid ?? null,
                paymentChain: verificationInput.paymentChain === 'btc'
                    ? 'btc'
                    : verificationInput.paymentChain === 'mvc'
                        ? 'mvc'
                        : null,
                settlementKind: verificationInput.settlementKind === 'free' ? 'free' : 'native',
                paymentAddress: verificationInput.paymentAddress ?? null,
                amount: verificationInput.amount,
                currency: verificationInput.currency,
                amountSatoshis: Math.round(Number(verificationInput.amount) * 100_000_000),
                matchedOutputIndex: verificationInput.paymentTxid ? 0 : null,
                failureKind: null,
            })
            : undefined,
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
        onProviderPresenceChanged: (enabled) => onProviderPresenceChanged(enabled),
        onIdentityProfileRegistered: () => refreshA2ASimplemsgListenerAfterIdentityRegistration(),
        onBrowserInfrastructureChanged: () => refreshA2ASimplemsgListenerAfterInfrastructureChange(),
    });
    const daemon = (0, daemon_1.createMetabotDaemon)({
        homeDirOrPaths: paths,
        daemonPaths,
        handlers,
    });
    const installation = await selectDaemonInstallation(context);
    const started = await daemon.start(installation.port, installation.host);
    const runtimeStore = (0, runtimeStateStore_1.createRuntimeStateStore)(paths);
    const providerPresenceStore = (0, providerPresenceState_1.createProviderPresenceStateStore)(paths);
    daemonRecord = await daemonStore.writeDaemon({
        schemaVersion: 1,
        instanceId: 'default',
        ownerId: daemon.ownerId,
        pid: process.pid,
        host: started.host,
        port: started.port,
        baseUrl: started.baseUrl,
        oacVersion: version_1.CLI_VERSION,
        runtimeFingerprint: getDaemonRuntimeFingerprint(),
        supervisor: {
            kind: 'none',
            serviceId: null,
        },
        startedAt: Date.now(),
        configHash: buildDaemonConfigHash(context.env),
    });
    const onlineServiceCacheStore = (0, onlineServiceCache_1.createOnlineServiceCacheStore)(paths);
    const ratingDetailStateStore = (0, ratingDetailState_1.createRatingDetailStateStore)(paths);
    const refreshOnlineServiceCache = async () => {
        const infrastructure = await infrastructureConfigStore.read();
        const configuredPresenceApiBaseUrl = socketPresenceApiBaseUrl
            || (0, metasoInfrastructure_1.resolveMetasoInfrastructureEndpoints)(infrastructure.metasoP2PBaseUrl).socketPresenceApiBaseUrl;
        await (0, onlineServiceCacheSync_1.refreshOnlineServiceCacheFromChain)({
            store: onlineServiceCacheStore,
            ratingDetailStateStore,
            chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
            socketPresenceApiBaseUrl: configuredPresenceApiBaseUrl,
            socketPresenceFailureMode: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
                ? 'assume_service_providers_online'
                : 'throw',
            resolvePeerChatPublicKey,
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
    // Reclaim abandoned provider run workspaces (crashed daemons never reach
    // the terminal cleanup); terminal orders remove their own workspace.
    const sweepProviderWorkspaces = () => (0, providerWorkspaceCleanup_1.sweepProviderRunWorkspaces)({
        projectRoot: paths.profileRoot,
    }).catch((error) => {
        console.warn('[provider workspace sweep]', error instanceof Error ? error.message : String(error));
    });
    void sweepProviderWorkspaces();
    const providerWorkspaceSweepInterval = setInterval(() => {
        void sweepProviderWorkspaces();
    }, providerWorkspaceCleanup_1.PROVIDER_RUN_WORKSPACE_SWEEP_INTERVAL_MS);
    providerWorkspaceSweepInterval.unref?.();
    const serviceRefundSyncLoop = createServiceRefundSyncLoop({
        syncRefunds: async () => {
            const result = await handlers.services?.syncRefunds?.({});
            if (result && !result.ok) {
                throw new Error(result.message ?? result.code ?? 'service_refund_sync_failed');
            }
        },
        logWarning: (message) => console.warn(message),
    });
    // Buyer-side order deadline enforcement (IDBots 60s scanTimedOutOrders
    // parity): the socket waiter settles deliveries fast, but only this cheap
    // local sweep fails orders that breach the first-response deadline. The
    // refund sync loop above also runs the same sweep inline.
    const buyerOrderDeadlineSweepInterval = setInterval(() => {
        void Promise.resolve(handlers.sweepBuyerOrderDeadlines?.()).catch((error) => {
            console.warn('[buyer order deadline sweep]', error instanceof Error ? error.message : String(error));
        });
    }, orderLifecycle_1.SERVICE_ORDER_DEADLINE_SWEEP_INTERVAL_MS);
    buyerOrderDeadlineSweepInterval.unref?.();
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
    if (context.env[TEST_SKIP_BACKGROUND_LLM_DISCOVERY_ENV] !== '1') {
        void (async () => {
            const previous = await llmRuntimeStore.read();
            const result = await (0, llmRuntimeDiscovery_1.discoverLlmRuntimes)({ env: context.env, knownRuntimes: previous.runtimes });
            for (const runtime of result.runtimes) {
                await llmRuntimeStore
                    .upsertRuntime(runtime, { preserveRecentHealthyOnDetected: true })
                    .catch(() => { });
            }
        })().catch(() => { });
    }
    // Availability recovery loop (spec R4): trickle re-probes of
    // detected/degraded/cooldown-expired runtimes across the host store and
    // every indexed profile store, so a runtime that failed readiness once
    // becomes selectable again without waiting for a manual rediscovery.
    // Tests that skip background LLM discovery skip this loop as well.
    if (context.env[TEST_SKIP_BACKGROUND_LLM_DISCOVERY_ENV] !== '1') {
        const llmAvailabilityRecovery = (0, llmAvailabilityRecovery_1.createLlmAvailabilityRecovery)({
            env: context.env,
            listTargetHomes: async () => {
                const homes = [node_path_1.default.resolve(homeDir)];
                const profiles = await (0, identityProfiles_1.listIdentityProfiles)(systemHomeDir).catch(() => []);
                for (const profile of profiles) {
                    const profileHome = typeof profile.homeDir === 'string' ? node_path_1.default.resolve(profile.homeDir) : '';
                    if (profileHome && !homes.includes(profileHome)) {
                        homes.push(profileHome);
                    }
                }
                return homes;
            },
            isStoreBusy: (targetHomeDir) => (0, defaultHandlers_1.llmDiscoverySweepRunningForHomeDir)(targetHomeDir),
            logger: (message, error) => console.warn(message, error ?? ''),
        });
        activeLlmAvailabilityRecovery = llmAvailabilityRecovery;
        llmAvailabilityRecovery.start();
    }
    const chatStateStore = (0, privateChatStateStore_1.createPrivateChatStateStore)(paths);
    const chatStrategyStore = (0, chatStrategyStore_1.createChatStrategyStore)(paths);
    const chatAutoReplyOrchestrator = (0, privateChatAutoReply_1.createPrivateChatAutoReplyOrchestrator)({
        stateStore: chatStateStore,
        strategyStore: chatStrategyStore,
        paths,
        signer,
        logSendFailure: (0, privateChatSendFailureLog_1.createPrivateChatSendFailureFileLogger)(paths),
        selfGlobalMetaId: async () => {
            const state = await runtimeStore.readState();
            return state.identity?.globalMetaId ?? null;
        },
        resolvePeerChatPublicKey,
        replyRunner: createPrivateChatReplyRunnerForProfile({
            paths,
            metaBotSlug,
            runtimeResolver: llmResolver,
            runtimeStore: llmRuntimeStore,
            bindingStore: llmBindingStore,
            llmExecutor,
            env: process.env,
            logWarning: (scope, message) => console.warn(scope, message),
        }),
        hasActiveOrderWithPeer: (0, orderChatSuppression_1.createHasActiveOrderWithPeer)({
            runtimeStateStore: runtimeStore,
            sessionStateStore: (0, sessionStateStore_1.createSessionStateStore)(paths),
        }),
        chatSkillWaitNotice: (0, chatSkillWaitNotice_1.createChatSkillWaitNoticeGenerator)({
            runtimeResolver: llmResolver,
            llmExecutor,
            metaBotSlug,
        }),
    }, sharedAutoReplyConfig);
    const profileAutoReplyDispatcher = createPrivateChatAutoReplyProfileDispatcher({
        autoReplyConfig: sharedAutoReplyConfig,
        resolvePeerChatPublicKey,
        llmExecutor,
        // Wire the live per-home config resolver so each profile orchestrator reads
        // the same object that handlers.chat.setAutoReply mutates. Without this,
        // toggling Auto-Reply off in /ui/bot (or via the CLI) for a non-Twin Bot
        // would be ignored — the orchestrator would keep reading the daemon-default
        // shared config.
        resolveAutoReplyConfigForHome: (homeDir) => handlers.resolveAutoReplyConfigForHome(homeDir),
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
    let peerDiscoverySnapshot = null;
    let peerDiscoverySnapshotPending = null;
    const loadPeerDiscoverySnapshot = async () => {
        if (peerDiscoverySnapshot && peerDiscoverySnapshot.expiresAt > Date.now()) {
            return peerDiscoverySnapshot;
        }
        if (peerDiscoverySnapshotPending)
            return peerDiscoverySnapshotPending;
        peerDiscoverySnapshotPending = (async () => {
            const profiles = await (0, identityProfiles_1.listIdentityProfiles)(paths.systemHomeDir).catch(() => []);
            const [knownPeers, localProjectedPeerIndex] = await Promise.all([
                Promise.all(profiles.map(async (candidate) => {
                    const runtimeState = await (0, runtimeStateStore_1.createRuntimeStateStore)(candidate.homeDir)
                        .readState()
                        .catch(() => null);
                    return {
                        globalMetaId: normalizeEnvText(runtimeState?.identity?.globalMetaId || candidate.globalMetaId),
                        chatPublicKey: normalizeEnvText(runtimeState?.identity?.chatPublicKey),
                    };
                })),
                (0, privateChatPeerDiscovery_1.buildLocalA2AProjectedPeerIndex)(profiles),
            ]);
            const snapshot = {
                expiresAt: Date.now() + 30_000,
                knownPeers: knownPeers.filter((candidate) => candidate.globalMetaId),
                localProjectedPeerIndex,
            };
            peerDiscoverySnapshot = snapshot;
            return snapshot;
        })();
        try {
            return await peerDiscoverySnapshotPending;
        }
        finally {
            peerDiscoverySnapshotPending = null;
        }
    };
    const peerDirectoryCache = new Map();
    const peerDirectoryPending = new Map();
    const peerDirectoryLanes = Array.from({ length: 4 }, () => Promise.resolve());
    let nextPeerDirectoryLane = 0;
    const readCachedPeerDirectory = (selfGlobalMetaId, knownPeers) => {
        const key = normalizeEnvText(selfGlobalMetaId).toLowerCase();
        const cached = peerDirectoryCache.get(key);
        if (!key || (cached && cached.expiresAt > Date.now())) {
            return cached?.peers ?? [];
        }
        if (!peerDirectoryPending.has(key)) {
            const laneIndex = nextPeerDirectoryLane % peerDirectoryLanes.length;
            nextPeerDirectoryLane += 1;
            const request = peerDirectoryLanes[laneIndex].then(async () => {
                const infrastructure = await infrastructureConfigStore.read();
                const chatApiBaseUrl = (0, metasoInfrastructure_1.resolveMetasoInfrastructureEndpoints)(infrastructure.metasoP2PBaseUrl).chatApiBaseUrl;
                return (0, privateConversation_1.fetchPrivateChatPeerGlobalMetaIds)({
                    selfGlobalMetaId,
                    knownPeers,
                    chatApiBaseUrl,
                    timeoutMs: 10_000,
                });
            });
            peerDirectoryLanes[laneIndex] = request.then(() => undefined, () => undefined);
            peerDirectoryPending.set(key, request);
            void request.then((peers) => {
                peerDirectoryCache.set(key, { peers, expiresAt: Date.now() + 60_000 });
            }).catch((error) => {
                peerDirectoryCache.set(key, { peers: cached?.peers ?? [], expiresAt: Date.now() + 30_000 });
                console.warn(`[private chat peer directory:${key}]`, error instanceof Error ? error.message : String(error));
            }).finally(() => {
                peerDirectoryPending.delete(key);
            });
        }
        return cached?.peers ?? [];
    };
    const chatAutoReplyBackfill = (0, privateChatAutoReplyBackfill_1.createPrivateChatAutoReplyBackfillProfileManager)({
        systemHomeDir: paths.systemHomeDir,
        createLoop: (profile) => {
            const profilePaths = (0, paths_1.resolveMetabotPaths)(profile.homeDir);
            const profileRuntimeStore = (0, runtimeStateStore_1.createRuntimeStateStore)(profilePaths);
            const profileBaseSigner = (0, localMnemonicSigner_1.createLocalMnemonicSigner)({
                secretStore: (0, fileSecretStore_1.createFileSecretStore)(profile.homeDir),
                adapters,
            });
            const profileSigner = node_path_1.default.resolve(profile.homeDir) === node_path_1.default.resolve(homeDir)
                ? signer
                : context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
                    ? createTestChainWriteSigner(profileBaseSigner)
                    : profileBaseSigner;
            return (0, privateChatAutoReplyBackfill_1.createPrivateChatAutoReplyBackfillLoop)({
                paths: profilePaths,
                stateStore: (0, privateChatStateStore_1.createPrivateChatStateStore)(profilePaths),
                selfGlobalMetaId: async () => {
                    const state = await profileRuntimeStore.readState().catch(() => null);
                    return state?.identity?.globalMetaId || profile.globalMetaId || null;
                },
                getLocalPrivateChatIdentity: async () => profileSigner.getPrivateChatIdentity(),
                resolvePeerChatPublicKey,
                resolveChatApiBaseUrl: async () => {
                    const infrastructure = await infrastructureConfigStore.read();
                    return (0, metasoInfrastructure_1.resolveMetasoInfrastructureEndpoints)(infrastructure.metasoP2PBaseUrl).chatApiBaseUrl;
                },
                listPeerGlobalMetaIds: async (selfGlobalMetaId) => {
                    const snapshot = await loadPeerDiscoverySnapshot();
                    const localProjectedPeers = snapshot.localProjectedPeerIndex.get(normalizeEnvText(selfGlobalMetaId).toLowerCase()) ?? [];
                    const directoryPeers = readCachedPeerDirectory(selfGlobalMetaId, snapshot.knownPeers);
                    return [...localProjectedPeers, ...directoryPeers];
                },
                handleInboundMessage: async (message) => {
                    if (node_path_1.default.resolve(profile.homeDir) === node_path_1.default.resolve(homeDir)) {
                        await chatAutoReplyOrchestrator.handleInboundMessage(message);
                        return;
                    }
                    await profileAutoReplyDispatcher.handleInboundMessage(profile, message);
                },
                recoverOutboundMessage: async (peerGlobalMetaId, message) => {
                    if (node_path_1.default.resolve(profile.homeDir) === node_path_1.default.resolve(homeDir)) {
                        return chatAutoReplyOrchestrator.retryOutboundMessage(peerGlobalMetaId, message);
                    }
                    return profileAutoReplyDispatcher.retryOutboundMessage(profile, peerGlobalMetaId, message);
                },
                recoverInboundReply: async (peerGlobalMetaId) => {
                    if (node_path_1.default.resolve(profile.homeDir) === node_path_1.default.resolve(homeDir)) {
                        return chatAutoReplyOrchestrator.retryPendingInboundMessage(peerGlobalMetaId);
                    }
                    return profileAutoReplyDispatcher.retryPendingInboundMessage(profile, peerGlobalMetaId);
                },
                onError: (error) => {
                    console.warn(`[private chat auto-reply backfill:${profile.slug}]`, error.message);
                },
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
        resolveSocketEndpoints: async () => [
            (0, metasoInfrastructure_1.resolveMetasoInfrastructureEndpoints)((await infrastructureConfigStore.read()).metasoP2PBaseUrl).socket,
        ],
        resolvePeerChatPublicKey,
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
    const readConfiguredSocketPresence = async () => {
        const infrastructure = await infrastructureConfigStore.read();
        const apiBaseUrl = socketPresenceApiBaseUrl
            || (0, metasoInfrastructure_1.resolveMetasoInfrastructureEndpoints)(infrastructure.metasoP2PBaseUrl).socketPresenceApiBaseUrl;
        return (0, socketPresenceDirectory_1.readOnlineMetaBotsFromSocketPresence)({ apiBaseUrl, limit: 100 });
    };
    const simplemsgPresenceWatchdog = (0, simplemsgPresenceWatchdog_1.createA2ASimplemsgPresenceWatchdog)({
        manager: simplemsgListener,
        readOnlineMetaBots: readConfiguredSocketPresence,
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
    refreshA2ASimplemsgListenerAfterIdentityRegistration = async () => {
        const currentConfig = await (0, configStore_1.createConfigStore)(paths).read().catch(() => daemonConfig);
        const providerPresence = await providerPresenceStore.read().catch(() => ({ enabled: true }));
        await refreshA2ASimplemsgListenerForIdentityProfileRegistration({
            enabled: currentConfig.a2a.simplemsgListenerEnabled && providerPresence.enabled,
            listener: simplemsgListener,
            backfill: chatAutoReplyBackfill,
            watchdog: simplemsgPresenceWatchdog,
        });
    };
    refreshA2ASimplemsgListenerAfterInfrastructureChange = async () => {
        const currentConfig = await (0, configStore_1.createConfigStore)(paths).read().catch(() => daemonConfig);
        const providerPresence = await providerPresenceStore.read().catch(() => ({ enabled: true }));
        await refreshA2ASimplemsgListenerForIdentityProfileRegistration({
            enabled: currentConfig.a2a.simplemsgListenerEnabled && providerPresence.enabled,
            listener: simplemsgListener,
            backfill: chatAutoReplyBackfill,
            watchdog: simplemsgPresenceWatchdog,
        });
        void refreshOnlineServiceCache().catch((error) => {
            console.warn('[online service cache] infrastructure refresh failed:', error instanceof Error ? error.message : String(error));
        });
    };
    onProviderPresenceChanged = async (enabled) => {
        const currentConfig = await (0, configStore_1.createConfigStore)(paths).read().catch(() => daemonConfig);
        await (0, configStore_1.createConfigStore)(paths).set({
            ...currentConfig,
            a2a: {
                ...currentConfig.a2a,
                simplemsgListenerEnabled: enabled,
            },
        });
        if (!enabled) {
            simplemsgPresenceWatchdog.stop();
            simplemsgListener.stop();
            chatAutoReplyBackfill.stop();
            return;
        }
        await refreshA2ASimplemsgListenerForIdentityProfileRegistration({
            enabled: true,
            listener: simplemsgListener,
            backfill: chatAutoReplyBackfill,
            watchdog: simplemsgPresenceWatchdog,
        });
    };
    const providerPresence = await providerPresenceStore.read();
    if (daemonConfig.a2a.simplemsgListenerEnabled && providerPresence.enabled) {
        await simplemsgListener.start();
        simplemsgPresenceWatchdog.start();
        await chatAutoReplyBackfill.start();
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
    // Resident App/Game Runtime (browser.app.session.*): restore persisted
    // sessions, re-validate grants, catch up history, acquire leases, and start
    // the group chat socket listener. Independent of the private chat listener
    // config; sessions must survive MetaApp page close and daemon restarts.
    try {
        const appSessionReport = await handlers.startAppSessionRuntime?.();
        if (appSessionReport) {
            console.log(`[app-session runtime] restored ${appSessionReport.restored} sessions: `
                + `${appSessionReport.running} running, ${appSessionReport.paused} paused, `
                + `${appSessionReport.stopped} stopped, ${appSessionReport.conflicts} lease conflicts`);
        }
    }
    catch (error) {
        console.warn('[app-session runtime] start failed:', error instanceof Error ? error.message : String(error));
    }
    // Group Task engine: 5s ticker that drives every non-terminal group task
    // chaired by a local profile (message sync, tag side effects, chair/worker
    // LLM turns, stall heartbeat). Cheap when no tasks exist — the tick only
    // reads local profile state files.
    const groupTaskEngine = (0, engine_1.createGroupTaskEngine)({
        ctx: (0, grouptaskHandlers_1.createGroupTaskServiceContext)({
            systemHomeDir,
            createSignerForProfileHome: (profileHomeDir) => (profileHomeDir === homeDir
                ? signer
                : (0, localMnemonicSigner_1.createLocalMnemonicSigner)({ secretStore: (0, fileSecretStore_1.createFileSecretStore)(profileHomeDir), adapters })),
            adapters,
            resolvePeerChatPublicKey,
            log: (message) => console.warn(message),
        }),
        runLlmTurn: async (turn) => {
            const profilePaths = (0, paths_1.resolveMetabotPaths)(turn.profile.homeDir);
            const runtimeResolver = (0, llmRuntimeResolver_1.createLlmRuntimeResolver)({
                runtimeStore: (0, llmRuntimeStore_1.createLlmRuntimeStore)(profilePaths),
                bindingStore: (0, llmBindingStore_1.createLlmBindingStore)(profilePaths),
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
            const result = await (0, llmRuntimeExecution_1.runLlmPromptWithRuntimeFallback)({
                runtimeResolver,
                llmExecutor,
                metaBotSlug: turn.profile.slug,
                prompt: turn.prompt,
                systemPrompt: turn.systemPrompt,
                timeoutMs: 120_000,
                pollIntervalMs: 500,
            });
            if (result.status !== 'completed') {
                throw new Error(result.error || `Group task LLM turn ended with status ${result.status}`);
            }
            return result.output;
        },
    });
    groupTaskEngine.start();
    // Buyer-side boot recovery: caller reply waits are in-memory only, so re-arm
    // them (with their remaining budget) or settle expired waits into the
    // timeout + refund path. Runs even when the simplemsg listener is disabled —
    // the refund safety net must not depend on inbound listener config.
    void resumePendingA2ACallerReplyWaitsForProfiles({
        systemHomeDir: paths.systemHomeDir,
        activeHomeDir: homeDir,
        resumeCallerReplyWait: (input) => handlers.resumePendingCallerReplyContinuations(input),
        logWarning: (scope, error) => {
            console.warn(scope, error instanceof Error ? error.message : String(error));
        },
    }).catch((error) => {
        console.warn('[A2A caller reply resume]', error instanceof Error ? error.message : String(error));
    });
    if (pendingA2ASimplemsgRefreshAfterIdentityRegistration) {
        pendingA2ASimplemsgRefreshAfterIdentityRegistration = false;
        await refreshA2ASimplemsgListenerAfterIdentityRegistration();
    }
    let shuttingDown = false;
    const shutdown = async (exitCode) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        simplemsgPresenceWatchdog.stop();
        simplemsgListener.stop();
        chatAutoReplyBackfill.stop();
        groupTaskEngine.stop();
        try {
            await handlers.stopAppSessionRuntime?.();
        }
        catch (error) {
            console.warn('[app-session runtime] shutdown failed:', error instanceof Error ? error.message : String(error));
        }
        clearInterval(onlineServiceCacheInterval);
        clearInterval(providerWorkspaceSweepInterval);
        serviceRefundSyncLoop.stop();
        let shutdownFailure = null;
        try {
            await daemon.close();
        }
        catch (error) {
            shutdownFailure = error;
        }
        try {
            await daemonStore.clearDaemon(process.pid);
        }
        catch (error) {
            shutdownFailure ??= error;
        }
        if (shutdownFailure) {
            console.error(shutdownFailure);
            process.exit(1);
            return;
        }
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
