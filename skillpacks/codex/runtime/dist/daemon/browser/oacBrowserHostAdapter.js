"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOacBrowserHostAdapter = createOacBrowserHostAdapter;
const node_path_1 = __importDefault(require("node:path"));
const metabotProfileManager_1 = require("../../core/bot/metabotProfileManager");
const config_1 = require("../../core/browser/config");
const browserResolver_1 = require("../../core/browser/browserResolver");
const metaAppPinResolver_1 = require("../../core/browser/metaAppPinResolver");
const settings_1 = require("../../core/browser/settings");
const configStore_1 = require("../../core/config/configStore");
const commandResult_1 = require("../../core/contracts/commandResult");
const llmTypes_1 = require("../../core/llm/llmTypes");
const artifactCache_1 = require("../../core/metaapp/artifactCache");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizePreferredCreateHost(value) {
    const provider = normalizeText(value);
    return provider && provider !== 'custom' && (0, llmTypes_1.isLlmProvider)(provider) ? provider : null;
}
function actorSelector(input) {
    return normalizeText(input?.actorId) || normalizeText(input?.from);
}
function buildMetaAppPreviewAssetUrl(previewId, assetPath) {
    const encodedPreviewId = encodeURIComponent(previewId);
    const normalizedAssetPath = assetPath
        .split('/')
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    return `/api/metaapp/preview-assets/${encodedPreviewId}/${normalizedAssetPath}`;
}
function browserActorCapabilities(profile) {
    const capabilities = ['template-settings'];
    if (normalizeText(profile.globalMetaId)) {
        capabilities.unshift('private-chat', 'service-call', 'message-view');
    }
    return capabilities;
}
function profileToBrowserActor(profile, selectedHomeDir) {
    const isDefault = Boolean(selectedHomeDir && node_path_1.default.resolve(profile.homeDir) === selectedHomeDir);
    return {
        id: profile.slug,
        label: profile.name,
        kind: 'oac-bot',
        globalMetaId: profile.globalMetaId,
        ...(profile.avatarDataUrl ? { avatar: profile.avatarDataUrl } : {}),
        isDefault,
        capabilities: browserActorCapabilities(profile),
    };
}
function toBrowserRecord(value) {
    return { ...value };
}
function readActionPayload(input) {
    return input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
        ? input.payload
        : {};
}
function trustedActionResultData(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const source = value;
    const data = {};
    for (const key of ['href', 'route', 'copiedText', 'message']) {
        const field = source[key];
        if (typeof field === 'string' && field) {
            data[key] = field;
        }
    }
    return Object.keys(data).length ? data : undefined;
}
function ownerActorIdFromPayload(payload) {
    return normalizeText(payload.ownerActorId);
}
function botManagementHref(slug, tab, focus) {
    const query = new URLSearchParams({ profile: slug, tab, focus });
    return `/ui/bot?${query.toString()}`;
}
function findProfileByHomeDir(profiles, homeDir) {
    const resolvedHomeDir = node_path_1.default.resolve(homeDir);
    return profiles.find((profile) => node_path_1.default.resolve(profile.homeDir) === resolvedHomeDir) ?? null;
}
function conversationHref(localGlobalMetaId, peerGlobalMetaId) {
    const query = new URLSearchParams({
        local: localGlobalMetaId,
        peer: peerGlobalMetaId,
    });
    return `/ui/conversations?${query.toString()}`;
}
function createBotHref(env) {
    const query = new URLSearchParams({ mode: 'create' });
    const host = normalizePreferredCreateHost(env.METABOT_HOST) ?? normalizePreferredCreateHost(env.OAC_HOST);
    if (host)
        query.set('host', host);
    return `/ui/bot?${query.toString()}`;
}
function wrapTrustedActionResult(kind, result) {
    if (!result.ok) {
        return result;
    }
    return {
        ...result,
        data: {
            kind,
            handled: true,
            data: trustedActionResultData(result.data),
        },
    };
}
function createOacBrowserHostAdapter(input) {
    const env = input.env ?? process.env;
    const fetchImpl = input.fetch ?? globalThis.fetch;
    async function resolveActor(actorInput) {
        return input.resolveActorWriteContext(actorSelector(actorInput));
    }
    async function getRuntime(runtimeInput = {}) {
        const requestedActor = actorSelector(runtimeInput);
        const activeHomeDir = node_path_1.default.resolve(input.homeDir);
        const profiles = await (0, metabotProfileManager_1.listMetabotProfiles)(input.systemHomeDir).catch(() => []);
        const selectedProfile = requestedActor
            ? profiles.find((profile) => profile.slug === requestedActor) ?? null
            : profiles.find((profile) => node_path_1.default.resolve(profile.homeDir) === activeHomeDir) ?? profiles[0] ?? null;
        if (requestedActor && !selectedProfile) {
            return (0, commandResult_1.commandFailed)('profile_not_found', `MetaBot profile not found: ${requestedActor}`);
        }
        const selectedHomeDir = selectedProfile ? node_path_1.default.resolve(selectedProfile.homeDir) : '';
        const actors = profiles.map((profile) => profileToBrowserActor(profile, selectedHomeDir));
        const defaultActor = selectedProfile
            ? actors.find((actor) => actor.id === selectedProfile.slug) ?? null
            : null;
        return (0, commandResult_1.commandSuccess)({
            host: {
                kind: 'oac',
                name: 'Open Agent Connect',
                localMode: true,
            },
            actors,
            defaultActor,
            defaultUri: defaultActor?.globalMetaId ? `metaid://${defaultActor.globalMetaId}` : null,
            features: {
                privateChat: true,
                serviceCall: true,
                cacheManagement: true,
                templateSettings: true,
                walletLogin: false,
            },
            labels: {
                actorChip: 'Using',
                noActorTitle: 'Create your first Bot',
                noActorBody: 'Your local Agent needs a Bot identity before it can appear on the Agent Internet.',
                noActorAction: {
                    label: 'Create Bot',
                    href: createBotHref(env),
                },
            },
        });
    }
    async function getSettings(settingsInput = {}) {
        const actor = await resolveActor(settingsInput);
        if ('failure' in actor)
            return actor.failure;
        const targetConfigStore = (0, configStore_1.createConfigStore)(actor.homeDir);
        const config = await targetConfigStore.read();
        return (0, commandResult_1.commandSuccess)((0, settings_1.createBrowserSettingsSnapshot)({
            config,
            configPath: targetConfigStore.paths.configPath,
            env,
        }));
    }
    async function updateSettings(settingsInput) {
        const actor = await resolveActor(settingsInput);
        if ('failure' in actor)
            return actor.failure;
        const targetConfigStore = (0, configStore_1.createConfigStore)(actor.homeDir);
        const current = await targetConfigStore.read();
        try {
            const next = (0, settings_1.applyBrowserSettingsUpdate)(current, settingsInput.browser);
            await targetConfigStore.set(next);
            const saved = await targetConfigStore.read();
            return (0, commandResult_1.commandSuccess)((0, settings_1.createBrowserSettingsSnapshot)({
                config: saved,
                configPath: targetConfigStore.paths.configPath,
                env,
            }));
        }
        catch (error) {
            return (0, commandResult_1.commandFailed)('invalid_argument', error instanceof Error ? error.message : String(error));
        }
    }
    async function getCache(cacheInput = {}) {
        const actor = await resolveActor(cacheInput);
        if ('failure' in actor)
            return actor.failure;
        const stats = await (0, artifactCache_1.createMetaAppArtifactCacheStore)(actor.homeDir).getStats();
        return (0, commandResult_1.commandSuccess)(toBrowserRecord(stats));
    }
    async function clearCache(cacheInput) {
        const actor = await resolveActor(cacheInput);
        if ('failure' in actor)
            return actor.failure;
        try {
            const scope = normalizeText(cacheInput.scope) || 'all';
            if (scope === 'pin') {
                const result = await (0, artifactCache_1.createMetaAppArtifactCacheStore)(actor.homeDir).clear({
                    scope,
                    pinId: normalizeText(cacheInput.pinId),
                });
                return (0, commandResult_1.commandSuccess)(toBrowserRecord(result));
            }
            if (scope === 'artifact') {
                const result = await (0, artifactCache_1.createMetaAppArtifactCacheStore)(actor.homeDir).clear({
                    scope,
                    cacheKey: normalizeText(cacheInput.cacheKey),
                });
                return (0, commandResult_1.commandSuccess)(toBrowserRecord(result));
            }
            if (scope === 'all') {
                const result = await (0, artifactCache_1.createMetaAppArtifactCacheStore)(actor.homeDir).clear({ scope });
                return (0, commandResult_1.commandSuccess)(toBrowserRecord(result));
            }
            return (0, commandResult_1.commandFailed)('invalid_argument', 'Unsupported Browser cache clear scope.');
        }
        catch (error) {
            return (0, commandResult_1.commandFailed)('invalid_argument', error instanceof Error ? error.message : String(error));
        }
    }
    async function resolveResource(resolveInput) {
        const actor = await resolveActor(resolveInput);
        if ('failure' in actor)
            return actor.failure;
        const config = await (0, configStore_1.createConfigStore)(actor.homeDir).read();
        const browserConfig = (0, config_1.resolveBrowserConfig)(config, env);
        return (0, browserResolver_1.resolveBrowserResource)({
            uri: resolveInput.uri,
            config: browserConfig,
            fetch: fetchImpl,
            metaAppResolve: (pinId) => (0, metaAppPinResolver_1.resolveMetaAppPinToRecord)({
                pinId,
                fetch: fetchImpl,
                manApiBaseUrl: browserConfig.manApiBaseUrl,
                artifactCache: (0, artifactCache_1.createMetaAppArtifactCacheStore)(actor.homeDir),
                createPreviewSession: ({ artifactDir, indexFile }) => {
                    const session = input.metaAppPreviewSessions.create({ artifactDir, indexFile });
                    return {
                        previewId: session.previewId,
                        localPreviewUrl: buildMetaAppPreviewAssetUrl(session.previewId, indexFile),
                    };
                },
            }),
        });
    }
    async function runTrustedAction(actionInput) {
        const actor = await resolveActor(actionInput);
        if ('failure' in actor)
            return actor.failure;
        const from = actorSelector(actionInput);
        const payload = readActionPayload(actionInput);
        if (actionInput.kind === 'private-chat') {
            const to = normalizeText(payload.to) || normalizeText(payload.targetGlobalMetaId);
            const content = normalizeText(payload.content) || normalizeText(payload.message);
            if (!to || !content) {
                return (0, commandResult_1.commandFailed)('invalid_browser_action', 'Browser private-chat action requires to and content.');
            }
            if (!input.privateChat) {
                return (0, commandResult_1.commandFailed)('browser_action_not_supported', 'Browser private-chat action is not supported by the OAC adapter.');
            }
            const result = await input.privateChat({
                ...(from ? { from } : {}),
                to,
                content,
                ...(normalizeText(payload.replyPin) ? { replyPin: normalizeText(payload.replyPin) } : {}),
                ...(normalizeText(payload.peerChatPublicKey) ? { peerChatPublicKey: normalizeText(payload.peerChatPublicKey) } : {}),
                ...(normalizeText(payload.network) ? { network: normalizeText(payload.network) } : {}),
            });
            return wrapTrustedActionResult(actionInput.kind, result);
        }
        if (actionInput.kind === 'service-call') {
            const servicePinId = normalizeText(payload.servicePinId);
            const providerGlobalMetaId = normalizeText(payload.providerGlobalMetaId);
            const userTask = normalizeText(payload.userTask) || normalizeText(payload.rawRequest);
            if (!servicePinId || !providerGlobalMetaId || !userTask) {
                return (0, commandResult_1.commandFailed)('invalid_browser_action', 'Browser service-call action requires servicePinId, providerGlobalMetaId, and userTask.');
            }
            if (!input.serviceCall) {
                return (0, commandResult_1.commandFailed)('browser_action_not_supported', 'Browser service-call action is not supported by the OAC adapter.');
            }
            const request = {
                servicePinId,
                providerGlobalMetaId,
                userTask,
                taskContext: normalizeText(payload.taskContext) || 'Requested from Agent Internet Browser',
                rawRequest: normalizeText(payload.rawRequest) || userTask,
                confirmed: payload.confirmed === false ? false : true,
            };
            if (normalizeText(payload.providerDaemonBaseUrl)) {
                request.providerDaemonBaseUrl = normalizeText(payload.providerDaemonBaseUrl);
            }
            if (payload.spendCap && typeof payload.spendCap === 'object' && !Array.isArray(payload.spendCap)) {
                request.spendCap = payload.spendCap;
            }
            if (normalizeText(payload.policyMode)) {
                request.policyMode = normalizeText(payload.policyMode);
            }
            const result = await input.serviceCall({
                ...(from ? { from } : {}),
                request,
            });
            return wrapTrustedActionResult(actionInput.kind, result);
        }
        if (actionInput.kind === 'open-conversation') {
            const openPayload = payload;
            const peerGlobalMetaId = normalizeText(openPayload.peerGlobalMetaId);
            if (!peerGlobalMetaId) {
                return (0, commandResult_1.commandFailed)('invalid_browser_action', 'Browser open-conversation action requires peerGlobalMetaId.');
            }
            let profiles;
            try {
                profiles = await (0, metabotProfileManager_1.listMetabotProfiles)(input.systemHomeDir);
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('browser_profile_list_failed', error instanceof Error ? error.message : 'Browser open-conversation action could not list MetaBot profiles.');
            }
            const selectedProfile = findProfileByHomeDir(profiles, actor.homeDir);
            const localGlobalMetaId = normalizeText(selectedProfile?.globalMetaId);
            if (!selectedProfile || !localGlobalMetaId) {
                return (0, commandResult_1.commandManualActionRequired)('browser_identity_required', 'Open conversation requires a selected local Bot with a Global MetaID.');
            }
            return (0, commandResult_1.commandSuccess)({
                kind: 'open-conversation',
                handled: true,
                data: {
                    href: conversationHref(localGlobalMetaId, peerGlobalMetaId),
                },
            });
        }
        if (actionInput.kind === 'edit-profile' ||
            actionInput.kind === 'configure-chat' ||
            actionInput.kind === 'view-messages') {
            const ownerActorId = ownerActorIdFromPayload(payload);
            if (!ownerActorId) {
                return (0, commandResult_1.commandFailed)('invalid_browser_action', 'Browser owner action requires ownerActorId.');
            }
            let profiles;
            try {
                profiles = await (0, metabotProfileManager_1.listMetabotProfiles)(input.systemHomeDir);
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('browser_profile_list_failed', error instanceof Error ? error.message : 'Browser owner action could not list MetaBot profiles.');
            }
            const ownerProfile = profiles.find((profile) => profile.slug === ownerActorId) ?? null;
            if (!ownerProfile) {
                return (0, commandResult_1.commandFailed)('profile_not_found', `MetaBot profile not found: ${ownerActorId}`);
            }
            const href = actionInput.kind === 'edit-profile'
                ? botManagementHref(ownerProfile.slug, 'info', 'profile')
                : actionInput.kind === 'configure-chat'
                    ? botManagementHref(ownerProfile.slug, 'info', 'chat')
                    : botManagementHref(ownerProfile.slug, 'history', 'messages');
            return (0, commandResult_1.commandSuccess)({
                kind: actionInput.kind,
                handled: true,
                data: { href },
            });
        }
        return (0, commandResult_1.commandFailed)('browser_action_not_supported', `Browser trusted action is not supported by the OAC adapter yet: ${actionInput.kind}`);
    }
    return {
        getRuntime,
        resolveResource,
        getSettings,
        updateSettings,
        getCache,
        clearCache,
        runTrustedAction,
    };
}
