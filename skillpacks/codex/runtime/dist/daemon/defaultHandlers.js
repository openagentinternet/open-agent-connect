"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rebuildTraceArtifactsFromSessionState = rebuildTraceArtifactsFromSessionState;
exports.createDefaultMetabotDaemonHandlers = createDefaultMetabotDaemonHandlers;
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../core/contracts/commandResult");
const fileSecretStore_1 = require("../core/secrets/fileSecretStore");
const identityProfiles_1 = require("../core/identity/identityProfiles");
const profileWorkspace_1 = require("../core/identity/profileWorkspace");
const profileNameResolution_1 = require("../core/identity/profileNameResolution");
const runtimeStateStore_1 = require("../core/state/runtimeStateStore");
const servicePublishChain_1 = require("../core/services/servicePublishChain");
const providerConsole_1 = require("../core/provider/providerConsole");
const providerPresenceState_1 = require("../core/provider/providerPresenceState");
const ratingDetailState_1 = require("../core/ratings/ratingDetailState");
const ratingDetailSync_1 = require("../core/ratings/ratingDetailSync");
const remoteCall_1 = require("../core/delegation/remoteCall");
const sessionTrace_1 = require("../core/chat/sessionTrace");
const transcriptExport_1 = require("../core/chat/transcriptExport");
const privateChat_1 = require("../core/chat/privateChat");
const privateConversation_1 = require("../core/chat/privateConversation");
const localMnemonicSigner_1 = require("../core/signing/localMnemonicSigner");
const uploadFile_1 = require("../core/files/uploadFile");
const postBuzz_1 = require("../core/buzz/postBuzz");
const bootstrapFlow_1 = require("../core/bootstrap/bootstrapFlow");
const chainDirectoryReader_1 = require("../core/discovery/chainDirectoryReader");
const chainHeartbeatDirectory_1 = require("../core/discovery/chainHeartbeatDirectory");
const socketPresenceDirectory_1 = require("../core/discovery/socketPresenceDirectory");
const sessionStateStore_1 = require("../core/a2a/sessionStateStore");
const privateChatStateStore_1 = require("../core/chat/privateChatStateStore");
const sessionEngine_1 = require("../core/a2a/sessionEngine");
const publicStatus_1 = require("../core/a2a/publicStatus");
const serviceRunnerRegistry_1 = require("../core/a2a/provider/serviceRunnerRegistry");
const traceWatch_1 = require("../core/a2a/watch/traceWatch");
const localIdentityBootstrap_1 = require("../core/bootstrap/localIdentityBootstrap");
const delegationOrderMessage_1 = require("../core/orders/delegationOrderMessage");
const configStore_1 = require("../core/config/configStore");
const metawebReplyWaiter_1 = require("../core/a2a/metawebReplyWaiter");
const masterMessageSchema_1 = require("../core/master/masterMessageSchema");
const masterProviderRuntime_1 = require("../core/master/masterProviderRuntime");
const masterDirectory_1 = require("../core/master/masterDirectory");
const masterPendingAskState_1 = require("../core/master/masterPendingAskState");
const masterPublishedState_1 = require("../core/master/masterPublishedState");
const masterPreview_1 = require("../core/master/masterPreview");
const masterTrace_1 = require("../core/master/masterTrace");
const masterAutoOrchestrator_1 = require("../core/master/masterAutoOrchestrator");
const masterHostAdapter_1 = require("../core/master/masterHostAdapter");
const masterAutoFeedbackState_1 = require("../core/master/masterAutoFeedbackState");
const masterHostSignalBridge_1 = require("../core/master/masterHostSignalBridge");
const masterPolicyGate_1 = require("../core/master/masterPolicyGate");
const masterSelector_1 = require("../core/master/masterSelector");
const masterServicePublish_1 = require("../core/master/masterServicePublish");
const masterServiceSchema_1 = require("../core/master/masterServiceSchema");
const masterSuggestState_1 = require("../core/master/masterSuggestState");
const masterTriggerEngine_1 = require("../core/master/masterTriggerEngine");
const DEFAULT_CALLER_FOREGROUND_WAIT_MS = 15_000;
const DEFAULT_CALLER_BACKGROUND_WAIT_MS = 30 * 60 * 1000;
const DEFAULT_TRACE_WATCH_WAIT_MS = 75_000;
const TRACE_WATCH_POLL_INTERVAL_MS = 500;
const PROVIDER_RATING_SYNC_STALE_MS = 30_000;
const DEFAULT_MASTER_HOST_MODE = 'codex';
const DEFAULT_NETWORK_BOT_LIST_LIMIT = 10;
const MAX_NETWORK_BOT_LIST_LIMIT = 100;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
async function sleep(ms) {
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
function sanitizeServiceSegment(value) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'service';
}
function buildMasterTraceId(input) {
    const providerPart = sanitizeServiceSegment(normalizeText(input.providerGlobalMetaId).slice(0, 16)) || 'provider';
    const servicePart = sanitizeServiceSegment(normalizeText(input.servicePinId).slice(0, 16)) || 'master';
    const suffix = (0, node_crypto_1.createHash)('sha256')
        .update(`${input.now}:${input.question}`)
        .digest('hex')
        .slice(0, 8);
    return `trace-master-${providerPart}-${servicePart}-${suffix}`;
}
function buildMasterRequestId(now) {
    return `master-req-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function resolvePaymentAddress(identity, currency) {
    const normalized = normalizeText(currency).toUpperCase();
    if (normalized === 'BTC')
        return identity.btcAddress;
    if (normalized === 'DOGE')
        return identity.dogeAddress;
    return identity.mvcAddress;
}
function buildDaemonLocalUiUrl(daemon, pathname, query = {}) {
    const baseUrl = normalizeText(daemon?.baseUrl);
    if (!baseUrl) {
        return undefined;
    }
    const url = new URL(pathname, baseUrl);
    for (const [key, value] of Object.entries(query)) {
        const normalized = normalizeText(value);
        if (normalized) {
            url.searchParams.set(key, normalized);
        }
    }
    return url.toString();
}
function summarizeService(record) {
    const chainPinIds = [...new Set([
            record.sourceServicePinId,
            record.currentPinId,
        ].filter(Boolean))];
    return {
        servicePinId: record.currentPinId,
        sourceServicePinId: record.sourceServicePinId,
        chainPinIds,
        providerGlobalMetaId: record.providerGlobalMetaId,
        providerAddress: record.paymentAddress,
        providerSkill: record.providerSkill,
        serviceName: record.serviceName,
        displayName: record.displayName,
        description: record.description,
        price: record.price,
        currency: record.currency,
        serviceIcon: record.serviceIcon,
        skillDocument: record.skillDocument,
        inputType: record.inputType,
        outputType: record.outputType,
        endpoint: record.endpoint,
        paymentAddress: record.paymentAddress,
        available: Boolean(record.available),
        online: false,
        lastSeenSec: null,
        lastSeenAt: null,
        updatedAt: record.updatedAt,
    };
}
function normalizeComparableGlobalMetaId(value) {
    return normalizeText(value).toLowerCase();
}
function buildSocketPresenceLastSeenIndex(bots) {
    const index = new Map();
    for (const bot of bots) {
        const globalMetaId = normalizeComparableGlobalMetaId(bot.globalMetaId);
        if (!globalMetaId || index.has(globalMetaId)) {
            continue;
        }
        const lastSeenAt = typeof bot.lastSeenAt === 'number' && Number.isFinite(bot.lastSeenAt) && bot.lastSeenAt > 0
            ? Math.floor(bot.lastSeenAt)
            : null;
        index.set(globalMetaId, lastSeenAt);
    }
    return index;
}
function markServicesOnlineForFallback(services) {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    return services.map((service) => ({
        ...service,
        online: true,
        lastSeenAt: nowMs,
        lastSeenSec: nowSec,
    }));
}
function markServicesOfflineForPresenceUnavailable(services) {
    return services.map((service) => ({
        ...service,
        online: false,
        lastSeenAt: null,
        lastSeenSec: null,
    }));
}
async function decorateServicesWithSocketPresence(input) {
    try {
        const presence = await (0, socketPresenceDirectory_1.readOnlineMetaBotsFromSocketPresence)({
            apiBaseUrl: input.socketPresenceApiBaseUrl,
            limit: MAX_NETWORK_BOT_LIST_LIMIT,
        });
        const lastSeenIndex = buildSocketPresenceLastSeenIndex(presence.bots);
        const decorated = input.services.map((service) => {
            const globalMetaId = normalizeComparableGlobalMetaId(service.providerGlobalMetaId ?? service.globalMetaId);
            const lastSeenAt = globalMetaId ? (lastSeenIndex.get(globalMetaId) ?? null) : null;
            return {
                ...service,
                online: Boolean(globalMetaId && lastSeenIndex.has(globalMetaId)),
                lastSeenAt,
                lastSeenSec: normalizeEpochSeconds(lastSeenAt),
            };
        });
        if (input.onlineOnly) {
            return decorated.filter((service) => service.online === true);
        }
        return decorated;
    }
    catch (error) {
        if (input.socketPresenceFailureMode === 'assume_service_providers_online') {
            const fallbackDecorated = markServicesOnlineForFallback(input.services);
            if (input.onlineOnly) {
                return fallbackDecorated.filter((service) => service.online === true);
            }
            return fallbackDecorated;
        }
        if (input.onlineOnly) {
            throw error;
        }
        return markServicesOfflineForPresenceUnavailable(input.services);
    }
}
function isProviderPresenceOnline(input, nowMs = Date.now()) {
    if (input.enabled !== true || !input.lastHeartbeatPinId || !Number.isFinite(input.lastHeartbeatAt)) {
        return false;
    }
    return (nowMs - Number(input.lastHeartbeatAt)) <= (chainHeartbeatDirectory_1.HEARTBEAT_ONLINE_WINDOW_SEC * 1000);
}
function summarizeMaster(record, options = {}) {
    return {
        ...(0, masterDirectory_1.summarizePublishedMaster)(record),
        online: options.online === true,
        lastSeenSec: options.lastSeenSec ?? null,
        providerDaemonBaseUrl: normalizeText(options.providerDaemonBaseUrl) || null,
        directorySeedLabel: normalizeText(options.directorySeedLabel) || null,
    };
}
function readObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value;
}
function readBoolean(value) {
    return value === true;
}
function readInteger(value, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.trunc(value));
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.trunc(parsed));
        }
    }
    return fallback;
}
function readStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry) => typeof entry === 'string')
        .map((entry) => normalizeText(entry))
        .filter(Boolean);
}
function hasOwn(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
}
function looksLikeMasterHostObservationFrame(value) {
    return readObject(value.hints) !== null
        || readObject(value.activity)?.lastMeaningfulDiffAt !== undefined
        || readObject(value.diagnostics)?.lastFailureSummary !== undefined;
}
function parseMasterTriggerObservationRecord(observation) {
    const userIntent = readObject(observation.userIntent) ?? {};
    const activity = readObject(observation.activity) ?? {};
    const diagnostics = readObject(observation.diagnostics) ?? {};
    const workState = readObject(observation.workState) ?? {};
    const directory = readObject(observation.directory) ?? {};
    return {
        now: readInteger(observation.now, Date.now()),
        traceId: normalizeText(observation.traceId) || null,
        hostMode: normalizeText(observation.hostMode) || DEFAULT_MASTER_HOST_MODE,
        workspaceId: normalizeText(observation.workspaceId) || null,
        userIntent: {
            explicitlyAskedForMaster: readBoolean(userIntent.explicitlyAskedForMaster),
            explicitlyRejectedSuggestion: readBoolean(userIntent.explicitlyRejectedSuggestion),
            explicitlyRejectedAutoAsk: readBoolean(userIntent.explicitlyRejectedAutoAsk),
        },
        activity: {
            recentUserMessages: readInteger(activity.recentUserMessages),
            recentAssistantMessages: readInteger(activity.recentAssistantMessages),
            recentToolCalls: readInteger(activity.recentToolCalls),
            recentFailures: readInteger(activity.recentFailures),
            repeatedFailureCount: readInteger(activity.repeatedFailureCount),
            noProgressWindowMs: observation.activity && activity.noProgressWindowMs !== undefined && activity.noProgressWindowMs !== null
                ? readInteger(activity.noProgressWindowMs)
                : null,
        },
        diagnostics: {
            failingTests: readInteger(diagnostics.failingTests),
            failingCommands: readInteger(diagnostics.failingCommands),
            repeatedErrorSignatures: readStringArray(diagnostics.repeatedErrorSignatures),
            uncertaintySignals: readStringArray(diagnostics.uncertaintySignals),
        },
        workState: {
            hasPlan: readBoolean(workState.hasPlan),
            todoBlocked: readBoolean(workState.todoBlocked),
            diffChangedRecently: readBoolean(workState.diffChangedRecently),
            onlyReadingWithoutConverging: readBoolean(workState.onlyReadingWithoutConverging),
        },
        directory: {
            availableMasters: readInteger(directory.availableMasters),
            trustedMasters: readInteger(directory.trustedMasters),
            onlineMasters: readInteger(directory.onlineMasters),
        },
        candidateMasterKindHint: normalizeText(observation.candidateMasterKindHint) || null,
    };
}
function mergeMasterTriggerObservation(base, overrideRecord, overrideObservation) {
    const overrideUserIntent = readObject(overrideRecord.userIntent) ?? {};
    const overrideActivity = readObject(overrideRecord.activity) ?? {};
    const overrideDiagnostics = readObject(overrideRecord.diagnostics) ?? {};
    const overrideWorkState = readObject(overrideRecord.workState) ?? {};
    const overrideDirectory = readObject(overrideRecord.directory) ?? {};
    const hostObservationOverride = looksLikeMasterHostObservationFrame(overrideRecord);
    return {
        now: hasOwn(overrideRecord, 'now') ? overrideObservation.now : base.now,
        traceId: hasOwn(overrideRecord, 'traceId') ? overrideObservation.traceId : base.traceId,
        hostMode: hasOwn(overrideRecord, 'hostMode') ? overrideObservation.hostMode : base.hostMode,
        workspaceId: hasOwn(overrideRecord, 'workspaceId') ? overrideObservation.workspaceId : base.workspaceId,
        userIntent: {
            explicitlyAskedForMaster: hasOwn(overrideUserIntent, 'explicitlyAskedForMaster')
                ? overrideObservation.userIntent?.explicitlyAskedForMaster === true
                : base.userIntent?.explicitlyAskedForMaster === true,
            explicitlyRejectedSuggestion: hasOwn(overrideUserIntent, 'explicitlyRejectedSuggestion')
                ? overrideObservation.userIntent?.explicitlyRejectedSuggestion === true
                : base.userIntent?.explicitlyRejectedSuggestion === true,
            explicitlyRejectedAutoAsk: hasOwn(overrideUserIntent, 'explicitlyRejectedAutoAsk')
                ? overrideObservation.userIntent?.explicitlyRejectedAutoAsk === true
                : base.userIntent?.explicitlyRejectedAutoAsk === true,
        },
        activity: {
            recentUserMessages: hasOwn(overrideActivity, 'recentUserMessages')
                ? overrideObservation.activity?.recentUserMessages ?? 0
                : base.activity?.recentUserMessages ?? 0,
            recentAssistantMessages: hasOwn(overrideActivity, 'recentAssistantMessages')
                ? overrideObservation.activity?.recentAssistantMessages ?? 0
                : base.activity?.recentAssistantMessages ?? 0,
            recentToolCalls: hasOwn(overrideActivity, 'recentToolCalls')
                ? overrideObservation.activity?.recentToolCalls ?? 0
                : base.activity?.recentToolCalls ?? 0,
            recentFailures: hasOwn(overrideActivity, 'recentFailures')
                ? overrideObservation.activity?.recentFailures ?? 0
                : base.activity?.recentFailures ?? 0,
            repeatedFailureCount: hasOwn(overrideActivity, 'repeatedFailureCount')
                ? overrideObservation.activity?.repeatedFailureCount ?? 0
                : base.activity?.repeatedFailureCount ?? 0,
            noProgressWindowMs: hasOwn(overrideActivity, 'noProgressWindowMs')
                ? (overrideObservation.activity?.noProgressWindowMs ?? null)
                : (base.activity?.noProgressWindowMs ?? null),
        },
        diagnostics: {
            failingTests: hasOwn(overrideDiagnostics, 'failingTests')
                ? overrideObservation.diagnostics?.failingTests ?? 0
                : base.diagnostics?.failingTests ?? 0,
            failingCommands: hasOwn(overrideDiagnostics, 'failingCommands')
                ? overrideObservation.diagnostics?.failingCommands ?? 0
                : base.diagnostics?.failingCommands ?? 0,
            repeatedErrorSignatures: hasOwn(overrideDiagnostics, 'repeatedErrorSignatures')
                ? overrideObservation.diagnostics?.repeatedErrorSignatures ?? []
                : base.diagnostics?.repeatedErrorSignatures ?? [],
            uncertaintySignals: hasOwn(overrideDiagnostics, 'uncertaintySignals')
                ? overrideObservation.diagnostics?.uncertaintySignals ?? []
                : base.diagnostics?.uncertaintySignals ?? [],
        },
        workState: {
            hasPlan: hasOwn(overrideWorkState, 'hasPlan')
                ? overrideObservation.workState?.hasPlan === true
                : base.workState?.hasPlan === true,
            todoBlocked: hasOwn(overrideWorkState, 'todoBlocked')
                ? overrideObservation.workState?.todoBlocked === true
                : base.workState?.todoBlocked === true,
            diffChangedRecently: hasOwn(overrideWorkState, 'diffChangedRecently')
                ? overrideObservation.workState?.diffChangedRecently === true
                : base.workState?.diffChangedRecently === true,
            onlyReadingWithoutConverging: hasOwn(overrideWorkState, 'onlyReadingWithoutConverging')
                ? overrideObservation.workState?.onlyReadingWithoutConverging === true
                : base.workState?.onlyReadingWithoutConverging === true,
        },
        directory: {
            availableMasters: hasOwn(overrideDirectory, 'availableMasters')
                ? overrideObservation.directory?.availableMasters ?? 0
                : base.directory?.availableMasters ?? 0,
            trustedMasters: hasOwn(overrideDirectory, 'trustedMasters')
                ? overrideObservation.directory?.trustedMasters ?? 0
                : base.directory?.trustedMasters ?? 0,
            onlineMasters: hasOwn(overrideDirectory, 'onlineMasters')
                ? overrideObservation.directory?.onlineMasters ?? 0
                : base.directory?.onlineMasters ?? 0,
        },
        candidateMasterKindHint: hasOwn(overrideRecord, 'candidateMasterKindHint') || hostObservationOverride
            ? overrideObservation.candidateMasterKindHint ?? null
            : base.candidateMasterKindHint ?? null,
    };
}
function readMasterTriggerObservation(rawInput) {
    const context = readObject(rawInput.context);
    const contextObservation = context
        ? (0, masterHostSignalBridge_1.buildTriggerObservationFromHostContext)(context)
        : null;
    const explicitObservation = readObject(rawInput.observation);
    if (!explicitObservation) {
        return contextObservation ?? parseMasterTriggerObservationRecord(rawInput);
    }
    const parsedExplicit = looksLikeMasterHostObservationFrame(explicitObservation)
        ? (0, masterHostSignalBridge_1.buildTriggerObservationFromHostObservationFrame)(explicitObservation)
        : parseMasterTriggerObservationRecord(explicitObservation);
    return contextObservation
        ? mergeMasterTriggerObservation(contextObservation, explicitObservation, parsedExplicit)
        : parsedExplicit;
}
function readMasterTriggerDirectoryPresence(rawInput) {
    const explicitDirectory = readObject(readObject(rawInput.observation)?.directory);
    const contextDirectory = readObject(readObject(readObject(rawInput.context)?.hostSignals)?.directory);
    const combined = {
        availableMasters: false,
        trustedMasters: false,
        onlineMasters: false,
    };
    for (const directory of [contextDirectory, explicitDirectory]) {
        if (!directory) {
            continue;
        }
        combined.availableMasters = combined.availableMasters || hasOwn(directory, 'availableMasters');
        combined.trustedMasters = combined.trustedMasters || hasOwn(directory, 'trustedMasters');
        combined.onlineMasters = combined.onlineMasters || hasOwn(directory, 'onlineMasters');
    }
    return combined;
}
async function hydrateMasterTriggerObservationDirectory(input) {
    if (input.directoryPresence.availableMasters
        && input.directoryPresence.onlineMasters
        && input.directoryPresence.trustedMasters) {
        return input.observation;
    }
    const directory = await listRuntimeDirectoryMasters({
        masterStateStore: input.masterStateStore,
        directorySeedsPath: input.directorySeedsPath,
        chainApiBaseUrl: input.chainApiBaseUrl,
        onlineOnly: false,
        host: input.observation.hostMode,
        localProviderOnline: input.localProviderOnline,
        localLastSeenSec: input.localLastSeenSec,
        providerDaemonBaseUrl: input.providerDaemonBaseUrl,
        providerGlobalMetaId: input.providerGlobalMetaId,
    });
    const trustedPins = new Set(input.trustedMasters.map((entry) => normalizeText(entry)).filter(Boolean));
    const trustedCount = directory.masters.filter((master) => trustedPins.has(normalizeText(master.masterPinId))).length;
    const onlineCount = directory.masters.filter((master) => master.online).length;
    return {
        ...input.observation,
        directory: {
            availableMasters: input.directoryPresence.availableMasters
                ? (input.observation.directory?.availableMasters ?? 0)
                : Math.max(input.observation.directory?.availableMasters ?? 0, directory.masters.length),
            trustedMasters: input.directoryPresence.trustedMasters
                ? (input.observation.directory?.trustedMasters ?? 0)
                : Math.max(input.observation.directory?.trustedMasters ?? 0, trustedCount),
            onlineMasters: input.directoryPresence.onlineMasters
                ? (input.observation.directory?.onlineMasters ?? 0)
                : Math.max(input.observation.directory?.onlineMasters ?? 0, onlineCount),
        },
    };
}
function buildProviderSummaryPayload(input) {
    const snapshot = (0, providerConsole_1.buildProviderConsoleSnapshot)({
        services: input.state.services,
        masters: input.masters,
        traces: input.state.traces,
        ratingDetails: input.ratingDetails,
        ratingSyncState: input.ratingSyncState,
    });
    return {
        identity: input.state.identity
            ? {
                metabotId: input.state.identity.metabotId,
                name: input.state.identity.name,
                globalMetaId: input.state.identity.globalMetaId,
                mvcAddress: input.state.identity.mvcAddress,
            }
            : null,
        presence: input.presence,
        services: snapshot.services,
        recentOrders: snapshot.recentOrders,
        manualActions: snapshot.manualActions,
        recentMasterRequests: snapshot.recentMasterRequests,
        totals: snapshot.totals,
        ratingSyncState: input.ratingSyncState === 'sync_error' ? 'sync_error' : 'ready',
        ratingSyncError: normalizeText(input.ratingSyncError) || null,
    };
}
async function readRatingDetailSnapshot(input) {
    const now = input.now ?? Date.now;
    const current = await input.ratingDetailStateStore.read();
    const lastSyncedAt = Number.isFinite(current.lastSyncedAt) ? Number(current.lastSyncedAt) : 0;
    const shouldRefresh = current.items.length === 0 || !lastSyncedAt || now() - lastSyncedAt >= PROVIDER_RATING_SYNC_STALE_MS;
    if (!shouldRefresh) {
        return {
            ratingDetails: current.items,
            ratingSyncState: 'ready',
            ratingSyncError: null,
        };
    }
    try {
        const refreshed = await (0, ratingDetailSync_1.refreshRatingDetailCacheFromChain)({
            store: input.ratingDetailStateStore,
            chainApiBaseUrl: input.chainApiBaseUrl,
            now,
        });
        return {
            ratingDetails: refreshed.state.items,
            ratingSyncState: 'ready',
            ratingSyncError: null,
        };
    }
    catch (error) {
        return {
            ratingDetails: current.items,
            ratingSyncState: 'sync_error',
            ratingSyncError: error instanceof Error ? error.message : String(error),
        };
    }
}
function readCallRequest(rawInput) {
    const request = readObject(rawInput.request) ?? rawInput;
    return {
        servicePinId: normalizeText(request.servicePinId),
        providerGlobalMetaId: normalizeText(request.providerGlobalMetaId),
        providerDaemonBaseUrl: normalizeText(request.providerDaemonBaseUrl ?? rawInput.providerDaemonBaseUrl),
        userTask: normalizeText(request.userTask),
        taskContext: normalizeText(request.taskContext),
        rawRequest: normalizeText(request.rawRequest),
        spendCap: readObject(request.spendCap),
        policyMode: request.policyMode,
    };
}
function readPrivateChatRequest(rawInput) {
    let content = normalizeText(rawInput.content);
    if (!content && rawInput.content && typeof rawInput.content === 'object') {
        try {
            content = JSON.stringify(rawInput.content);
        }
        catch {
            content = '';
        }
    }
    return {
        to: normalizeText(rawInput.to),
        content,
        replyPin: normalizeText(rawInput.replyPin),
        peerChatPublicKey: normalizeText(rawInput.peerChatPublicKey),
    };
}
function readPrivateConversationRequest(rawInput) {
    return {
        peer: normalizeText(rawInput.peer),
        afterIndex: (0, privateConversation_1.normalizeConversationAfterIndex)(rawInput.afterIndex),
        limit: (0, privateConversation_1.normalizeConversationLimit)(rawInput.limit),
    };
}
function describeStructuredPrivateChatContent(content) {
    const request = (0, masterMessageSchema_1.parseMasterRequest)(content);
    if (request.ok) {
        return {
            messageType: 'master_request',
            requestId: request.value.requestId,
            traceId: request.value.traceId,
        };
    }
    const response = (0, masterMessageSchema_1.parseMasterResponse)(content);
    if (response.ok) {
        return {
            messageType: 'master_response',
            requestId: response.value.requestId,
            traceId: response.value.traceId,
        };
    }
    return {
        messageType: null,
        requestId: null,
        traceId: null,
    };
}
function readMasterAskDraft(rawInput) {
    const target = readObject(rawInput.target) ?? {};
    return {
        target: {
            servicePinId: normalizeText(target.servicePinId),
            providerGlobalMetaId: normalizeText(target.providerGlobalMetaId),
            masterKind: normalizeText(target.masterKind),
            displayName: normalizeText(target.displayName) || null,
        },
        triggerMode: normalizeText(rawInput.triggerMode) || null,
        contextMode: normalizeText(rawInput.contextMode) || null,
        userTask: normalizeText(rawInput.userTask),
        question: normalizeText(rawInput.question),
        goal: normalizeText(rawInput.goal) || null,
        workspaceSummary: normalizeText(rawInput.workspaceSummary) || null,
        errorSummary: normalizeText(rawInput.errorSummary) || null,
        diffSummary: normalizeText(rawInput.diffSummary) || null,
        relevantFiles: readStringArray(rawInput.relevantFiles),
        artifacts: Array.isArray(rawInput.artifacts) ? rawInput.artifacts : [],
        constraints: readStringArray(rawInput.constraints),
        desiredOutput: readObject(rawInput.desiredOutput),
    };
}
function readMasterHostActionRequest(rawInput) {
    const action = readObject(rawInput.action) ?? {};
    return {
        action: {
            kind: normalizeText(action.kind),
            utterance: normalizeText(action.utterance),
            preferredMasterName: normalizeText(action.preferredMasterName) || null,
            preferredMasterKind: normalizeText(action.preferredMasterKind) || null,
            traceId: normalizeText(action.traceId) || null,
            suggestionId: normalizeText(action.suggestionId) || null,
            reason: normalizeText(action.reason) || null,
        },
        context: readObject(rawInput.context) ?? {},
    };
}
function readExecuteServiceRequest(rawInput) {
    const buyer = readObject(rawInput.buyer) ?? {};
    const request = readObject(rawInput.request) ?? {};
    return {
        traceId: normalizeText(rawInput.traceId),
        externalConversationId: normalizeText(rawInput.externalConversationId),
        servicePinId: normalizeText(rawInput.servicePinId),
        providerGlobalMetaId: normalizeText(rawInput.providerGlobalMetaId),
        buyer: {
            host: normalizeText(buyer.host),
            globalMetaId: normalizeText(buyer.globalMetaId),
            name: normalizeText(buyer.name),
        },
        request: {
            userTask: normalizeText(request.userTask),
            taskContext: normalizeText(request.taskContext),
        },
    };
}
function readServiceRateRequest(rawInput) {
    const request = readObject(rawInput.request) ?? rawInput;
    const rawRate = request.rate;
    const parsedRate = typeof rawRate === 'number'
        ? rawRate
        : Number.parseInt(normalizeText(rawRate), 10);
    return {
        traceId: normalizeText(request.traceId),
        rate: Number.isFinite(parsedRate) ? Math.trunc(parsedRate) : NaN,
        comment: normalizeText(request.comment),
    };
}
function buildServiceRatingFollowupMessage(input) {
    const base = normalizeText(input.comment);
    const pinId = normalizeText(input.ratingPinId);
    const pinLine = pinId
        ? `\n\n我的评分已记录在链上（pin ID: ${pinId}）。`
        : '';
    return `${base}${pinLine}`.trim();
}
function renderDemoRemoteServiceResponse(input) {
    const serviceName = normalizeText(input.serviceName).toLowerCase();
    const displayName = normalizeText(input.displayName);
    const userTask = normalizeText(input.userTask);
    const taskContext = normalizeText(input.taskContext);
    const weatherLike = serviceName.includes('weather')
        || displayName.toLowerCase().includes('weather')
        || /weather|天气/i.test(userTask)
        || /weather|天气/i.test(taskContext);
    if (weatherLike) {
        return 'Tomorrow will be bright with a light wind.';
    }
    const contextSuffix = taskContext ? ` Context: ${taskContext}` : '';
    return `${displayName || 'Remote agent'} completed the remote request: ${userTask}.${contextSuffix}`.trim();
}
function isSuccessfulCommandEnvelope(value) {
    return Boolean(value && typeof value === 'object' && value.ok === true);
}
function isManualActionEnvelope(value) {
    return Boolean(value
        && typeof value === 'object'
        && value.ok === false
        && value.state === 'manual_action_required');
}
function isFailedCommandEnvelope(value) {
    return Boolean(value && typeof value === 'object' && value.ok === false);
}
async function fetchRemoteAvailableServices(providerDaemonBaseUrl) {
    try {
        const response = await fetch(`${providerDaemonBaseUrl}/api/network/services?online=true`);
        const payload = await response.json();
        if (!response.ok) {
            return (0, commandResult_1.commandFailed)('remote_directory_unreachable', `Remote service directory returned HTTP ${response.status}.`);
        }
        if (!isSuccessfulCommandEnvelope(payload)) {
            if (isManualActionEnvelope(payload)) {
                return (0, commandResult_1.commandManualActionRequired)(normalizeText(payload.code) || 'remote_directory_manual_action_required', normalizeText(payload.message) || 'Remote directory requires manual action.', normalizeText(payload.localUiUrl) || undefined);
            }
            if (isFailedCommandEnvelope(payload)) {
                return (0, commandResult_1.commandFailed)(normalizeText(payload.code) || 'remote_directory_unavailable', normalizeText(payload.message) || 'Remote directory is unavailable.');
            }
            return (0, commandResult_1.commandFailed)('remote_directory_invalid_response', 'Remote directory returned an invalid command envelope.');
        }
        const services = Array.isArray(payload.data.services)
            ? payload.data.services
                .filter((entry) => Boolean(entry && typeof entry === 'object'))
                .filter((entry) => entry.online === true)
            : [];
        return { services };
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('remote_directory_unreachable', error instanceof Error ? error.message : String(error));
    }
}
async function fetchRemoteAvailableMasters(providerDaemonBaseUrl) {
    try {
        const response = await fetch(`${providerDaemonBaseUrl}/api/master/list?online=true`);
        const payload = await response.json();
        if (!response.ok) {
            return (0, commandResult_1.commandFailed)('remote_master_directory_unreachable', `Remote master directory returned HTTP ${response.status}.`);
        }
        if (!isSuccessfulCommandEnvelope(payload)) {
            if (isManualActionEnvelope(payload)) {
                return (0, commandResult_1.commandManualActionRequired)(normalizeText(payload.code) || 'remote_master_directory_manual_action_required', normalizeText(payload.message) || 'Remote master directory requires manual action.', normalizeText(payload.localUiUrl) || undefined);
            }
            if (isFailedCommandEnvelope(payload)) {
                return (0, commandResult_1.commandFailed)(normalizeText(payload.code) || 'remote_master_directory_unavailable', normalizeText(payload.message) || 'Remote master directory is unavailable.');
            }
            return (0, commandResult_1.commandFailed)('remote_master_directory_invalid_response', 'Remote master directory returned an invalid command envelope.');
        }
        const masters = Array.isArray(payload.data.masters)
            ? payload.data.masters.filter((entry) => Boolean(entry && typeof entry === 'object'))
            : [];
        return { masters };
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('remote_master_directory_unreachable', error instanceof Error ? error.message : String(error));
    }
}
async function readDirectorySeeds(directorySeedsPath) {
    let payload;
    try {
        payload = JSON.parse(await node_fs_1.promises.readFile(directorySeedsPath, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const providers = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.providers)
            ? payload.providers
            : [];
    const seen = new Set();
    const normalizedProviders = [];
    for (const provider of providers) {
        const entry = readObject(provider);
        const baseUrl = normalizeText(entry?.baseUrl);
        if (!baseUrl || seen.has(baseUrl)) {
            continue;
        }
        seen.add(baseUrl);
        normalizedProviders.push({
            baseUrl,
            label: normalizeText(entry?.label) || null,
        });
    }
    return normalizedProviders;
}
async function writeDirectorySeeds(directorySeedsPath, providers) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(directorySeedsPath), { recursive: true });
    await node_fs_1.promises.writeFile(directorySeedsPath, `${JSON.stringify({ providers }, null, 2)}\n`, 'utf8');
}
function sortDirectorySeeds(providers) {
    return [...providers].sort((left, right) => left.baseUrl.localeCompare(right.baseUrl));
}
function dedupeServices(services) {
    const deduped = new Map();
    for (const service of services) {
        const key = [
            normalizeText(service.providerGlobalMetaId),
            normalizeText(service.servicePinId || service.sourceServicePinId),
        ].join('::');
        if (!key || deduped.has(key)) {
            continue;
        }
        deduped.set(key, service);
    }
    return [...deduped.values()].sort((left, right) => {
        const leftUpdatedAt = Number(left.updatedAt ?? 0);
        const rightUpdatedAt = Number(right.updatedAt ?? 0);
        return rightUpdatedAt - leftUpdatedAt;
    });
}
function normalizeEpochSeconds(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return null;
    }
    // Accept either second-based or millisecond-based timestamps.
    if (value > 1e12) {
        return Math.floor(value / 1000);
    }
    return Math.floor(value);
}
function dedupeOnlineBotsFromServices(services, limit, nowMs = Date.now()) {
    const byGlobalMetaId = new Map();
    for (const service of services) {
        const globalMetaId = normalizeText(service.providerGlobalMetaId);
        if (!globalMetaId) {
            continue;
        }
        const online = service.online !== false;
        if (!online) {
            continue;
        }
        const lastSeenSec = normalizeEpochSeconds(Number.isFinite(Number(service.lastSeenSec))
            ? Number(service.lastSeenSec)
            : Number(service.updatedAt));
        const existing = byGlobalMetaId.get(globalMetaId);
        if (!existing) {
            byGlobalMetaId.set(globalMetaId, { lastSeenSec });
            continue;
        }
        if ((lastSeenSec ?? -Infinity) > (existing.lastSeenSec ?? -Infinity)) {
            byGlobalMetaId.set(globalMetaId, { lastSeenSec });
        }
    }
    const nowSec = Math.floor(nowMs / 1000);
    return [...byGlobalMetaId.entries()]
        .sort((left, right) => {
        const leftSeen = left[1].lastSeenSec ?? -Infinity;
        const rightSeen = right[1].lastSeenSec ?? -Infinity;
        if (leftSeen !== rightSeen) {
            return rightSeen - leftSeen;
        }
        return left[0].localeCompare(right[0]);
    })
        .slice(0, limit)
        .map(([globalMetaId, entry]) => ({
        globalMetaId,
        lastSeenAt: entry.lastSeenSec ? entry.lastSeenSec * 1000 : 0,
        lastSeenAgoSeconds: entry.lastSeenSec ? Math.max(0, nowSec - entry.lastSeenSec) : 0,
        deviceCount: 1,
        online: true,
    }));
}
async function fetchSeededDirectoryServices(directorySeedsPath) {
    const seeds = await readDirectorySeeds(directorySeedsPath);
    const mergedServices = [];
    for (const seed of seeds) {
        const remoteDirectory = await fetchRemoteAvailableServices(seed.baseUrl);
        if ('ok' in remoteDirectory) {
            continue;
        }
        for (const service of remoteDirectory.services) {
            mergedServices.push({
                ...service,
                providerDaemonBaseUrl: normalizeText(service.providerDaemonBaseUrl) || seed.baseUrl,
                directorySeedLabel: seed.label,
                online: service.online !== false,
            });
        }
    }
    return dedupeServices(mergedServices);
}
async function fetchSeededDirectoryMasters(directorySeedsPath) {
    const seeds = await readDirectorySeeds(directorySeedsPath);
    const mergedMasters = [];
    for (const seed of seeds) {
        const remoteDirectory = await fetchRemoteAvailableMasters(seed.baseUrl);
        if ('ok' in remoteDirectory) {
            continue;
        }
        for (const master of remoteDirectory.masters) {
            mergedMasters.push({
                ...master,
                providerDaemonBaseUrl: normalizeText(master.providerDaemonBaseUrl) || seed.baseUrl,
                directorySeedLabel: seed.label,
                online: master.online !== false,
            });
        }
    }
    return (0, masterDirectory_1.listMasters)({
        entries: mergedMasters,
        host: DEFAULT_MASTER_HOST_MODE,
    });
}
async function executeRemoteServiceCall(input) {
    try {
        const response = await fetch(`${input.providerDaemonBaseUrl}/api/services/execute`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                traceId: input.traceId,
                externalConversationId: input.externalConversationId,
                servicePinId: input.servicePinId,
                providerGlobalMetaId: input.providerGlobalMetaId,
                buyer: {
                    host: 'local-runtime',
                    globalMetaId: input.buyer.globalMetaId,
                    name: input.buyer.name,
                },
                request: input.request,
            }),
        });
        const payload = await response.json();
        if (!response.ok) {
            return (0, commandResult_1.commandFailed)('remote_execution_failed', `Remote execution returned HTTP ${response.status}.`);
        }
        if (isSuccessfulCommandEnvelope(payload)) {
            return (0, commandResult_1.commandSuccess)(payload.data);
        }
        if (isManualActionEnvelope(payload)) {
            return (0, commandResult_1.commandManualActionRequired)(normalizeText(payload.code) || 'remote_execution_manual_action_required', normalizeText(payload.message) || 'Remote execution requires manual action.', normalizeText(payload.localUiUrl) || undefined);
        }
        if (isFailedCommandEnvelope(payload)) {
            return (0, commandResult_1.commandFailed)(normalizeText(payload.code) || 'remote_execution_failed', normalizeText(payload.message) || 'Remote execution failed.');
        }
        return (0, commandResult_1.commandFailed)('remote_execution_invalid_response', 'Remote execution returned an invalid command envelope.');
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('remote_execution_failed', error instanceof Error ? error.message : String(error));
    }
}
async function persistSessionMutation(sessionStateStore, mutation) {
    await sessionStateStore.writeSession(mutation.session);
    await sessionStateStore.writeTaskRun(mutation.taskRun);
    const publicStatus = (0, publicStatus_1.resolvePublicStatus)({ event: mutation.event });
    await sessionStateStore.appendPublicStatusSnapshots([
        {
            sessionId: mutation.session.sessionId,
            taskRunId: mutation.taskRun.runId,
            status: publicStatus.status,
            mapped: publicStatus.mapped,
            rawEvent: publicStatus.rawEvent ?? null,
            resolvedAt: mutation.session.updatedAt,
        },
    ]);
    return publicStatus;
}
async function appendA2ATranscriptItems(sessionStateStore, items) {
    const normalizedItems = items
        .map((item) => ({
        ...item,
        id: normalizeText(item.id),
        sessionId: normalizeText(item.sessionId),
        taskRunId: normalizeText(item.taskRunId) || null,
        type: normalizeText(item.type) || 'message',
        content: normalizeText(item.content),
    }))
        .filter((item) => item.id && item.sessionId && item.content);
    if (!normalizedItems.length) {
        return;
    }
    await sessionStateStore.appendTranscriptItems(normalizedItems);
}
async function readOptionalUtf8(filePath) {
    const normalizedPath = normalizeText(filePath);
    if (!normalizedPath) {
        return null;
    }
    try {
        return await node_fs_1.promises.readFile(normalizedPath, 'utf8');
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
function extractTraceResult(input) {
    for (let index = input.transcriptItems.length - 1; index >= 0; index -= 1) {
        const item = input.transcriptItems[index];
        if (item.sender !== 'provider') {
            continue;
        }
        const content = normalizeText(item.content);
        if (!content) {
            continue;
        }
        const metadata = item.metadata ?? null;
        const deliveryPinId = normalizeText(metadata?.deliveryPinId);
        const publicStatus = normalizeText(metadata?.publicStatus);
        const event = normalizeText(metadata?.event);
        const looksLikeCompletedResult = Boolean(deliveryPinId
            || publicStatus === 'completed'
            || event === 'provider_completed');
        if (!looksLikeCompletedResult) {
            continue;
        }
        return {
            resultText: content,
            resultObservedAt: Number.isFinite(item.timestamp) ? item.timestamp : null,
            resultDeliveryPinId: deliveryPinId || null,
        };
    }
    return {
        resultText: null,
        resultObservedAt: null,
        resultDeliveryPinId: null,
    };
}
function extractTraceRatingRequest(input) {
    for (let index = input.transcriptItems.length - 1; index >= 0; index -= 1) {
        const item = input.transcriptItems[index];
        if (item.sender !== 'provider') {
            continue;
        }
        const content = normalizeText(item.content);
        if (!content) {
            continue;
        }
        const metadata = item.metadata ?? null;
        if (metadata?.needsRating !== true) {
            continue;
        }
        return {
            ratingRequestText: content,
            ratingRequestedAt: Number.isFinite(item.timestamp) ? item.timestamp : null,
        };
    }
    return {
        ratingRequestText: null,
        ratingRequestedAt: null,
    };
}
function extractTraceRatingClosure(input) {
    let ratingPublished = Boolean(input.ratingDetail);
    let ratingPinId = normalizeText(input.ratingDetail?.pinId) || null;
    let ratingValue = Number.isFinite(input.ratingDetail?.rate)
        ? Number(input.ratingDetail?.rate)
        : null;
    let ratingComment = normalizeText(input.ratingDetail?.comment) || null;
    let ratingCreatedAt = Number.isFinite(input.ratingDetail?.createdAt)
        ? Number(input.ratingDetail?.createdAt)
        : null;
    let ratingMessageSent = null;
    let ratingMessagePinId = null;
    let ratingMessageError = null;
    for (let index = input.transcriptItems.length - 1; index >= 0; index -= 1) {
        const item = input.transcriptItems[index];
        const metadata = item.metadata ?? null;
        const metadataEvent = normalizeText(metadata?.event);
        const type = normalizeText(item.type);
        const content = normalizeText(item.content);
        const metadataPinId = normalizeText(metadata?.ratingPinId) || null;
        const metadataRate = Number.parseInt(normalizeText(metadata?.rate), 10);
        if (!ratingPinId && metadataPinId) {
            ratingPinId = metadataPinId;
            ratingPublished = true;
        }
        if (ratingValue === null && Number.isFinite(metadataRate)) {
            ratingValue = metadataRate;
        }
        if (!ratingComment && type === 'rating' && content) {
            ratingComment = content;
        }
        if (!ratingCreatedAt && type === 'rating' && Number.isFinite(item.timestamp)) {
            ratingCreatedAt = item.timestamp;
        }
        if (type === 'rating' || metadataEvent === 'service_rating_published') {
            ratingPublished = ratingPublished || Boolean(metadataPinId || content);
            if (typeof metadata?.ratingMessageSent === 'boolean' && ratingMessageSent === null) {
                ratingMessageSent = metadata.ratingMessageSent;
            }
            if (!ratingMessagePinId) {
                ratingMessagePinId = normalizeText(metadata?.ratingMessagePinId) || null;
            }
            if (!ratingMessageError) {
                ratingMessageError = normalizeText(metadata?.ratingMessageError) || null;
            }
        }
        if (metadataEvent === 'service_rating_message_sent') {
            ratingPublished = true;
            ratingMessageSent = true;
            ratingMessagePinId = normalizeText(metadata?.ratingMessagePinId) || ratingMessagePinId;
        }
        if (metadataEvent === 'service_rating_message_failed') {
            ratingPublished = true;
            if (ratingMessageSent === null) {
                ratingMessageSent = false;
            }
            ratingMessageError = normalizeText(metadata?.ratingMessageError) || content || ratingMessageError;
        }
    }
    const ratingRequest = extractTraceRatingRequest({ transcriptItems: input.transcriptItems });
    return {
        ratingRequested: Boolean(ratingRequest.ratingRequestText),
        ratingPublished,
        ratingPinId,
        ratingValue,
        ratingComment,
        ratingCreatedAt,
        ratingMessageSent,
        ratingMessagePinId,
        ratingMessageError,
        tStageCompleted: ratingPublished,
    };
}
async function buildTraceInspectorPayload(input) {
    const sessionState = await input.sessionStateStore.readState();
    const sessions = sessionState.sessions
        .filter((entry) => entry.traceId === input.traceId)
        .sort((left, right) => left.createdAt - right.createdAt);
    const sessionIds = new Set(sessions.map((entry) => entry.sessionId));
    const taskRuns = sessionState.taskRuns
        .filter((entry) => sessionIds.has(entry.sessionId))
        .sort((left, right) => left.createdAt - right.createdAt);
    const transcriptItems = sessionState.transcriptItems
        .filter((entry) => sessionIds.has(entry.sessionId))
        .sort((left, right) => left.timestamp - right.timestamp);
    const publicStatusSnapshots = sessionState.publicStatusSnapshots
        .filter((entry) => sessionIds.has(entry.sessionId))
        .sort((left, right) => left.resolvedAt - right.resolvedAt);
    const result = extractTraceResult({ transcriptItems });
    const ratingRequest = extractTraceRatingRequest({ transcriptItems });
    const ratingSnapshot = await readRatingDetailSnapshot({
        ratingDetailStateStore: input.ratingDetailStateStore,
        chainApiBaseUrl: input.chainApiBaseUrl,
    });
    const serviceId = normalizeText(input.trace.order?.serviceId);
    const servicePaidTx = normalizeText(input.trace.order?.paymentTxid);
    const ratingDetail = serviceId && servicePaidTx
        ? ratingSnapshot.ratingDetails.find((entry) => (normalizeText(entry.serviceId) === serviceId
            && normalizeText(entry.servicePaidTx) === servicePaidTx)) ?? null
        : null;
    const ratingClosure = extractTraceRatingClosure({
        trace: input.trace,
        transcriptItems,
        ratingDetail,
    });
    return {
        ...input.trace,
        ...result,
        ...ratingRequest,
        ...ratingClosure,
        ratingSyncState: ratingSnapshot.ratingSyncState,
        ratingSyncError: ratingSnapshot.ratingSyncError,
        inspector: {
            session: sessions.at(-1) ?? null,
            sessions,
            taskRuns,
            transcriptItems,
            publicStatusSnapshots,
            transcriptMarkdown: await readOptionalUtf8(input.trace.artifacts.transcriptMarkdownPath),
            traceMarkdown: await readOptionalUtf8(input.trace.artifacts.traceMarkdownPath),
        },
    };
}
async function fetchPeerChatPublicKey(globalMetaId) {
    const normalized = normalizeText(globalMetaId);
    if (!normalized)
        return null;
    const urls = [
        `https://file.metaid.io/metafile-indexer/api/v1/info/globalmetaid/${encodeURIComponent(normalized)}`,
        `https://manapi.metaid.io/api/info/metaid/${encodeURIComponent(normalized)}`,
    ];
    for (const url of urls) {
        try {
            const response = await fetch(url);
            if (!response.ok)
                continue;
            const payload = await response.json();
            const chatPublicKey = normalizeText(payload?.data?.chatpubkey ?? payload?.chatpubkey);
            if (chatPublicKey) {
                return chatPublicKey;
            }
        }
        catch {
            // ignore and fall through
        }
    }
    return null;
}
function buildSyntheticPaymentTxid(input) {
    return (0, node_crypto_1.createHash)('sha256')
        .update([
        normalizeText(input.traceId),
        normalizeText(input.servicePinId),
        normalizeText(input.providerGlobalMetaId),
        normalizeText(input.userTask),
    ].join('\n'))
        .digest('hex');
}
async function listRuntimeDirectoryServices(input) {
    const localServices = input.state.services
        .filter((service) => service.available === 1)
        .map((service) => summarizeService(service));
    const directory = await (0, chainDirectoryReader_1.readChainDirectoryWithFallback)({
        chainApiBaseUrl: input.chainApiBaseUrl,
        socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
        socketPresenceFailureMode: input.socketPresenceFailureMode,
        onlineOnly: input.onlineOnly,
        fetchSeededDirectoryServices: async () => fetchSeededDirectoryServices(input.directorySeedsPath),
    });
    const decoratedLocalServices = await decorateServicesWithSocketPresence({
        services: localServices,
        socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
        socketPresenceFailureMode: input.socketPresenceFailureMode,
        onlineOnly: input.onlineOnly,
    });
    const mergedServices = dedupeServices([
        ...directory.services,
        ...decoratedLocalServices,
    ]);
    const services = input.onlineOnly
        ? mergedServices.filter((service) => service.online === true)
        : mergedServices;
    return {
        services,
        discoverySource: directory.source,
        fallbackUsed: directory.fallbackUsed,
    };
}
async function listRuntimeDirectoryMasters(input) {
    const localMasterState = await input.masterStateStore.read();
    const localMasters = localMasterState.masters
        .filter((master) => master.available === 1)
        .map((master) => summarizeMaster(master, {
        online: input.localProviderOnline
            && normalizeText(master.providerGlobalMetaId) === normalizeText(input.providerGlobalMetaId),
        lastSeenSec: input.localProviderOnline ? input.localLastSeenSec : null,
        providerDaemonBaseUrl: input.providerDaemonBaseUrl || null,
    }));
    const directory = await (0, masterDirectory_1.readChainMasterDirectoryWithFallback)({
        chainApiBaseUrl: input.chainApiBaseUrl,
        onlineOnly: input.onlineOnly,
        fetchSeededDirectoryMasters: async () => fetchSeededDirectoryMasters(input.directorySeedsPath),
    });
    return {
        masters: (0, masterDirectory_1.listMasters)({
            entries: [
                ...directory.masters,
                ...localMasters,
            ],
            onlineOnly: input.onlineOnly,
            host: input.host,
            masterKind: input.masterKind,
        }),
        discoverySource: directory.source,
        fallbackUsed: directory.fallbackUsed,
    };
}
async function resolveExplicitMasterTarget(input) {
    const servicePinId = normalizeText(input.draft.target.servicePinId);
    const providerGlobalMetaId = normalizeText(input.draft.target.providerGlobalMetaId);
    const masterKind = normalizeText(input.draft.target.masterKind);
    if (!servicePinId || !providerGlobalMetaId || !masterKind) {
        return {
            selectedMaster: null,
            failureCode: null,
            failureMessage: null,
        };
    }
    const directory = await listRuntimeDirectoryMasters({
        masterStateStore: input.masterStateStore,
        directorySeedsPath: input.directorySeedsPath,
        chainApiBaseUrl: input.chainApiBaseUrl,
        onlineOnly: false,
        host: '',
        masterKind: undefined,
        localProviderOnline: input.localProviderOnline,
        localLastSeenSec: input.localLastSeenSec,
        providerDaemonBaseUrl: input.providerDaemonBaseUrl,
        providerGlobalMetaId: input.providerGlobalMetaId,
    });
    return (0, masterSelector_1.resolveMasterCandidate)({
        hostMode: normalizeText(input.host) || DEFAULT_MASTER_HOST_MODE,
        preferredMasterPinId: servicePinId,
        preferredProviderGlobalMetaId: providerGlobalMetaId,
        preferredMasterKind: masterKind,
        onlineOnly: input.onlineOnly === true,
        candidates: directory.masters,
    });
}
async function resolveSuggestedMasterTarget(input) {
    const explicit = await resolveExplicitMasterTarget({
        draft: input.draft,
        masterStateStore: input.masterStateStore,
        directorySeedsPath: input.directorySeedsPath,
        chainApiBaseUrl: input.chainApiBaseUrl,
        host: input.host,
        onlineOnly: true,
        providerGlobalMetaId: input.providerGlobalMetaId,
        localProviderOnline: input.localProviderOnline,
        localLastSeenSec: input.localLastSeenSec,
        providerDaemonBaseUrl: input.providerDaemonBaseUrl,
    });
    if (explicit.selectedMaster?.online) {
        return explicit.selectedMaster;
    }
    const preferredMasterKind = normalizeText(input.preferredMasterKind) || normalizeText(input.draft.target.masterKind);
    const directory = await listRuntimeDirectoryMasters({
        masterStateStore: input.masterStateStore,
        directorySeedsPath: input.directorySeedsPath,
        chainApiBaseUrl: input.chainApiBaseUrl,
        onlineOnly: true,
        host: normalizeText(input.host) || DEFAULT_MASTER_HOST_MODE,
        masterKind: preferredMasterKind || undefined,
        localProviderOnline: input.localProviderOnline,
        localLastSeenSec: input.localLastSeenSec,
        providerDaemonBaseUrl: input.providerDaemonBaseUrl,
        providerGlobalMetaId: input.providerGlobalMetaId,
    });
    const trustedMasterSet = new Set((input.trustedMasters ?? [])
        .map((entry) => normalizeText(entry))
        .filter(Boolean));
    return (0, masterSelector_1.selectMasterCandidate)({
        hostMode: normalizeText(input.host) || DEFAULT_MASTER_HOST_MODE,
        preferredMasterKind,
        trustedMasters: [...trustedMasterSet],
        onlineOnly: true,
        candidates: directory.masters,
    });
}
function commandFailedForExplicitMasterSelection(input) {
    const message = input.selection.failureMessage || input.notFoundMessage;
    if (input.selection.failureCode === 'master_offline') {
        return (0, commandResult_1.commandFailed)('master_offline', message);
    }
    if (input.selection.failureCode === 'master_host_mode_mismatch') {
        return (0, commandResult_1.commandFailed)('master_host_mode_mismatch', message);
    }
    return (0, commandResult_1.commandFailed)('master_target_not_found', message);
}
async function persistTraceRecord(runtimeStateStore, trace) {
    await runtimeStateStore.updateState((state) => ({
        ...state,
        traces: [
            trace,
            ...state.traces.filter((entry) => entry.traceId !== trace.traceId),
        ],
    }));
}
async function createMasterAskPreviewResult(input) {
    if (!input.state.identity) {
        return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before asking a Master.');
    }
    const draft = {
        ...input.draft,
        triggerMode: normalizeText(input.triggerModeOverride) || input.draft.triggerMode,
    };
    const now = Date.now();
    const traceId = normalizeText(input.traceIdOverride) || buildMasterTraceId({
        providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
        servicePinId: input.resolvedTarget.masterPinId,
        question: draft.question,
        now,
    });
    const requestId = buildMasterRequestId(now);
    const callerHost = normalizeText(input.callerHostOverride) || DEFAULT_MASTER_HOST_MODE;
    let prepared;
    try {
        prepared = (0, masterPreview_1.buildMasterAskPreview)({
            draft,
            resolvedTarget: input.resolvedTarget,
            caller: {
                globalMetaId: input.state.identity.globalMetaId,
                name: input.state.identity.name,
                host: callerHost,
            },
            traceId,
            requestId,
            confirmationMode: input.config.askMaster.confirmationMode,
            requiresConfirmationOverride: input.requiresConfirmationOverride,
        });
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('invalid_master_ask_draft', error instanceof Error ? error.message : String(error));
    }
    const pendingAskRecord = {
        traceId,
        requestId,
        createdAt: now,
        updatedAt: now,
        confirmationState: 'awaiting_confirmation',
        requestJson: prepared.requestJson,
        request: prepared.request,
        target: prepared.preview.target,
        preview: prepared.preview,
    };
    await input.pendingMasterAskStateStore.put({
        ...pendingAskRecord,
    });
    const previewLatestEvent = normalizeText(input.latestEventOverride) || 'master_preview_ready';
    const trace = (0, sessionTrace_1.buildSessionTrace)({
        traceId,
        channel: 'a2a',
        exportRoot: input.runtimeStateStore.paths.exportsRoot,
        session: {
            id: `master-${traceId}`,
            title: `${input.resolvedTarget.displayName} Ask`,
            type: 'a2a',
            metabotId: input.state.identity.metabotId,
            peerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
            peerName: input.resolvedTarget.displayName,
            externalConversationId: `master:${input.state.identity.globalMetaId}:${input.resolvedTarget.providerGlobalMetaId}:${traceId}`,
        },
        a2a: {
            role: 'caller',
            publicStatus: 'awaiting_confirmation',
            latestEvent: previewLatestEvent,
            taskRunState: 'queued',
            callerGlobalMetaId: input.state.identity.globalMetaId,
            callerName: input.state.identity.name,
            providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
            providerName: input.resolvedTarget.displayName,
            servicePinId: input.resolvedTarget.masterPinId,
        },
        askMaster: (0, masterTrace_1.buildMasterTraceMetadata)({
            role: 'caller',
            latestEvent: previewLatestEvent,
            publicStatus: 'awaiting_confirmation',
            requestId,
            masterKind: input.resolvedTarget.masterKind,
            servicePinId: input.resolvedTarget.masterPinId,
            providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
            displayName: input.resolvedTarget.displayName,
            triggerMode: normalizeText(prepared.request.trigger.mode),
            contextMode: normalizeText(prepared.request.extensions?.contextMode),
            confirmationMode: input.config.askMaster.confirmationMode,
            preview: {
                userTask: prepared.request.task.userTask,
                question: prepared.request.task.question,
            },
            auto: input.askMasterAutoMetadata,
        }),
    });
    const artifacts = await (0, transcriptExport_1.exportSessionArtifacts)({
        trace,
        transcript: {
            sessionId: trace.session.id,
            title: trace.session.title || 'Ask Master',
            messages: [
                {
                    id: `${traceId}-user`,
                    type: 'user',
                    timestamp: now,
                    content: prepared.request.task.question,
                },
                {
                    id: `${traceId}-assistant`,
                    type: 'assistant',
                    timestamp: now,
                    content: `Ask Master preview prepared for ${input.resolvedTarget.displayName}.`,
                    metadata: {
                        confirmCommand: prepared.preview.confirmation.confirmCommand,
                        servicePinId: input.resolvedTarget.masterPinId,
                        providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
                    },
                },
            ],
        },
    });
    await persistTraceRecord(input.runtimeStateStore, trace);
    if (input.afterPreviewPersisted) {
        await input.afterPreviewPersisted({
            trace,
            pendingAsk: pendingAskRecord,
            preview: prepared,
        });
    }
    if (!prepared.preview.confirmation.requiresConfirmation) {
        return input.state.identity && input.sendPreparedRequest
            ? input.sendPreparedRequest({
                traceId,
                pendingAsk: pendingAskRecord,
                resolvedTarget: input.resolvedTarget,
                state: input.state,
                config: input.config,
            })
            : (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before asking a Master.');
    }
    return (0, commandResult_1.commandAwaitingConfirmation)({
        traceId,
        requestId,
        confirmation: prepared.preview.confirmation,
        preview: prepared.preview,
        traceJsonPath: artifacts.traceJsonPath,
        traceMarkdownPath: artifacts.traceMarkdownPath,
        transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
    });
}
function buildStoredMasterSuggestDraft(input) {
    return {
        target: {
            servicePinId: input.resolvedTarget.masterPinId,
            providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
            masterKind: input.resolvedTarget.masterKind,
            displayName: input.resolvedTarget.displayName,
        },
        triggerMode: 'suggest',
        contextMode: input.draft.contextMode,
        userTask: input.draft.userTask,
        question: input.draft.question,
        goal: input.draft.goal,
        workspaceSummary: input.draft.workspaceSummary,
        errorSummary: input.draft.errorSummary,
        diffSummary: input.draft.diffSummary,
        relevantFiles: [...input.draft.relevantFiles],
        artifacts: [...input.draft.artifacts],
        constraints: [...input.draft.constraints],
        desiredOutput: input.draft.desiredOutput,
    };
}
function buildMasterSuggestTriggerObservation(input) {
    return {
        now: input.now,
        traceId: input.traceId,
        hostMode: input.hostMode,
        workspaceId: null,
        userIntent: {
            explicitlyAskedForMaster: false,
            explicitlyRejectedSuggestion: input.explicitlyRejectedSuggestion === true,
        },
        activity: {
            recentUserMessages: 0,
            recentAssistantMessages: 0,
            recentToolCalls: 0,
            recentFailures: 0,
            repeatedFailureCount: 0,
            noProgressWindowMs: null,
        },
        diagnostics: {
            failingTests: 0,
            failingCommands: 0,
            repeatedErrorSignatures: [...input.failureSignatures],
            uncertaintySignals: [],
        },
        workState: {
            hasPlan: false,
            todoBlocked: false,
            diffChangedRecently: false,
            onlyReadingWithoutConverging: false,
        },
        directory: {
            availableMasters: 1,
            trustedMasters: 0,
            onlineMasters: 1,
        },
        candidateMasterKindHint: input.masterKind,
    };
}
async function createMasterSuggestResult(input) {
    if (!input.state.identity) {
        return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before asking a Master.');
    }
    const now = Date.now();
    const traceId = normalizeText(input.observation.traceId) || buildMasterTraceId({
        providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
        servicePinId: input.resolvedTarget.masterPinId,
        question: input.draft.question,
        now,
    });
    const suggestionId = (0, masterSuggestState_1.buildMasterSuggestionId)(now);
    const hostMode = normalizeText(input.observation.hostMode) || DEFAULT_MASTER_HOST_MODE;
    const storedDraft = buildStoredMasterSuggestDraft({
        draft: input.draft,
        resolvedTarget: input.resolvedTarget,
    });
    const suggestionRecord = {
        suggestionId,
        traceId,
        createdAt: now,
        updatedAt: now,
        status: 'suggested',
        hostMode,
        candidateMasterKind: normalizeText(input.decision.candidateMasterKind) || input.resolvedTarget.masterKind,
        candidateDisplayName: input.resolvedTarget.displayName,
        reason: input.decision.reason,
        confidence: input.decision.confidence,
        failureSignatures: [...(input.observation.diagnostics?.repeatedErrorSignatures ?? [])],
        draft: storedDraft,
        target: {
            servicePinId: input.resolvedTarget.masterPinId,
            providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
            masterKind: input.resolvedTarget.masterKind,
            displayName: input.resolvedTarget.displayName,
        },
    };
    const trace = (0, sessionTrace_1.buildSessionTrace)({
        traceId,
        channel: 'a2a',
        exportRoot: input.runtimeStateStore.paths.exportsRoot,
        createdAt: now,
        session: {
            id: `master-${traceId}`,
            title: `${input.resolvedTarget.displayName} Ask`,
            type: 'a2a',
            metabotId: input.state.identity.metabotId,
            peerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
            peerName: input.resolvedTarget.displayName,
            externalConversationId: `master:${input.state.identity.globalMetaId}:${input.resolvedTarget.providerGlobalMetaId}:${traceId}`,
        },
        a2a: {
            role: 'caller',
            publicStatus: 'discovered',
            latestEvent: 'master_suggested',
            taskRunState: 'queued',
            callerGlobalMetaId: input.state.identity.globalMetaId,
            callerName: input.state.identity.name,
            providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
            providerName: input.resolvedTarget.displayName,
            servicePinId: input.resolvedTarget.masterPinId,
        },
        askMaster: (0, masterTrace_1.buildMasterTraceMetadata)({
            role: 'caller',
            canonicalStatus: 'suggested',
            latestEvent: 'master_suggested',
            publicStatus: 'discovered',
            requestId: null,
            masterKind: input.resolvedTarget.masterKind,
            servicePinId: input.resolvedTarget.masterPinId,
            providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
            displayName: input.resolvedTarget.displayName,
            triggerMode: 'suggest',
            contextMode: normalizeText(input.draft.contextMode) || input.config.askMaster.contextMode,
            confirmationMode: input.config.askMaster.confirmationMode,
            preview: {
                userTask: input.draft.userTask,
                question: input.draft.question,
            },
        }),
    });
    const artifacts = await (0, transcriptExport_1.exportSessionArtifacts)({
        trace,
        transcript: {
            sessionId: trace.session.id,
            title: trace.session.title || 'Ask Master Suggestion',
            messages: [
                {
                    id: `${traceId}-suggest`,
                    type: 'assistant',
                    timestamp: now,
                    content: `Suggest asking ${input.resolvedTarget.displayName}: ${input.decision.reason}`,
                    metadata: {
                        suggestionId,
                        confidence: input.decision.confidence,
                    },
                },
            ],
        },
    });
    await persistTraceRecord(input.runtimeStateStore, trace);
    await input.masterSuggestStateStore.put(suggestionRecord);
    return (0, commandResult_1.commandSuccess)({
        traceId,
        suggestion: {
            suggestionId,
            traceId,
            candidateMasterKind: suggestionRecord.candidateMasterKind,
            candidateDisplayName: suggestionRecord.candidateDisplayName,
            reason: suggestionRecord.reason,
            confidence: suggestionRecord.confidence,
            createdAt: suggestionRecord.createdAt,
        },
        traceJsonPath: artifacts.traceJsonPath,
        traceMarkdownPath: artifacts.traceMarkdownPath,
        transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
    });
}
function buildMasterRejectedSuggestionTrace(input) {
    const preview = input.baseTrace.askMaster?.preview ?? {
        userTask: normalizeText(input.suggestion.draft.userTask) || null,
        question: normalizeText(input.suggestion.draft.question) || null,
    };
    return {
        ...input.baseTrace,
        a2a: input.baseTrace.a2a
            ? {
                ...input.baseTrace.a2a,
                role: 'caller',
                publicStatus: 'discovered',
                latestEvent: 'master_suggestion_rejected',
                taskRunState: 'queued',
            }
            : null,
        askMaster: (0, masterTrace_1.buildMasterTraceMetadata)({
            role: 'caller',
            canonicalStatus: 'discovered',
            latestEvent: 'master_suggestion_rejected',
            publicStatus: 'discovered',
            requestId: null,
            masterKind: normalizeText(input.suggestion.target.masterKind) || input.baseTrace.askMaster?.masterKind,
            servicePinId: normalizeText(input.suggestion.target.servicePinId) || input.baseTrace.askMaster?.servicePinId,
            providerGlobalMetaId: normalizeText(input.suggestion.target.providerGlobalMetaId)
                || input.baseTrace.askMaster?.providerGlobalMetaId,
            displayName: normalizeText(input.suggestion.target.displayName)
                || input.baseTrace.askMaster?.displayName
                || input.baseTrace.session.peerName,
            triggerMode: 'suggest',
            contextMode: input.baseTrace.askMaster?.contextMode,
            confirmationMode: input.baseTrace.askMaster?.confirmationMode,
            preview,
        }),
    };
}
function buildMasterCallerTraceAfterReply(input) {
    const preview = input.baseTrace.askMaster?.preview ?? {
        userTask: input.pendingAsk.request.task.userTask,
        question: input.pendingAsk.request.task.question,
    };
    const response = input.response
        ? {
            status: input.response.status,
            summary: input.response.summary,
            followUpQuestion: input.response.followUpQuestion,
            errorCode: input.response.errorCode,
        }
        : input.baseTrace.askMaster?.response;
    const failure = input.response && (input.response.status === 'failed'
        || input.response.status === 'declined'
        || input.response.status === 'unavailable')
        ? {
            code: normalizeText(input.response.errorCode) || `master_${input.response.status}`,
            message: input.response.summary,
        }
        : null;
    return {
        ...input.baseTrace,
        a2a: {
            ...(input.baseTrace.a2a ?? {
                sessionId: null,
                taskRunId: null,
                role: 'caller',
                publicStatus: null,
                latestEvent: null,
                taskRunState: null,
                callerGlobalMetaId: null,
                callerName: null,
                providerGlobalMetaId: null,
                providerName: null,
                servicePinId: null,
            }),
            publicStatus: input.publicStatus,
            latestEvent: input.latestEvent,
            taskRunState: input.taskRunState,
        },
        askMaster: (0, masterTrace_1.buildMasterTraceMetadata)({
            role: input.baseTrace.a2a?.role,
            latestEvent: input.latestEvent,
            publicStatus: input.publicStatus,
            requestId: input.pendingAsk.requestId,
            masterKind: input.baseTrace.askMaster?.masterKind ?? input.pendingAsk.request.target.masterKind,
            servicePinId: input.baseTrace.askMaster?.servicePinId ?? input.pendingAsk.request.target.masterServicePinId,
            providerGlobalMetaId: input.baseTrace.askMaster?.providerGlobalMetaId ?? input.pendingAsk.request.target.providerGlobalMetaId,
            displayName: input.baseTrace.askMaster?.displayName
                || normalizeText(input.pendingAsk.target.displayName)
                || input.baseTrace.session.peerName,
            triggerMode: input.baseTrace.askMaster?.triggerMode ?? normalizeText(input.pendingAsk.request.trigger.mode),
            contextMode: input.baseTrace.askMaster?.contextMode ?? normalizeText(input.pendingAsk.request.extensions?.contextMode),
            confirmationMode: input.baseTrace.askMaster?.confirmationMode,
            preview,
            response,
            failure,
            auto: input.baseTrace.askMaster?.auto,
        }),
    };
}
async function exportAndPersistMasterCallerTrace(input) {
    const targetDisplayName = normalizeText(input.trace.askMaster?.displayName)
        || normalizeText(input.pendingAsk.target.displayName)
        || input.trace.session.peerName
        || 'Master';
    const shouldIncludeTimeoutNote = input.includeTimeoutNote === true
        || input.trace.askMaster?.canonicalStatus === 'timed_out'
        || input.trace.a2a?.publicStatus === 'timeout';
    const confirmCommand = `metabot master ask --trace-id ${input.trace.traceId} --confirm`;
    const messages = [
        {
            id: `${input.trace.traceId}-user`,
            type: 'user',
            timestamp: input.trace.createdAt,
            content: normalizeText(input.pendingAsk.request.task.question),
        },
        {
            id: `${input.trace.traceId}-preview`,
            type: 'assistant',
            timestamp: input.trace.createdAt,
            content: `Preview prepared for ${targetDisplayName}.`,
            metadata: {
                confirmCommand,
            },
        },
        {
            id: `${input.trace.traceId}-sent`,
            type: 'assistant',
            timestamp: Number.isFinite(input.pendingAsk.sentAt) ? Number(input.pendingAsk.sentAt) : input.outcome.timestamp,
            content: `Ask Master request sent to ${targetDisplayName} over simplemsg.`,
            metadata: {
                messagePinId: input.messagePinId,
                path: input.requestPath,
            },
        },
    ];
    if (shouldIncludeTimeoutNote) {
        messages.push({
            id: `${input.trace.traceId}-timeout`,
            type: 'status_note',
            timestamp: Math.max(input.trace.createdAt + 1, input.outcome.timestamp - (input.outcome.type === 'response' ? 1 : 0)),
            content: 'Foreground wait ended before the remote MetaBot returned. The task may still continue remotely.',
            metadata: {
                event: 'timeout',
            },
        });
    }
    if (input.outcome.type === 'response') {
        messages.push({
            id: `${input.trace.traceId}-response`,
            type: input.outcome.responseStatus === 'need_more_context'
                ? 'clarification_request'
                : input.outcome.responseStatus === 'failed'
                    || input.outcome.responseStatus === 'declined'
                    || input.outcome.responseStatus === 'unavailable'
                    ? 'system'
                    : 'assistant',
            timestamp: input.outcome.timestamp,
            content: normalizeText(input.outcome.summary),
            metadata: {
                responseStatus: input.outcome.responseStatus ?? null,
                followUpQuestion: input.outcome.followUpQuestion ?? null,
                deliveryPinId: input.outcome.deliveryPinId ?? null,
            },
        });
    }
    else if (input.outcome.type === 'timeout' && !shouldIncludeTimeoutNote) {
        messages.push({
            id: `${input.trace.traceId}-timeout`,
            type: 'status_note',
            timestamp: input.outcome.timestamp,
            content: 'Foreground wait ended before the remote MetaBot returned. The task may still continue remotely.',
            metadata: {
                event: 'timeout',
            },
        });
    }
    const artifacts = await (0, transcriptExport_1.exportSessionArtifacts)({
        trace: input.trace,
        transcript: {
            sessionId: input.trace.session.id,
            title: input.trace.session.title || 'Ask Master',
            messages,
        },
    });
    await persistTraceRecord(input.runtimeStateStore, input.trace);
    return artifacts;
}
async function applyMasterCallerReplyResult(input) {
    const responseStatus = input.reply.response.status;
    const includeTimeoutNote = input.trace.askMaster?.canonicalStatus === 'timed_out'
        || input.trace.a2a?.publicStatus === 'timeout';
    const session = responseStatus === 'completed'
        ? {
            state: 'completed',
            publicStatus: 'completed',
            event: 'provider_completed',
        }
        : responseStatus === 'need_more_context'
            ? {
                state: 'manual_action_required',
                publicStatus: 'manual_action_required',
                event: 'clarification_needed',
            }
            : {
                state: 'remote_failed',
                publicStatus: 'remote_failed',
                event: 'provider_failed',
            };
    const taskRunState = responseStatus === 'completed'
        ? 'completed'
        : responseStatus === 'need_more_context'
            ? 'needs_clarification'
            : 'failed';
    const trace = buildMasterCallerTraceAfterReply({
        baseTrace: input.trace,
        pendingAsk: input.pendingAsk,
        latestEvent: session.event,
        publicStatus: session.publicStatus,
        taskRunState,
        response: {
            status: input.reply.response.status,
            summary: input.reply.response.summary,
            followUpQuestion: input.reply.response.followUpQuestion,
            errorCode: input.reply.response.errorCode,
        },
    });
    const artifacts = await exportAndPersistMasterCallerTrace({
        trace,
        runtimeStateStore: input.runtimeStateStore,
        pendingAsk: input.pendingAsk,
        requestPath: input.requestPath,
        messagePinId: input.messagePinId,
        includeTimeoutNote,
        outcome: {
            type: 'response',
            timestamp: input.reply.observedAt ?? Date.now(),
            deliveryPinId: input.reply.deliveryPinId,
            responseStatus: input.reply.response.status,
            summary: input.reply.response.summary,
            followUpQuestion: input.reply.response.followUpQuestion,
        },
    });
    return {
        trace,
        artifacts,
        session,
    };
}
async function applyMasterCallerForegroundTimeout(input) {
    const trace = buildMasterCallerTraceAfterReply({
        baseTrace: input.trace,
        pendingAsk: input.pendingAsk,
        latestEvent: 'timeout',
        publicStatus: 'timeout',
        taskRunState: 'timeout',
    });
    const artifacts = await exportAndPersistMasterCallerTrace({
        trace,
        runtimeStateStore: input.runtimeStateStore,
        pendingAsk: input.pendingAsk,
        requestPath: input.requestPath,
        messagePinId: input.messagePinId,
        outcome: {
            type: 'timeout',
            timestamp: Date.now(),
        },
    });
    return {
        trace,
        artifacts,
        session: {
            state: 'timeout',
            publicStatus: 'timeout',
            event: 'timeout',
        },
    };
}
async function loadMasterContinuationTrace(input) {
    const runtimeState = await input.runtimeStateStore.readState();
    return runtimeState.traces.find((entry) => entry.traceId === input.traceId) ?? input.fallbackTrace;
}
async function rebuildTraceArtifactsFromSessionState(input) {
    const sessionState = await input.sessionStateStore.readState();
    const sessions = sessionState.sessions
        .filter((entry) => entry.traceId === input.baseTrace.traceId)
        .sort((left, right) => left.createdAt - right.createdAt);
    const latestSession = sessions.at(-1) ?? null;
    const taskRuns = sessionState.taskRuns
        .filter((entry) => latestSession && entry.sessionId === latestSession.sessionId)
        .sort((left, right) => left.createdAt - right.createdAt);
    const latestTaskRun = taskRuns.at(-1) ?? null;
    const sessionIds = new Set(sessions.map((entry) => entry.sessionId));
    const transcriptMessages = sessionState.transcriptItems
        .filter((entry) => sessionIds.has(entry.sessionId))
        .sort((left, right) => left.timestamp - right.timestamp)
        .map((entry) => ({
        id: entry.id,
        type: entry.sender === 'caller'
            ? 'user'
            : entry.sender === 'provider'
                ? 'assistant'
                : entry.type,
        timestamp: entry.timestamp,
        content: entry.content,
        metadata: entry.metadata ?? undefined,
    }));
    const latestSnapshot = sessionState.publicStatusSnapshots
        .filter((entry) => latestSession && entry.sessionId === latestSession.sessionId)
        .sort((left, right) => left.resolvedAt - right.resolvedAt)
        .at(-1);
    const nextTrace = (0, sessionTrace_1.buildSessionTrace)({
        traceId: input.baseTrace.traceId,
        channel: input.baseTrace.channel,
        exportRoot: input.runtimeStateStore.paths.exportsRoot,
        createdAt: input.baseTrace.createdAt,
        session: {
            ...input.baseTrace.session,
            externalConversationId: input.baseTrace.session.externalConversationId,
        },
        order: input.baseTrace.order,
        a2a: latestSession
            ? {
                sessionId: latestSession.sessionId,
                taskRunId: latestTaskRun?.runId ?? input.baseTrace.a2a?.taskRunId ?? null,
                role: latestSession.role,
                publicStatus: latestSnapshot?.status ?? input.baseTrace.a2a?.publicStatus ?? null,
                latestEvent: latestSnapshot?.rawEvent ?? input.baseTrace.a2a?.latestEvent ?? null,
                taskRunState: latestTaskRun?.state ?? input.baseTrace.a2a?.taskRunState ?? null,
                callerGlobalMetaId: latestSession.callerGlobalMetaId,
                callerName: input.baseTrace.a2a?.callerName ?? null,
                providerGlobalMetaId: latestSession.providerGlobalMetaId,
                providerName: input.baseTrace.a2a?.providerName ?? input.baseTrace.session.peerName ?? null,
                servicePinId: latestSession.servicePinId,
            }
            : input.baseTrace.a2a,
        askMaster: input.baseTrace.askMaster
            ? (0, masterTrace_1.buildMasterTraceMetadata)({
                role: latestSession?.role ?? input.baseTrace.a2a?.role,
                latestEvent: latestSnapshot?.rawEvent ?? input.baseTrace.a2a?.latestEvent,
                publicStatus: latestSnapshot?.status ?? input.baseTrace.a2a?.publicStatus,
                requestId: input.baseTrace.askMaster.requestId,
                masterKind: input.baseTrace.askMaster.masterKind,
                servicePinId: latestSession?.servicePinId
                    ?? input.baseTrace.askMaster.servicePinId
                    ?? input.baseTrace.a2a?.servicePinId,
                providerGlobalMetaId: latestSession?.providerGlobalMetaId
                    ?? input.baseTrace.askMaster.providerGlobalMetaId
                    ?? input.baseTrace.a2a?.providerGlobalMetaId,
                displayName: input.baseTrace.askMaster.displayName,
                triggerMode: input.baseTrace.askMaster.triggerMode,
                contextMode: input.baseTrace.askMaster.contextMode,
                confirmationMode: input.baseTrace.askMaster.confirmationMode,
                preview: input.baseTrace.askMaster.preview,
                response: input.baseTrace.askMaster.response,
                failure: input.baseTrace.askMaster.failure,
                auto: input.baseTrace.askMaster.auto,
            })
            : null,
    });
    const artifacts = await (0, transcriptExport_1.exportSessionArtifacts)({
        trace: nextTrace,
        transcript: {
            sessionId: nextTrace.session.id,
            title: nextTrace.session.title,
            messages: transcriptMessages,
        },
    });
    await persistTraceRecord(input.runtimeStateStore, nextTrace);
    return {
        trace: nextTrace,
        artifacts,
    };
}
async function loadCallerContinuationState(input) {
    const sessionState = await input.sessionStateStore.readState();
    const matchingSessions = sessionState.sessions
        .filter((entry) => entry.traceId === input.traceId && entry.role === 'caller')
        .sort((left, right) => left.updatedAt - right.updatedAt);
    const session = matchingSessions.find((entry) => entry.sessionId === input.sessionId)
        ?? matchingSessions.at(-1)
        ?? null;
    if (!session) {
        return null;
    }
    const taskRun = (session.currentTaskRunId
        ? sessionState.taskRuns.find((entry) => (entry.sessionId === session.sessionId && entry.runId === session.currentTaskRunId))
        : null) ?? sessionState.taskRuns
        .filter((entry) => entry.sessionId === session.sessionId)
        .sort((left, right) => left.updatedAt - right.updatedAt)
        .at(-1)
        ?? null;
    if (!taskRun) {
        return null;
    }
    const runtimeState = await input.runtimeStateStore.readState();
    const trace = runtimeState.traces.find((entry) => entry.traceId === input.traceId) ?? input.fallbackTrace;
    return {
        session,
        taskRun,
        trace,
    };
}
async function applyCallerReplyResult(input) {
    await input.sessionStateStore.appendPublicStatusSnapshots([
        {
            sessionId: input.session.sessionId,
            taskRunId: input.taskRun.runId,
            status: 'remote_received',
            mapped: true,
            rawEvent: 'provider_received',
            resolvedAt: input.reply.state === 'completed' && input.reply.observedAt
                ? input.reply.observedAt
                : Date.now(),
        },
    ]);
    const runnerResult = {
        state: 'completed',
        responseText: input.reply.state === 'completed' ? input.reply.responseText : '',
    };
    const mutation = input.sessionEngine.applyProviderRunnerResult({
        session: input.session,
        taskRun: input.taskRun,
        result: runnerResult,
    });
    const publicStatus = await persistSessionMutation(input.sessionStateStore, mutation);
    const transcriptItems = [
        {
            id: `${input.trace.traceId}-provider-delivery`,
            sessionId: input.session.sessionId,
            taskRunId: mutation.taskRun.runId,
            timestamp: mutation.session.updatedAt,
            type: 'assistant',
            sender: 'provider',
            content: input.reply.state === 'completed' ? input.reply.responseText : '',
            metadata: {
                publicStatus: publicStatus.status,
                event: mutation.event,
                deliveryPinId: input.reply.state === 'completed' ? input.reply.deliveryPinId : null,
            },
        },
    ];
    if (input.reply.state === 'completed' && normalizeText(input.reply.ratingRequestText)) {
        transcriptItems.push({
            id: `${input.trace.traceId}-provider-needs-rating`,
            sessionId: input.session.sessionId,
            taskRunId: mutation.taskRun.runId,
            timestamp: (input.reply.observedAt ?? mutation.session.updatedAt) + 1,
            type: 'rating_request',
            sender: 'provider',
            content: normalizeText(input.reply.ratingRequestText),
            metadata: {
                needsRating: true,
                event: 'needs_rating',
            },
        });
    }
    await appendA2ATranscriptItems(input.sessionStateStore, transcriptItems);
    const rebuilt = await rebuildTraceArtifactsFromSessionState({
        baseTrace: input.trace,
        runtimeStateStore: input.runtimeStateStore,
        sessionStateStore: input.sessionStateStore,
    });
    return {
        trace: rebuilt.trace,
        artifacts: rebuilt.artifacts,
        mutation,
    };
}
async function applyCallerForegroundTimeout(input) {
    const mutation = input.sessionEngine.markForegroundTimeout({
        session: input.session,
        taskRun: input.taskRun,
    });
    const publicStatus = await persistSessionMutation(input.sessionStateStore, mutation);
    await appendA2ATranscriptItems(input.sessionStateStore, [
        {
            id: `${input.trace.traceId}-caller-timeout`,
            sessionId: input.session.sessionId,
            taskRunId: mutation.taskRun.runId,
            timestamp: mutation.session.updatedAt,
            type: 'status_note',
            sender: 'system',
            content: 'Foreground wait ended before the remote MetaBot returned. The task may still continue remotely.',
            metadata: {
                publicStatus: publicStatus.status,
                event: mutation.event,
            },
        },
    ]);
    const rebuilt = await rebuildTraceArtifactsFromSessionState({
        baseTrace: input.trace,
        runtimeStateStore: input.runtimeStateStore,
        sessionStateStore: input.sessionStateStore,
    });
    return {
        trace: rebuilt.trace,
        artifacts: rebuilt.artifacts,
        mutation,
    };
}
function createDefaultMetabotDaemonHandlers(input) {
    const secretStore = input.secretStore ?? (0, fileSecretStore_1.createFileSecretStore)(input.homeDir);
    const signer = input.signer ?? (0, localMnemonicSigner_1.createLocalMnemonicSigner)({ secretStore });
    const configStore = (0, configStore_1.createConfigStore)(input.homeDir);
    const runtimeStateStore = (0, runtimeStateStore_1.createRuntimeStateStore)(input.homeDir);
    const masterStateStore = (0, masterPublishedState_1.createPublishedMasterStateStore)(input.homeDir);
    const pendingMasterAskStateStore = (0, masterPendingAskState_1.createPendingMasterAskStateStore)(input.homeDir);
    const masterSuggestStateStore = (0, masterSuggestState_1.createMasterSuggestStateStore)(input.homeDir);
    const masterAutoFeedbackStateStore = (0, masterAutoFeedbackState_1.createMasterAutoFeedbackStateStore)(input.homeDir);
    const providerPresenceStore = (0, providerPresenceState_1.createProviderPresenceStateStore)(input.homeDir);
    const ratingDetailStateStore = (0, ratingDetailState_1.createRatingDetailStateStore)(input.homeDir);
    const sessionStateStore = (0, sessionStateStore_1.createSessionStateStore)(input.homeDir);
    const privateChatStateStore = (0, privateChatStateStore_1.createPrivateChatStateStore)(input.homeDir);
    const autoReplyConfig = input.autoReplyConfig ?? {
        enabled: false,
        acceptPolicy: 'accept_all',
        defaultStrategyId: null,
    };
    const sessionEngine = (0, sessionEngine_1.createA2ASessionEngine)();
    const resolvePeerChatPublicKey = input.fetchPeerChatPublicKey ?? fetchPeerChatPublicKey;
    const callerReplyWaiter = input.callerReplyWaiter ?? (0, metawebReplyWaiter_1.createSocketIoMetaWebReplyWaiter)();
    const masterReplyWaiter = input.masterReplyWaiter ?? null;
    const normalizedSystemHomeDir = normalizeText(input.systemHomeDir) || input.homeDir;
    // Keep daemon-side follow-up consumers alive after foreground timeout so late deliveries still land in trace state.
    const pendingCallerReplyContinuations = new Map();
    const pendingMasterReplyContinuations = new Map();
    let masterTriggerMemoryState = (0, masterTriggerEngine_1.createMasterTriggerMemoryState)();
    const masterAutoPrepareCounts = new Map();
    let lastMasterAutoPreparedAt = null;
    function getMasterAutoPrepareCount(traceId) {
        const normalizedTraceId = normalizeText(traceId);
        if (!normalizedTraceId) {
            return 0;
        }
        return masterAutoPrepareCounts.get(normalizedTraceId) ?? 0;
    }
    function recordMasterAutoPrepare(traceId, now) {
        const normalizedTraceId = normalizeText(traceId);
        if (normalizedTraceId) {
            masterAutoPrepareCounts.set(normalizedTraceId, getMasterAutoPrepareCount(normalizedTraceId) + 1);
        }
        if (Number.isFinite(now)) {
            lastMasterAutoPreparedAt = Math.max(0, Math.trunc(now));
        }
    }
    function buildAutoTriggerReasonSignature(input) {
        const repeatedErrorSignatures = readStringArray(readObject(input.observation?.diagnostics)?.repeatedErrorSignatures);
        if (repeatedErrorSignatures.length > 0) {
            return repeatedErrorSignatures[0];
        }
        return normalizeText(input.autoReason) || null;
    }
    function buildAskMasterAutoMetadata(input) {
        const reason = normalizeText(input.reason) || null;
        const confidence = typeof input.confidence === 'number' && Number.isFinite(input.confidence)
            ? input.confidence
            : Number.isFinite(Number(input.confidence))
                ? Number(input.confidence)
                : null;
        const frictionMode = normalizeText(input.frictionMode);
        const sensitivityReasons = readStringArray(input.sensitivity?.reasons);
        const auto = {
            reason,
            confidence,
            frictionMode: frictionMode === 'preview_confirm' || frictionMode === 'direct_send'
                ? frictionMode
                : null,
            detectorVersion: normalizeText(input.detectorVersion) || null,
            selectedMasterTrusted: typeof input.selectedMasterTrusted === 'boolean'
                ? input.selectedMasterTrusted
                : null,
            sensitivity: input.sensitivity
                ? {
                    isSensitive: input.sensitivity.isSensitive === true,
                    reasons: sensitivityReasons,
                }
                : null,
        };
        return auto.reason
            || auto.confidence !== null
            || auto.frictionMode
            || auto.detectorVersion
            || auto.selectedMasterTrusted !== null
            || auto.sensitivity
            ? auto
            : null;
    }
    async function readMasterAutoFeedback(traceId) {
        const normalizedTraceId = normalizeText(traceId);
        if (!normalizedTraceId) {
            return null;
        }
        try {
            return await masterAutoFeedbackStateStore.get(normalizedTraceId);
        }
        catch {
            return null;
        }
    }
    async function putMasterAutoFeedback(input) {
        const traceId = normalizeText(input.traceId);
        if (!traceId) {
            return;
        }
        const existing = await readMasterAutoFeedback(traceId);
        const createdAt = Number.isFinite(input.createdAt) && input.createdAt !== null
            ? Math.max(0, Math.trunc(Number(input.createdAt)))
            : existing?.createdAt ?? Date.now();
        const updatedAt = Number.isFinite(input.updatedAt) && input.updatedAt !== null
            ? Math.max(0, Math.trunc(Number(input.updatedAt)))
            : Date.now();
        await masterAutoFeedbackStateStore.put({
            traceId,
            masterKind: normalizeText(input.masterKind) || existing?.masterKind || null,
            masterServicePinId: normalizeText(input.masterServicePinId) || existing?.masterServicePinId || null,
            triggerReasonSignature: normalizeText(input.triggerReasonSignature) || existing?.triggerReasonSignature || null,
            status: input.status,
            createdAt,
            updatedAt,
        });
    }
    async function registerActiveIdentityProfile(identity) {
        const profile = await (0, identityProfiles_1.upsertIdentityProfile)({
            systemHomeDir: normalizedSystemHomeDir,
            name: identity.name,
            homeDir: input.homeDir,
            globalMetaId: identity.globalMetaId,
            mvcAddress: identity.mvcAddress,
        });
        await (0, identityProfiles_1.setActiveMetabotHome)({
            systemHomeDir: normalizedSystemHomeDir,
            homeDir: profile.homeDir,
        });
    }
    function scheduleCallerReplyContinuation(input) {
        if (pendingCallerReplyContinuations.has(input.trace.traceId)) {
            return;
        }
        const continuation = (async () => {
            try {
                const reply = await callerReplyWaiter.awaitServiceReply({
                    ...input.waiterInput,
                    timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
                });
                if (reply.state !== 'completed') {
                    return;
                }
                const current = await loadCallerContinuationState({
                    traceId: input.trace.traceId,
                    sessionId: input.sessionId,
                    runtimeStateStore,
                    sessionStateStore,
                    fallbackTrace: input.trace,
                });
                if (!current || current.session.state === 'completed' || current.taskRun.state === 'completed') {
                    return;
                }
                await applyCallerReplyResult({
                    reply,
                    session: current.session,
                    taskRun: current.taskRun,
                    sessionEngine,
                    sessionStateStore,
                    runtimeStateStore,
                    trace: current.trace,
                });
            }
            catch {
                // Best effort follow-up: keep the persisted timeout state if late delivery capture fails.
            }
            finally {
                pendingCallerReplyContinuations.delete(input.trace.traceId);
            }
        })();
        pendingCallerReplyContinuations.set(input.trace.traceId, continuation);
    }
    function scheduleMasterReplyContinuation(input) {
        if (!masterReplyWaiter || pendingMasterReplyContinuations.has(input.trace.traceId)) {
            return;
        }
        const continuation = (async () => {
            try {
                const reply = await masterReplyWaiter.awaitMasterReply({
                    ...input.waiterInput,
                    timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
                });
                if (reply.state !== 'completed') {
                    return;
                }
                const currentTrace = await loadMasterContinuationTrace({
                    traceId: input.trace.traceId,
                    runtimeStateStore,
                    fallbackTrace: input.trace,
                });
                const currentStatus = normalizeText(currentTrace.askMaster?.canonicalStatus
                    ?? currentTrace.a2a?.publicStatus);
                if (currentStatus === 'completed'
                    || currentStatus === 'need_more_context'
                    || currentStatus === 'failed') {
                    return;
                }
                await applyMasterCallerReplyResult({
                    reply,
                    trace: currentTrace,
                    runtimeStateStore,
                    pendingAsk: input.pendingAsk,
                    requestPath: input.requestPath,
                    messagePinId: input.messagePinId,
                });
                if (normalizeText(input.pendingAsk.request.trigger.mode) === 'auto') {
                    await putMasterAutoFeedback({
                        traceId: input.trace.traceId,
                        status: 'completed',
                        masterKind: input.pendingAsk.request.target.masterKind,
                        masterServicePinId: input.pendingAsk.request.target.masterServicePinId,
                        updatedAt: reply.observedAt ?? Date.now(),
                    });
                }
            }
            catch {
                // Best effort follow-up: keep the persisted timeout state if late delivery capture fails.
            }
            finally {
                pendingMasterReplyContinuations.delete(input.trace.traceId);
            }
        })();
        pendingMasterReplyContinuations.set(input.trace.traceId, continuation);
    }
    async function sendPendingMasterAskRequest(input) {
        const initialState = await runtimeStateStore.readState();
        const currentIdentity = initialState.identity ?? input.state.identity;
        if (!currentIdentity) {
            return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before asking a Master.');
        }
        const existingTrace = initialState.traces.find((entry) => entry.traceId === input.traceId) ?? null;
        const previewConfirmation = readObject(input.pendingAsk.preview)?.confirmation;
        const requiresConfirmation = readObject(previewConfirmation)?.requiresConfirmation === true;
        const isAutoAsk = normalizeText(existingTrace?.askMaster?.triggerMode
            ?? input.pendingAsk.request.trigger.mode) === 'auto';
        const requestingLatestEvent = isAutoAsk && !requiresConfirmation
            ? 'auto_sent_without_confirmation'
            : 'request_sent';
        const markSendFailure = async (code, message) => {
            if (existingTrace) {
                const failedTrace = {
                    ...existingTrace,
                    a2a: {
                        ...(existingTrace.a2a ?? {
                            sessionId: null,
                            taskRunId: null,
                            role: 'caller',
                            publicStatus: null,
                            latestEvent: null,
                            taskRunState: null,
                            callerGlobalMetaId: currentIdentity.globalMetaId,
                            callerName: currentIdentity.name,
                            providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
                            providerName: input.resolvedTarget.displayName,
                            servicePinId: input.resolvedTarget.masterPinId,
                        }),
                        publicStatus: 'local_runtime_error',
                        latestEvent: 'provider_delivery_failed',
                        taskRunState: 'failed',
                    },
                    askMaster: (0, masterTrace_1.buildMasterTraceMetadata)({
                        role: existingTrace.a2a?.role ?? 'caller',
                        latestEvent: 'provider_delivery_failed',
                        publicStatus: 'local_runtime_error',
                        requestId: existingTrace.askMaster?.requestId ?? input.pendingAsk.requestId,
                        masterKind: existingTrace.askMaster?.masterKind ?? input.resolvedTarget.masterKind,
                        servicePinId: existingTrace.askMaster?.servicePinId ?? input.resolvedTarget.masterPinId,
                        providerGlobalMetaId: existingTrace.askMaster?.providerGlobalMetaId
                            ?? input.resolvedTarget.providerGlobalMetaId,
                        displayName: existingTrace.askMaster?.displayName ?? input.resolvedTarget.displayName,
                        triggerMode: existingTrace.askMaster?.triggerMode ?? normalizeText(input.pendingAsk.request.trigger.mode),
                        contextMode: existingTrace.askMaster?.contextMode
                            ?? normalizeText(input.pendingAsk.request.extensions?.contextMode),
                        confirmationMode: existingTrace.askMaster?.confirmationMode ?? input.config.askMaster.confirmationMode,
                        preview: existingTrace.askMaster?.preview ?? {
                            userTask: input.pendingAsk.request.task.userTask,
                            question: input.pendingAsk.request.task.question,
                        },
                        response: existingTrace.askMaster?.response,
                        failure: {
                            code,
                            message,
                        },
                        auto: existingTrace.askMaster?.auto,
                    }),
                };
                await (0, transcriptExport_1.exportSessionArtifacts)({
                    trace: failedTrace,
                    transcript: {
                        sessionId: failedTrace.session.id,
                        title: failedTrace.session.title || 'Ask Master',
                        messages: [
                            {
                                id: `${input.traceId}-user`,
                                type: 'user',
                                timestamp: failedTrace.createdAt,
                                content: normalizeText(input.pendingAsk.request.task.question),
                            },
                            {
                                id: `${input.traceId}-preview`,
                                type: 'assistant',
                                timestamp: failedTrace.createdAt,
                                content: `Preview prepared for ${normalizeText(input.pendingAsk.target.displayName) || input.resolvedTarget.displayName}.`,
                                metadata: requiresConfirmation
                                    ? {
                                        confirmCommand: `metabot master ask --trace-id ${input.traceId} --confirm`,
                                    }
                                    : undefined,
                            },
                            {
                                id: `${input.traceId}-failure`,
                                type: 'system',
                                timestamp: Date.now(),
                                content: `Ask Master auto send failed: ${message}`,
                                metadata: {
                                    code,
                                },
                            },
                        ],
                    },
                });
                await persistTraceRecord(runtimeStateStore, failedTrace);
            }
            if (isAutoAsk) {
                await putMasterAutoFeedback({
                    traceId: input.traceId,
                    status: 'prepared',
                    masterKind: existingTrace?.askMaster?.masterKind ?? input.resolvedTarget.masterKind,
                    masterServicePinId: existingTrace?.askMaster?.servicePinId ?? input.resolvedTarget.masterPinId,
                });
            }
            const traceSuffix = existingTrace ? ` Trace ID: ${input.traceId}` : '';
            return (0, commandResult_1.commandFailed)(code, `${message}${traceSuffix}`);
        };
        let privateChatIdentity;
        try {
            privateChatIdentity = await signer.getPrivateChatIdentity();
        }
        catch (error) {
            return markSendFailure('identity_secret_missing', error instanceof Error ? error.message : 'Local private chat key is missing from the secret store.');
        }
        const peerChatPublicKey = input.resolvedTarget.providerGlobalMetaId === currentIdentity.globalMetaId
            ? currentIdentity.chatPublicKey
            : await resolvePeerChatPublicKey(input.resolvedTarget.providerGlobalMetaId) ?? '';
        if (!peerChatPublicKey) {
            return markSendFailure('peer_chat_public_key_missing', 'Target Master has no published chat public key on chain.');
        }
        let outboundRequest;
        try {
            outboundRequest = (0, privateChat_1.sendPrivateChat)({
                fromIdentity: {
                    globalMetaId: privateChatIdentity.globalMetaId,
                    privateKeyHex: privateChatIdentity.privateKeyHex,
                },
                toGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
                peerChatPublicKey,
                content: input.pendingAsk.requestJson,
            });
        }
        catch (error) {
            return markSendFailure('master_request_build_failed', error instanceof Error ? error.message : String(error));
        }
        let messagePinId = '';
        try {
            const write = await signer.writePin({
                operation: 'create',
                path: outboundRequest.path,
                encryption: outboundRequest.encryption,
                version: outboundRequest.version,
                contentType: outboundRequest.contentType,
                payload: outboundRequest.payload,
                encoding: 'utf-8',
                network: 'mvc',
            });
            messagePinId = normalizeText(write.pinId);
        }
        catch (error) {
            return markSendFailure('master_request_broadcast_failed', error instanceof Error ? error.message : String(error));
        }
        const sentAt = Date.now();
        const sentPendingAsk = {
            ...input.pendingAsk,
            confirmationState: 'sent',
            updatedAt: sentAt,
            sentAt,
            messagePinId: messagePinId || null,
        };
        await pendingMasterAskStateStore.put(sentPendingAsk);
        if (isAutoAsk) {
            await putMasterAutoFeedback({
                traceId: input.traceId,
                status: 'sent',
                masterKind: input.resolvedTarget.masterKind,
                masterServicePinId: input.resolvedTarget.masterPinId,
                updatedAt: sentAt,
            });
        }
        const currentState = await runtimeStateStore.readState();
        const currentTrace = currentState.traces.find((entry) => entry.traceId === input.traceId);
        const updatedTrace = currentTrace
            ? {
                ...currentTrace,
                a2a: {
                    ...(currentTrace.a2a ?? {
                        sessionId: null,
                        taskRunId: null,
                        role: 'caller',
                        publicStatus: null,
                        latestEvent: null,
                        taskRunState: null,
                        callerGlobalMetaId: currentIdentity.globalMetaId,
                        callerName: currentIdentity.name,
                        providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
                        providerName: input.resolvedTarget.displayName,
                        servicePinId: input.resolvedTarget.masterPinId,
                    }),
                    publicStatus: 'requesting_remote',
                    latestEvent: requestingLatestEvent,
                    taskRunState: 'running',
                },
                askMaster: (0, masterTrace_1.buildMasterTraceMetadata)({
                    role: 'caller',
                    latestEvent: requestingLatestEvent,
                    publicStatus: 'requesting_remote',
                    requestId: input.pendingAsk.requestId,
                    masterKind: input.resolvedTarget.masterKind,
                    servicePinId: input.resolvedTarget.masterPinId,
                    providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
                    displayName: input.resolvedTarget.displayName,
                    triggerMode: currentTrace.askMaster?.triggerMode ?? normalizeText(input.pendingAsk.request.trigger.mode),
                    contextMode: currentTrace.askMaster?.contextMode
                        ?? normalizeText(input.pendingAsk.request.extensions?.contextMode),
                    confirmationMode: currentTrace.askMaster?.confirmationMode ?? input.config.askMaster.confirmationMode,
                    preview: currentTrace.askMaster?.preview ?? {
                        userTask: input.pendingAsk.request.task.userTask,
                        question: input.pendingAsk.request.task.question,
                    },
                    response: currentTrace.askMaster?.response,
                    failure: null,
                    auto: currentTrace.askMaster?.auto,
                }),
            }
            : (0, sessionTrace_1.buildSessionTrace)({
                traceId: input.traceId,
                channel: 'a2a',
                exportRoot: runtimeStateStore.paths.exportsRoot,
                session: {
                    id: `master-${input.traceId}`,
                    title: `${input.resolvedTarget.displayName} Ask`,
                    type: 'a2a',
                    metabotId: currentIdentity.metabotId,
                    peerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
                    peerName: input.resolvedTarget.displayName,
                    externalConversationId: `master:${currentIdentity.globalMetaId}:${input.resolvedTarget.providerGlobalMetaId}:${input.traceId}`,
                },
                a2a: {
                    role: 'caller',
                    publicStatus: 'requesting_remote',
                    latestEvent: requestingLatestEvent,
                    taskRunState: 'running',
                    callerGlobalMetaId: currentIdentity.globalMetaId,
                    callerName: currentIdentity.name,
                    providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
                    providerName: input.resolvedTarget.displayName,
                    servicePinId: input.resolvedTarget.masterPinId,
                },
                askMaster: (0, masterTrace_1.buildMasterTraceMetadata)({
                    role: 'caller',
                    latestEvent: requestingLatestEvent,
                    publicStatus: 'requesting_remote',
                    requestId: input.pendingAsk.requestId,
                    masterKind: input.resolvedTarget.masterKind,
                    servicePinId: input.resolvedTarget.masterPinId,
                    providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
                    displayName: input.resolvedTarget.displayName,
                    triggerMode: normalizeText(input.pendingAsk.request.trigger.mode),
                    contextMode: normalizeText(input.pendingAsk.request.extensions?.contextMode),
                    confirmationMode: input.config.askMaster.confirmationMode,
                    preview: {
                        userTask: input.pendingAsk.request.task.userTask,
                        question: input.pendingAsk.request.task.question,
                    },
                    auto: existingTrace?.askMaster?.auto ?? null,
                }),
            });
        const confirmCommand = `metabot master ask --trace-id ${input.traceId} --confirm`;
        const transcriptMessages = [
            {
                id: `${input.traceId}-user`,
                type: 'user',
                timestamp: updatedTrace.createdAt,
                content: normalizeText(input.pendingAsk.request.task.question),
            },
            ...(requiresConfirmation
                ? [{
                        id: `${input.traceId}-preview`,
                        type: 'assistant',
                        timestamp: updatedTrace.createdAt,
                        content: `Preview prepared for ${normalizeText(input.pendingAsk.target.displayName) || input.resolvedTarget.displayName}.`,
                        metadata: {
                            confirmCommand,
                        },
                    }]
                : []),
            {
                id: `${input.traceId}-sent`,
                type: 'assistant',
                timestamp: sentAt,
                content: `Ask Master request sent to ${input.resolvedTarget.displayName} over simplemsg.`,
                metadata: {
                    messagePinId: messagePinId || null,
                    path: outboundRequest.path,
                },
            },
        ];
        const artifacts = await (0, transcriptExport_1.exportSessionArtifacts)({
            trace: updatedTrace,
            transcript: {
                sessionId: updatedTrace.session.id,
                title: updatedTrace.session.title || 'Ask Master',
                messages: transcriptMessages,
            },
        });
        await persistTraceRecord(runtimeStateStore, updatedTrace);
        let finalTrace = updatedTrace;
        let finalArtifacts = artifacts;
        let finalSession = {
            state: 'requesting_remote',
            publicStatus: 'requesting_remote',
            event: 'request_sent',
        };
        let responseJson = null;
        let deliveryPinId = null;
        let structuredResponse = null;
        if (masterReplyWaiter) {
            const reply = await masterReplyWaiter.awaitMasterReply({
                callerGlobalMetaId: privateChatIdentity.globalMetaId,
                callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
                providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
                providerChatPublicKey: peerChatPublicKey,
                masterServicePinId: input.resolvedTarget.masterPinId,
                requestId: input.pendingAsk.requestId,
                traceId: input.traceId,
                timeoutMs: DEFAULT_CALLER_FOREGROUND_WAIT_MS,
            });
            if (reply.state === 'completed') {
                const applied = await applyMasterCallerReplyResult({
                    reply,
                    trace: updatedTrace,
                    runtimeStateStore,
                    pendingAsk: sentPendingAsk,
                    requestPath: outboundRequest.path,
                    messagePinId: messagePinId || null,
                });
                finalTrace = applied.trace;
                finalArtifacts = applied.artifacts;
                finalSession = applied.session;
                structuredResponse = reply.response;
                responseJson = reply.responseJson;
                deliveryPinId = reply.deliveryPinId;
                if (isAutoAsk) {
                    await putMasterAutoFeedback({
                        traceId: input.traceId,
                        status: 'completed',
                        masterKind: input.resolvedTarget.masterKind,
                        masterServicePinId: input.resolvedTarget.masterPinId,
                        updatedAt: reply.observedAt ?? Date.now(),
                    });
                }
            }
            else {
                const timedOut = await applyMasterCallerForegroundTimeout({
                    trace: updatedTrace,
                    runtimeStateStore,
                    pendingAsk: sentPendingAsk,
                    requestPath: outboundRequest.path,
                    messagePinId: messagePinId || null,
                });
                finalTrace = timedOut.trace;
                finalArtifacts = timedOut.artifacts;
                finalSession = timedOut.session;
                if (isAutoAsk) {
                    await putMasterAutoFeedback({
                        traceId: input.traceId,
                        status: 'timed_out',
                        masterKind: input.resolvedTarget.masterKind,
                        masterServicePinId: input.resolvedTarget.masterPinId,
                        updatedAt: Date.now(),
                    });
                }
                scheduleMasterReplyContinuation({
                    trace: timedOut.trace,
                    pendingAsk: sentPendingAsk,
                    requestPath: outboundRequest.path,
                    messagePinId: messagePinId || null,
                    waiterInput: {
                        callerGlobalMetaId: privateChatIdentity.globalMetaId,
                        callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
                        providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
                        providerChatPublicKey: peerChatPublicKey,
                        masterServicePinId: input.resolvedTarget.masterPinId,
                        requestId: input.pendingAsk.requestId,
                        traceId: input.traceId,
                        timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
                    },
                });
            }
        }
        return (0, commandResult_1.commandSuccess)({
            traceId: input.traceId,
            requestId: input.pendingAsk.requestId,
            messagePinId: messagePinId || null,
            ...(deliveryPinId ? { deliveryPinId } : {}),
            ...(structuredResponse ? {
                response: structuredResponse,
                responseJson,
            } : {}),
            session: finalSession,
            traceJsonPath: finalArtifacts.traceJsonPath,
            traceMarkdownPath: finalArtifacts.traceMarkdownPath,
            transcriptMarkdownPath: finalArtifacts.transcriptMarkdownPath,
        });
    }
    return {
        chain: {
            write: async (rawInput) => {
                try {
                    const result = await signer.writePin({
                        operation: typeof rawInput.operation === 'string' ? rawInput.operation : undefined,
                        path: typeof rawInput.path === 'string' ? rawInput.path : undefined,
                        encryption: typeof rawInput.encryption === 'string' ? rawInput.encryption : undefined,
                        version: typeof rawInput.version === 'string' ? rawInput.version : undefined,
                        contentType: typeof rawInput.contentType === 'string' ? rawInput.contentType : undefined,
                        payload: typeof rawInput.payload === 'string' ? rawInput.payload : undefined,
                        encoding: typeof rawInput.encoding === 'string' ? rawInput.encoding : undefined,
                        network: typeof rawInput.network === 'string' ? rawInput.network : undefined,
                    });
                    return (0, commandResult_1.commandSuccess)(result);
                }
                catch (error) {
                    return (0, commandResult_1.commandFailed)('chain_write_failed', error instanceof Error ? error.message : String(error));
                }
            },
        },
        buzz: {
            post: async (rawInput) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before posting buzz.');
                }
                try {
                    const result = await (0, postBuzz_1.postBuzzToChain)({
                        content: normalizeText(rawInput.content),
                        contentType: typeof rawInput.contentType === 'string' ? rawInput.contentType : undefined,
                        attachments: readStringArray(rawInput.attachments),
                        quotePin: typeof rawInput.quotePin === 'string' ? rawInput.quotePin : undefined,
                        network: typeof rawInput.network === 'string' ? rawInput.network : undefined,
                        signer,
                    });
                    return (0, commandResult_1.commandSuccess)({
                        ...result,
                        localUiUrl: buildDaemonLocalUiUrl(input.getDaemonRecord(), '/ui/buzz/app/index.html', { pinId: result.pinId }) ?? '/ui/buzz/app/index.html',
                    });
                }
                catch (error) {
                    return (0, commandResult_1.commandFailed)('buzz_post_failed', error instanceof Error ? error.message : String(error));
                }
            },
        },
        daemon: {
            getStatus: async () => {
                const daemon = input.getDaemonRecord();
                return (0, commandResult_1.commandSuccess)({
                    daemonId: daemon?.ownerId || 'metabot-daemon',
                    state: 'online',
                    lockOwner: daemon?.ownerId || 'metabot-daemon',
                    baseUrl: daemon?.baseUrl || null,
                    pid: daemon?.pid ?? process.pid,
                });
            },
            doctor: async () => {
                const state = await runtimeStateStore.readState();
                const daemon = input.getDaemonRecord();
                return (0, commandResult_1.commandSuccess)({
                    checks: [
                        { code: 'daemon_reachable', ok: true },
                        { code: 'identity_loaded', ok: Boolean(state.identity) },
                        { code: 'service_registry_loaded', ok: true, count: state.services.length },
                    ],
                    daemon: daemon
                        ? {
                            baseUrl: daemon.baseUrl,
                            pid: daemon.pid,
                        }
                        : null,
                });
            },
        },
        identity: {
            create: async ({ name }) => {
                const normalizedName = normalizeText(name);
                if (!normalizedName) {
                    return (0, commandResult_1.commandFailed)('missing_name', 'MetaBot identity name is required.');
                }
                const state = await runtimeStateStore.readState();
                const existingName = normalizeText(state.identity?.name);
                const profiles = await (0, identityProfiles_1.listIdentityProfiles)(normalizedSystemHomeDir);
                const duplicateMatch = (0, profileNameResolution_1.resolveProfileNameMatch)(normalizedName, profiles);
                if (duplicateMatch.status === 'matched'
                    && duplicateMatch.matchType !== 'ranked'
                    && node_path_1.default.resolve(duplicateMatch.match.homeDir) !== node_path_1.default.resolve(input.homeDir)) {
                    return (0, commandResult_1.commandFailed)('identity_name_taken', `Local MetaBot name "${normalizedName}" already exists. Use metabot identity assign --name "${duplicateMatch.match.name}".`);
                }
                if (duplicateMatch.status === 'ambiguous'
                    && duplicateMatch.candidates.some((profile) => node_path_1.default.resolve(profile.homeDir) !== node_path_1.default.resolve(input.homeDir))) {
                    return (0, commandResult_1.commandFailed)('identity_name_taken', duplicateMatch.message);
                }
                if (state.identity && existingName && existingName !== normalizedName) {
                    return (0, commandResult_1.commandFailed)('identity_name_conflict', `Current active local identity is "${existingName}". Switch profile first or choose the same name.`);
                }
                const existingIdentity = state.identity;
                if (existingIdentity && (0, localIdentityBootstrap_1.isIdentityBootstrapReady)(existingIdentity)) {
                    await (0, profileWorkspace_1.ensureProfileWorkspace)({
                        homeDir: input.homeDir,
                        name: existingIdentity.name,
                    });
                    await registerActiveIdentityProfile(existingIdentity);
                    return (0, commandResult_1.commandSuccess)(existingIdentity);
                }
                const resolvedHome = (0, profileWorkspace_1.resolveIdentityCreateProfileHome)({
                    systemHomeDir: normalizedSystemHomeDir,
                    requestedName: normalizedName,
                    profiles,
                });
                if (resolvedHome.status === 'duplicate') {
                    return (0, commandResult_1.commandFailed)('identity_name_taken', resolvedHome.message);
                }
                const requestName = state.identity?.name || normalizedName;
                await (0, profileWorkspace_1.ensureProfileWorkspace)({
                    homeDir: input.homeDir,
                    name: requestName,
                });
                const bootstrap = await (0, bootstrapFlow_1.runBootstrapFlow)({
                    request: {
                        name: requestName,
                    },
                    createMetabot: (0, localIdentityBootstrap_1.createLocalMetabotStep)({
                        runtimeStateStore,
                        secretStore,
                    }),
                    requestSubsidy: (0, localIdentityBootstrap_1.createMetabotSubsidyStep)({
                        runtimeStateStore,
                        requestMvcGasSubsidy: input.requestMvcGasSubsidy,
                    }),
                    syncIdentityToChain: (0, localIdentityBootstrap_1.createLocalIdentitySyncStep)({
                        runtimeStateStore,
                        signer,
                        stepDelayMs: input.identitySyncStepDelayMs,
                    }),
                });
                const nextState = await runtimeStateStore.readState();
                if (nextState.identity && (bootstrap.success || bootstrap.canSkip)) {
                    await registerActiveIdentityProfile(nextState.identity);
                    return (0, commandResult_1.commandSuccess)(nextState.identity);
                }
                return (0, commandResult_1.commandFailed)('identity_bootstrap_failed', bootstrap.error ?? 'MetaBot identity bootstrap failed before the identity was ready.');
            },
        },
        master: {
            publish: async (rawInput) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before publishing masters.');
                }
                const validation = (0, masterServiceSchema_1.validateMasterServicePayload)(rawInput);
                if (!validation.ok) {
                    return (0, commandResult_1.commandFailed)(validation.code, validation.message);
                }
                try {
                    const now = Date.now();
                    const network = typeof rawInput.network === 'string' ? rawInput.network : undefined;
                    const published = await (0, masterServicePublish_1.publishMasterToChain)({
                        signer,
                        creatorMetabotId: state.identity.metabotId,
                        providerGlobalMetaId: state.identity.globalMetaId,
                        providerAddress: state.identity.mvcAddress,
                        draft: validation.value,
                        now,
                        network,
                    });
                    await masterStateStore.update((currentState) => ({
                        masters: [
                            published.record,
                            ...currentState.masters.filter((master) => master.currentPinId !== published.record.currentPinId),
                        ],
                    }));
                    const presence = await providerPresenceStore.read();
                    const daemon = input.getDaemonRecord();
                    const online = isProviderPresenceOnline(presence, now);
                    const lastSeenSec = Number.isFinite(presence.lastHeartbeatAt)
                        ? Math.floor(Number(presence.lastHeartbeatAt) / 1000)
                        : null;
                    return (0, commandResult_1.commandSuccess)({
                        ...summarizeMaster(published.record, {
                            online,
                            lastSeenSec,
                            providerDaemonBaseUrl: daemon?.baseUrl || null,
                        }),
                        txids: published.chainWrite.txids,
                        totalCost: published.chainWrite.totalCost,
                        network: published.chainWrite.network,
                        operation: published.chainWrite.operation,
                        path: published.chainWrite.path,
                        contentType: published.chainWrite.contentType,
                    });
                }
                catch (error) {
                    return (0, commandResult_1.commandFailed)('master_publish_failed', error instanceof Error ? error.message : String(error));
                }
            },
            list: async ({ online, masterKind }) => {
                const state = await runtimeStateStore.readState();
                const daemon = input.getDaemonRecord();
                const presence = await providerPresenceStore.read();
                const localProviderOnline = isProviderPresenceOnline(presence);
                const localLastSeenSec = Number.isFinite(presence.lastHeartbeatAt)
                    ? Math.floor(Number(presence.lastHeartbeatAt) / 1000)
                    : null;
                const directory = await listRuntimeDirectoryMasters({
                    masterStateStore,
                    directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
                    chainApiBaseUrl: input.chainApiBaseUrl,
                    onlineOnly: online === true,
                    host: DEFAULT_MASTER_HOST_MODE,
                    masterKind,
                    localProviderOnline,
                    localLastSeenSec,
                    providerDaemonBaseUrl: daemon?.baseUrl || null,
                    providerGlobalMetaId: state.identity?.globalMetaId ?? null,
                });
                return (0, commandResult_1.commandSuccess)({
                    masters: directory.masters,
                    discoverySource: directory.discoverySource,
                    fallbackUsed: directory.fallbackUsed,
                });
            },
            hostAction: async (rawInput) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before asking a Master.');
                }
                const identity = state.identity;
                const request = readMasterHostActionRequest(rawInput);
                const actionKind = normalizeText(request.action.kind);
                const config = await configStore.read();
                if (!config.askMaster.enabled && actionKind !== 'reject_suggest' && actionKind !== 'reject_auto_preview') {
                    return (0, commandResult_1.commandFailed)('ask_master_disabled', 'Ask Master is disabled in the local config.');
                }
                const daemon = input.getDaemonRecord();
                const presence = await providerPresenceStore.read();
                const localProviderOnline = isProviderPresenceOnline(presence);
                const localLastSeenSec = Number.isFinite(presence.lastHeartbeatAt)
                    ? Math.floor(Number(presence.lastHeartbeatAt) / 1000)
                    : null;
                const hostContext = readObject(request.context) ?? {};
                const hostMode = normalizeText(hostContext.hostMode) || DEFAULT_MASTER_HOST_MODE;
                if (actionKind === 'accept_suggest') {
                    const traceId = normalizeText(request.action.traceId);
                    const suggestionId = normalizeText(request.action.suggestionId);
                    if (!traceId || !suggestionId) {
                        return (0, commandResult_1.commandFailed)('invalid_master_host_action', 'Accepting an Ask Master suggestion requires both traceId and suggestionId.');
                    }
                    let suggestion;
                    try {
                        suggestion = await masterSuggestStateStore.get(traceId, suggestionId);
                    }
                    catch {
                        return (0, commandResult_1.commandFailed)('master_suggestion_not_found', `Ask Master suggestion not found: ${traceId}:${suggestionId}`);
                    }
                    if (suggestion.status === 'rejected') {
                        return (0, commandResult_1.commandFailed)('master_suggestion_rejected', 'This Ask Master suggestion was already rejected.');
                    }
                    const previewDraft = readMasterAskDraft(suggestion.draft);
                    const resolvedTarget = await resolveExplicitMasterTarget({
                        draft: previewDraft,
                        masterStateStore,
                        directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
                        chainApiBaseUrl: input.chainApiBaseUrl,
                        host: suggestion.hostMode,
                        onlineOnly: true,
                        localProviderOnline,
                        localLastSeenSec,
                        providerDaemonBaseUrl: daemon?.baseUrl || null,
                        providerGlobalMetaId: identity.globalMetaId,
                    });
                    if (!resolvedTarget.selectedMaster) {
                        return commandFailedForExplicitMasterSelection({
                            selection: resolvedTarget,
                            notFoundMessage: 'Suggested Master is no longer available for preview.',
                        });
                    }
                    const policy = (0, masterPolicyGate_1.evaluateMasterPolicy)({
                        config: config.askMaster,
                        action: 'accept_suggest',
                        selectedMaster: resolvedTarget.selectedMaster,
                    });
                    if (!policy.allowed) {
                        return (0, commandResult_1.commandFailed)(policy.blockedReason === 'Ask Master is disabled by local config.'
                            ? 'ask_master_disabled'
                            : 'master_target_not_found', policy.blockedReason || 'Ask Master policy blocked the accepted suggestion.');
                    }
                    const previewResult = await createMasterAskPreviewResult({
                        draft: previewDraft,
                        resolvedTarget: resolvedTarget.selectedMaster,
                        state,
                        config,
                        runtimeStateStore,
                        pendingMasterAskStateStore,
                        triggerModeOverride: 'suggest',
                        callerHostOverride: suggestion.hostMode,
                        traceIdOverride: suggestion.traceId,
                        sendPreparedRequest: sendPendingMasterAskRequest,
                    });
                    if (previewResult.ok) {
                        const acceptedAt = Date.now();
                        await masterSuggestStateStore.put({
                            ...suggestion,
                            status: 'accepted',
                            updatedAt: acceptedAt,
                            acceptedAt,
                        });
                        masterTriggerMemoryState = (0, masterTriggerEngine_1.recordMasterTriggerOutcome)({
                            state: masterTriggerMemoryState,
                            observation: buildMasterSuggestTriggerObservation({
                                now: acceptedAt,
                                traceId: suggestion.traceId,
                                hostMode: suggestion.hostMode,
                                masterKind: suggestion.candidateMasterKind,
                                failureSignatures: suggestion.failureSignatures,
                            }),
                            decision: {
                                action: 'manual_requested',
                                reason: 'User accepted Ask Master suggestion.',
                            },
                        });
                    }
                    if (!previewResult.ok) {
                        return previewResult;
                    }
                    return {
                        ...previewResult,
                        data: {
                            ...previewResult.data,
                            hostAction: 'accept_suggest',
                            suggestionId,
                        },
                    };
                }
                if (actionKind === 'reject_suggest') {
                    const traceId = normalizeText(request.action.traceId);
                    const suggestionId = normalizeText(request.action.suggestionId);
                    if (!traceId || !suggestionId) {
                        return (0, commandResult_1.commandFailed)('invalid_master_host_action', 'Rejecting an Ask Master suggestion requires both traceId and suggestionId.');
                    }
                    let suggestion;
                    try {
                        suggestion = await masterSuggestStateStore.get(traceId, suggestionId);
                    }
                    catch {
                        return (0, commandResult_1.commandFailed)('master_suggestion_not_found', `Ask Master suggestion not found: ${traceId}:${suggestionId}`);
                    }
                    const rejectionReason = normalizeText(request.action.reason) || null;
                    const rejectedAt = Date.now();
                    await masterSuggestStateStore.put({
                        ...suggestion,
                        status: 'rejected',
                        updatedAt: rejectedAt,
                        rejectedAt,
                        rejectionReason,
                    });
                    masterTriggerMemoryState = (0, masterTriggerEngine_1.recordMasterTriggerOutcome)({
                        state: masterTriggerMemoryState,
                        observation: buildMasterSuggestTriggerObservation({
                            now: rejectedAt,
                            traceId: suggestion.traceId,
                            hostMode: suggestion.hostMode,
                            masterKind: suggestion.candidateMasterKind,
                            failureSignatures: suggestion.failureSignatures,
                            explicitlyRejectedSuggestion: true,
                        }),
                        decision: {
                            action: 'no_action',
                            reason: 'User rejected the previous suggestion.',
                        },
                    });
                    const currentState = await runtimeStateStore.readState();
                    const baseTrace = currentState.traces.find((entry) => entry.traceId === traceId) ?? null;
                    if (baseTrace) {
                        const updatedTrace = buildMasterRejectedSuggestionTrace({
                            baseTrace,
                            suggestion,
                            rejectedAt,
                        });
                        await (0, transcriptExport_1.exportSessionArtifacts)({
                            trace: updatedTrace,
                            transcript: {
                                sessionId: updatedTrace.session.id,
                                title: updatedTrace.session.title || 'Ask Master Suggestion',
                                messages: [
                                    {
                                        id: `${traceId}-suggest`,
                                        type: 'assistant',
                                        timestamp: suggestion.createdAt,
                                        content: `Suggest asking ${suggestion.target.displayName || suggestion.candidateDisplayName || 'the Master'}: ${suggestion.reason}`,
                                        metadata: {
                                            suggestionId,
                                            confidence: suggestion.confidence,
                                        },
                                    },
                                    {
                                        id: `${traceId}-reject`,
                                        type: 'user',
                                        timestamp: rejectedAt,
                                        content: rejectionReason
                                            ? `Rejected Ask Master suggestion: ${rejectionReason}`
                                            : 'Rejected Ask Master suggestion.',
                                        metadata: {
                                            event: 'master_suggestion_rejected',
                                            suggestionId,
                                        },
                                    },
                                ],
                            },
                        });
                        await persistTraceRecord(runtimeStateStore, updatedTrace);
                    }
                    return (0, commandResult_1.commandSuccess)({
                        hostAction: 'reject_suggest',
                        traceId,
                        suggestionId,
                        rejected: true,
                        reason: rejectionReason,
                    });
                }
                if (actionKind === 'reject_auto_preview') {
                    const traceId = normalizeText(request.action.traceId);
                    if (!traceId) {
                        return (0, commandResult_1.commandFailed)('invalid_master_host_action', 'Rejecting an automatic Ask Master preview requires traceId.');
                    }
                    let pendingAsk;
                    try {
                        pendingAsk = await pendingMasterAskStateStore.get(traceId);
                    }
                    catch {
                        return (0, commandResult_1.commandFailed)('pending_master_ask_not_found', `Pending Ask Master record not found: ${traceId}`);
                    }
                    if (normalizeText(pendingAsk.request.trigger.mode) !== 'auto') {
                        return (0, commandResult_1.commandFailed)('not_auto_preview', `Trace is not an automatic Ask Master preview: ${traceId}`);
                    }
                    if (pendingAsk.confirmationState === 'sent') {
                        return (0, commandResult_1.commandFailed)('master_request_already_sent', `Ask Master request has already been sent for this trace: ${traceId}.`);
                    }
                    const rejectedAt = Date.now();
                    const rejectionReason = normalizeText(request.action.reason) || null;
                    const currentState = await runtimeStateStore.readState();
                    const baseTrace = currentState.traces.find((entry) => entry.traceId === traceId) ?? null;
                    if (!baseTrace) {
                        return (0, commandResult_1.commandFailed)('trace_not_found', `Trace not found: ${traceId}`);
                    }
                    const updatedTrace = {
                        ...baseTrace,
                        a2a: {
                            ...(baseTrace.a2a ?? {
                                sessionId: null,
                                taskRunId: null,
                                role: 'caller',
                                publicStatus: null,
                                latestEvent: null,
                                taskRunState: null,
                                callerGlobalMetaId: state.identity.globalMetaId,
                                callerName: state.identity.name,
                                providerGlobalMetaId: pendingAsk.request.target.providerGlobalMetaId,
                                providerName: normalizeText(pendingAsk.target.displayName) || baseTrace.session.peerName,
                                servicePinId: pendingAsk.request.target.masterServicePinId,
                            }),
                            publicStatus: 'local_runtime_error',
                            latestEvent: 'auto_preview_rejected',
                            taskRunState: 'failed',
                        },
                        askMaster: (0, masterTrace_1.buildMasterTraceMetadata)({
                            role: 'caller',
                            latestEvent: 'auto_preview_rejected',
                            publicStatus: 'local_runtime_error',
                            requestId: pendingAsk.requestId,
                            masterKind: pendingAsk.request.target.masterKind,
                            servicePinId: pendingAsk.request.target.masterServicePinId,
                            providerGlobalMetaId: pendingAsk.request.target.providerGlobalMetaId,
                            displayName: normalizeText(pendingAsk.target.displayName) || baseTrace.askMaster?.displayName || baseTrace.session.peerName,
                            triggerMode: 'auto',
                            contextMode: baseTrace.askMaster?.contextMode ?? normalizeText(pendingAsk.request.extensions?.contextMode),
                            confirmationMode: baseTrace.askMaster?.confirmationMode ?? config.askMaster.confirmationMode,
                            preview: baseTrace.askMaster?.preview ?? {
                                userTask: pendingAsk.request.task.userTask,
                                question: pendingAsk.request.task.question,
                            },
                            response: baseTrace.askMaster?.response,
                            failure: {
                                code: 'auto_rejected_by_user',
                                message: rejectionReason
                                    ? `User declined the automatic Ask Master preview: ${rejectionReason}`
                                    : 'User declined the automatic Ask Master preview.',
                            },
                            auto: baseTrace.askMaster?.auto,
                        }),
                    };
                    await (0, transcriptExport_1.exportSessionArtifacts)({
                        trace: updatedTrace,
                        transcript: {
                            sessionId: updatedTrace.session.id,
                            title: updatedTrace.session.title || 'Ask Master',
                            messages: [
                                {
                                    id: `${traceId}-user`,
                                    type: 'user',
                                    timestamp: updatedTrace.createdAt,
                                    content: normalizeText(pendingAsk.request.task.question),
                                },
                                {
                                    id: `${traceId}-preview`,
                                    type: 'assistant',
                                    timestamp: updatedTrace.createdAt,
                                    content: `Preview prepared for ${normalizeText(pendingAsk.target.displayName) || updatedTrace.session.peerName || 'the Master'}.`,
                                    metadata: {
                                        confirmCommand: `metabot master ask --trace-id ${traceId} --confirm`,
                                    },
                                },
                                {
                                    id: `${traceId}-reject`,
                                    type: 'user',
                                    timestamp: rejectedAt,
                                    content: rejectionReason
                                        ? `Declined automatic Ask Master preview: ${rejectionReason}`
                                        : 'Declined automatic Ask Master preview.',
                                    metadata: {
                                        event: 'auto_preview_rejected',
                                        code: 'auto_rejected_by_user',
                                    },
                                },
                            ],
                        },
                    });
                    await persistTraceRecord(runtimeStateStore, updatedTrace);
                    await putMasterAutoFeedback({
                        traceId,
                        status: 'rejected',
                        masterKind: pendingAsk.request.target.masterKind,
                        masterServicePinId: pendingAsk.request.target.masterServicePinId,
                        updatedAt: rejectedAt,
                    });
                    return (0, commandResult_1.commandSuccess)({
                        hostAction: 'reject_auto_preview',
                        traceId,
                        rejected: true,
                        reason: rejectionReason,
                    });
                }
                if (actionKind !== 'manual_ask') {
                    return (0, commandResult_1.commandFailed)('not_implemented', `Master host-action kind is not implemented yet: ${actionKind || 'unknown'}.`);
                }
                const directory = await listRuntimeDirectoryMasters({
                    masterStateStore,
                    directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
                    chainApiBaseUrl: input.chainApiBaseUrl,
                    onlineOnly: false,
                    host: hostMode,
                    localProviderOnline,
                    localLastSeenSec,
                    providerDaemonBaseUrl: daemon?.baseUrl || null,
                    providerGlobalMetaId: identity.globalMetaId,
                });
                const eligibleMasters = directory.masters.map((entry) => (normalizeText(entry.providerGlobalMetaId) === identity.globalMetaId
                    ? {
                        ...entry,
                        online: true,
                    }
                    : entry));
                let prepared;
                try {
                    prepared = (0, masterHostAdapter_1.prepareManualAskHostAction)({
                        action: request.action,
                        context: request.context,
                        masters: eligibleMasters,
                        config: {
                            enabled: config.askMaster.enabled,
                            triggerMode: config.askMaster.triggerMode,
                            confirmationMode: config.askMaster.confirmationMode,
                            contextMode: config.askMaster.contextMode,
                            trustedMasters: config.askMaster.trustedMasters,
                        },
                    });
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const errorCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
                        ? error.code
                        : null;
                    return (0, commandResult_1.commandFailed)(errorCode
                        || (message.includes('No eligible online Master')
                            ? 'master_target_not_found'
                            : 'invalid_master_host_action'), message);
                }
                const previewDraft = readMasterAskDraft({
                    ...prepared.draft,
                    target: {
                        servicePinId: prepared.selectedTarget.masterPinId,
                        providerGlobalMetaId: prepared.selectedTarget.providerGlobalMetaId,
                        masterKind: prepared.selectedTarget.masterKind,
                        displayName: prepared.selectedTarget.displayName,
                    },
                });
                const previewResult = await createMasterAskPreviewResult({
                    draft: previewDraft,
                    resolvedTarget: prepared.selectedTarget,
                    state,
                    config,
                    runtimeStateStore,
                    pendingMasterAskStateStore,
                    triggerModeOverride: 'manual',
                    callerHostOverride: hostMode,
                    sendPreparedRequest: sendPendingMasterAskRequest,
                });
                if (previewResult.ok && previewResult.state === 'awaiting_confirmation') {
                    masterTriggerMemoryState = (0, masterTriggerEngine_1.recordMasterTriggerOutcome)({
                        state: masterTriggerMemoryState,
                        observation: {
                            now: Date.now(),
                            traceId: previewResult.data.traceId,
                            hostMode,
                            userIntent: {
                                explicitlyAskedForMaster: true,
                                explicitlyRejectedSuggestion: false,
                            },
                            directory: {
                                availableMasters: eligibleMasters.length,
                                trustedMasters: eligibleMasters.filter((entry) => (config.askMaster.trustedMasters.includes(entry.masterPinId))).length,
                                onlineMasters: eligibleMasters.filter((entry) => entry.online).length,
                            },
                            candidateMasterKindHint: prepared.selectedTarget.masterKind,
                        },
                        decision: {
                            action: 'manual_requested',
                            reason: 'Host adapter received a manual Ask Master action.',
                        },
                    });
                }
                if (!previewResult.ok) {
                    return previewResult;
                }
                return {
                    ...previewResult,
                    data: {
                        ...previewResult.data,
                        hostAction: 'manual_ask',
                    },
                };
            },
            ask: async (rawInput) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before asking a Master.');
                }
                const config = await configStore.read();
                if (!config.askMaster.enabled) {
                    return (0, commandResult_1.commandFailed)('ask_master_disabled', 'Ask Master is disabled in the local config.');
                }
                const daemon = input.getDaemonRecord();
                const presence = await providerPresenceStore.read();
                const localProviderOnline = isProviderPresenceOnline(presence);
                const localLastSeenSec = Number.isFinite(presence.lastHeartbeatAt)
                    ? Math.floor(Number(presence.lastHeartbeatAt) / 1000)
                    : null;
                if (rawInput.confirm === true) {
                    const traceId = normalizeText(rawInput.traceId);
                    if (!traceId) {
                        return (0, commandResult_1.commandFailed)('missing_trace_id', 'Master ask confirmation requires traceId.');
                    }
                    let pendingAsk;
                    try {
                        pendingAsk = await pendingMasterAskStateStore.get(traceId);
                    }
                    catch {
                        return (0, commandResult_1.commandFailed)('pending_master_ask_not_found', `Pending Ask Master record not found: ${traceId}`);
                    }
                    const isAutoPreview = normalizeText(pendingAsk.request.trigger.mode) === 'auto';
                    if (pendingAsk.confirmationState === 'sent') {
                        return (0, commandResult_1.commandFailed)('master_request_already_sent', `Ask Master request has already been sent for this trace: ${traceId}. Create a new Ask Master request to retry.`);
                    }
                    if (isAutoPreview) {
                        const feedback = await readMasterAutoFeedback(traceId);
                        if (feedback?.status === 'rejected') {
                            return (0, commandResult_1.commandFailed)('auto_preview_rejected', `This automatic Ask Master preview was already rejected: ${traceId}`);
                        }
                    }
                    const resolvedTarget = await resolveExplicitMasterTarget({
                        draft: {
                            target: {
                                servicePinId: normalizeText(pendingAsk.target.servicePinId),
                                providerGlobalMetaId: normalizeText(pendingAsk.target.providerGlobalMetaId),
                                masterKind: normalizeText(pendingAsk.target.masterKind),
                                displayName: normalizeText(pendingAsk.target.displayName) || null,
                            },
                            triggerMode: null,
                            contextMode: null,
                            userTask: normalizeText(pendingAsk.request.task.userTask),
                            question: normalizeText(pendingAsk.request.task.question),
                            goal: null,
                            workspaceSummary: null,
                            errorSummary: null,
                            diffSummary: null,
                            relevantFiles: [],
                            artifacts: [],
                            constraints: [],
                            desiredOutput: null,
                        },
                        masterStateStore,
                        directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
                        chainApiBaseUrl: input.chainApiBaseUrl,
                        host: normalizeText(pendingAsk.request.caller.host) || DEFAULT_MASTER_HOST_MODE,
                        localProviderOnline,
                        localLastSeenSec,
                        providerDaemonBaseUrl: daemon?.baseUrl || null,
                        providerGlobalMetaId: state.identity.globalMetaId,
                    });
                    if (!resolvedTarget.selectedMaster) {
                        return commandFailedForExplicitMasterSelection({
                            selection: resolvedTarget,
                            notFoundMessage: 'Target Master is no longer available for confirmation.',
                        });
                    }
                    const selectedTarget = resolvedTarget.selectedMaster;
                    let privateChatIdentity;
                    try {
                        privateChatIdentity = await signer.getPrivateChatIdentity();
                    }
                    catch (error) {
                        return (0, commandResult_1.commandFailed)('identity_secret_missing', error instanceof Error ? error.message : 'Local private chat key is missing from the secret store.');
                    }
                    const peerChatPublicKey = selectedTarget.providerGlobalMetaId === state.identity.globalMetaId
                        ? state.identity.chatPublicKey
                        : await resolvePeerChatPublicKey(selectedTarget.providerGlobalMetaId) ?? '';
                    if (!peerChatPublicKey) {
                        return (0, commandResult_1.commandFailed)('peer_chat_public_key_missing', 'Target Master has no published chat public key on chain.');
                    }
                    let outboundRequest;
                    try {
                        outboundRequest = (0, privateChat_1.sendPrivateChat)({
                            fromIdentity: {
                                globalMetaId: privateChatIdentity.globalMetaId,
                                privateKeyHex: privateChatIdentity.privateKeyHex,
                            },
                            toGlobalMetaId: selectedTarget.providerGlobalMetaId,
                            peerChatPublicKey,
                            content: pendingAsk.requestJson,
                        });
                    }
                    catch (error) {
                        return (0, commandResult_1.commandFailed)('master_request_build_failed', error instanceof Error ? error.message : String(error));
                    }
                    let messagePinId = '';
                    try {
                        const write = await signer.writePin({
                            operation: 'create',
                            path: outboundRequest.path,
                            encryption: outboundRequest.encryption,
                            version: outboundRequest.version,
                            contentType: outboundRequest.contentType,
                            payload: outboundRequest.payload,
                            encoding: 'utf-8',
                            network: 'mvc',
                        });
                        messagePinId = normalizeText(write.pinId);
                    }
                    catch (error) {
                        return (0, commandResult_1.commandFailed)('master_request_broadcast_failed', error instanceof Error ? error.message : String(error));
                    }
                    await pendingMasterAskStateStore.put({
                        ...pendingAsk,
                        confirmationState: 'sent',
                        updatedAt: Date.now(),
                        sentAt: Date.now(),
                        messagePinId: messagePinId || null,
                    });
                    if (isAutoPreview) {
                        await putMasterAutoFeedback({
                            traceId,
                            status: 'confirmed',
                            masterKind: pendingAsk.request.target.masterKind,
                            masterServicePinId: pendingAsk.request.target.masterServicePinId,
                            updatedAt: Date.now(),
                        });
                    }
                    const currentTrace = state.traces.find((entry) => entry.traceId === traceId);
                    const updatedTrace = currentTrace
                        ? {
                            ...currentTrace,
                            a2a: {
                                ...(currentTrace.a2a ?? {
                                    sessionId: null,
                                    taskRunId: null,
                                    role: 'caller',
                                    publicStatus: null,
                                    latestEvent: null,
                                    taskRunState: null,
                                    callerGlobalMetaId: state.identity.globalMetaId,
                                    callerName: state.identity.name,
                                    providerGlobalMetaId: selectedTarget.providerGlobalMetaId,
                                    providerName: selectedTarget.displayName,
                                    servicePinId: selectedTarget.masterPinId,
                                }),
                                publicStatus: 'requesting_remote',
                                latestEvent: 'request_sent',
                                taskRunState: 'running',
                            },
                            askMaster: (0, masterTrace_1.buildMasterTraceMetadata)({
                                role: 'caller',
                                latestEvent: 'request_sent',
                                publicStatus: 'requesting_remote',
                                requestId: pendingAsk.requestId,
                                masterKind: selectedTarget.masterKind,
                                servicePinId: selectedTarget.masterPinId,
                                providerGlobalMetaId: selectedTarget.providerGlobalMetaId,
                                displayName: selectedTarget.displayName,
                                triggerMode: currentTrace.askMaster?.triggerMode ?? normalizeText(pendingAsk.request.trigger.mode),
                                contextMode: currentTrace.askMaster?.contextMode
                                    ?? normalizeText(pendingAsk.request.extensions?.contextMode),
                                confirmationMode: currentTrace.askMaster?.confirmationMode ?? config.askMaster.confirmationMode,
                                preview: currentTrace.askMaster?.preview ?? {
                                    userTask: pendingAsk.request.task.userTask,
                                    question: pendingAsk.request.task.question,
                                },
                                response: currentTrace.askMaster?.response,
                                failure: null,
                                auto: currentTrace.askMaster?.auto,
                            }),
                        }
                        : (0, sessionTrace_1.buildSessionTrace)({
                            traceId,
                            channel: 'a2a',
                            exportRoot: runtimeStateStore.paths.exportsRoot,
                            session: {
                                id: `master-${traceId}`,
                                title: `${selectedTarget.displayName} Ask`,
                                type: 'a2a',
                                metabotId: state.identity.metabotId,
                                peerGlobalMetaId: selectedTarget.providerGlobalMetaId,
                                peerName: selectedTarget.displayName,
                                externalConversationId: `master:${state.identity.globalMetaId}:${selectedTarget.providerGlobalMetaId}:${traceId}`,
                            },
                            a2a: {
                                role: 'caller',
                                publicStatus: 'requesting_remote',
                                latestEvent: 'request_sent',
                                taskRunState: 'running',
                                callerGlobalMetaId: state.identity.globalMetaId,
                                callerName: state.identity.name,
                                providerGlobalMetaId: selectedTarget.providerGlobalMetaId,
                                providerName: selectedTarget.displayName,
                                servicePinId: selectedTarget.masterPinId,
                            },
                            askMaster: (0, masterTrace_1.buildMasterTraceMetadata)({
                                role: 'caller',
                                latestEvent: 'request_sent',
                                publicStatus: 'requesting_remote',
                                requestId: pendingAsk.requestId,
                                masterKind: selectedTarget.masterKind,
                                servicePinId: selectedTarget.masterPinId,
                                providerGlobalMetaId: selectedTarget.providerGlobalMetaId,
                                displayName: selectedTarget.displayName,
                                triggerMode: normalizeText(pendingAsk.request.trigger.mode),
                                contextMode: normalizeText(pendingAsk.request.extensions?.contextMode),
                                confirmationMode: config.askMaster.confirmationMode,
                                preview: {
                                    userTask: pendingAsk.request.task.userTask,
                                    question: pendingAsk.request.task.question,
                                },
                                auto: null,
                            }),
                        });
                    const confirmCommand = `metabot master ask --trace-id ${traceId} --confirm`;
                    const artifacts = await (0, transcriptExport_1.exportSessionArtifacts)({
                        trace: updatedTrace,
                        transcript: {
                            sessionId: updatedTrace.session.id,
                            title: updatedTrace.session.title || 'Ask Master',
                            messages: [
                                {
                                    id: `${traceId}-user`,
                                    type: 'user',
                                    timestamp: updatedTrace.createdAt,
                                    content: normalizeText(pendingAsk.request.task.question),
                                },
                                {
                                    id: `${traceId}-preview`,
                                    type: 'assistant',
                                    timestamp: updatedTrace.createdAt,
                                    content: `Preview prepared for ${normalizeText(pendingAsk.target.displayName) || selectedTarget.displayName}.`,
                                    metadata: {
                                        confirmCommand,
                                    },
                                },
                                {
                                    id: `${traceId}-sent`,
                                    type: 'assistant',
                                    timestamp: Date.now(),
                                    content: `Ask Master request sent to ${selectedTarget.displayName} over simplemsg.`,
                                    metadata: {
                                        messagePinId: messagePinId || null,
                                        path: outboundRequest.path,
                                    },
                                },
                            ],
                        },
                    });
                    await persistTraceRecord(runtimeStateStore, updatedTrace);
                    let finalTrace = updatedTrace;
                    let finalArtifacts = artifacts;
                    let finalSession = {
                        state: 'requesting_remote',
                        publicStatus: 'requesting_remote',
                        event: 'request_sent',
                    };
                    let responseJson = null;
                    let deliveryPinId = null;
                    let structuredResponse = null;
                    if (masterReplyWaiter) {
                        const reply = await masterReplyWaiter.awaitMasterReply({
                            callerGlobalMetaId: privateChatIdentity.globalMetaId,
                            callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
                            providerGlobalMetaId: selectedTarget.providerGlobalMetaId,
                            providerChatPublicKey: peerChatPublicKey,
                            masterServicePinId: selectedTarget.masterPinId,
                            requestId: pendingAsk.requestId,
                            traceId,
                            timeoutMs: DEFAULT_CALLER_FOREGROUND_WAIT_MS,
                        });
                        if (reply.state === 'completed') {
                            const applied = await applyMasterCallerReplyResult({
                                reply,
                                trace: updatedTrace,
                                runtimeStateStore,
                                pendingAsk,
                                requestPath: outboundRequest.path,
                                messagePinId: messagePinId || null,
                            });
                            finalTrace = applied.trace;
                            finalArtifacts = applied.artifacts;
                            finalSession = applied.session;
                            structuredResponse = reply.response;
                            responseJson = reply.responseJson;
                            deliveryPinId = reply.deliveryPinId;
                            if (isAutoPreview) {
                                await putMasterAutoFeedback({
                                    traceId,
                                    status: 'completed',
                                    masterKind: pendingAsk.request.target.masterKind,
                                    masterServicePinId: pendingAsk.request.target.masterServicePinId,
                                    updatedAt: reply.observedAt ?? Date.now(),
                                });
                            }
                        }
                        else {
                            const timedOut = await applyMasterCallerForegroundTimeout({
                                trace: updatedTrace,
                                runtimeStateStore,
                                pendingAsk,
                                requestPath: outboundRequest.path,
                                messagePinId: messagePinId || null,
                            });
                            finalTrace = timedOut.trace;
                            finalArtifacts = timedOut.artifacts;
                            finalSession = timedOut.session;
                            if (isAutoPreview) {
                                await putMasterAutoFeedback({
                                    traceId,
                                    status: 'timed_out',
                                    masterKind: pendingAsk.request.target.masterKind,
                                    masterServicePinId: pendingAsk.request.target.masterServicePinId,
                                    updatedAt: Date.now(),
                                });
                            }
                            scheduleMasterReplyContinuation({
                                trace: timedOut.trace,
                                pendingAsk: {
                                    ...pendingAsk,
                                    confirmationState: 'sent',
                                    updatedAt: Date.now(),
                                    sentAt: Number.isFinite(pendingAsk.sentAt) ? pendingAsk.sentAt : Date.now(),
                                    messagePinId: messagePinId || null,
                                },
                                requestPath: outboundRequest.path,
                                messagePinId: messagePinId || null,
                                waiterInput: {
                                    callerGlobalMetaId: privateChatIdentity.globalMetaId,
                                    callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
                                    providerGlobalMetaId: selectedTarget.providerGlobalMetaId,
                                    providerChatPublicKey: peerChatPublicKey,
                                    masterServicePinId: selectedTarget.masterPinId,
                                    requestId: pendingAsk.requestId,
                                    traceId,
                                    timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
                                },
                            });
                        }
                    }
                    return (0, commandResult_1.commandSuccess)({
                        traceId,
                        requestId: pendingAsk.requestId,
                        messagePinId: messagePinId || null,
                        ...(deliveryPinId ? { deliveryPinId } : {}),
                        ...(structuredResponse ? {
                            response: structuredResponse,
                            responseJson,
                        } : {}),
                        session: finalSession,
                        traceJsonPath: finalArtifacts.traceJsonPath,
                        traceMarkdownPath: finalArtifacts.traceMarkdownPath,
                        transcriptMarkdownPath: finalArtifacts.transcriptMarkdownPath,
                    });
                }
                const draft = readMasterAskDraft(rawInput);
                const resolvedTarget = await resolveExplicitMasterTarget({
                    draft,
                    masterStateStore,
                    directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
                    chainApiBaseUrl: input.chainApiBaseUrl,
                    localProviderOnline,
                    localLastSeenSec,
                    providerDaemonBaseUrl: daemon?.baseUrl || null,
                    providerGlobalMetaId: state.identity.globalMetaId,
                });
                if (!resolvedTarget.selectedMaster) {
                    return commandFailedForExplicitMasterSelection({
                        selection: resolvedTarget,
                        notFoundMessage: 'Target Master could not be resolved from the local directory.',
                    });
                }
                const selectedTarget = resolvedTarget.selectedMaster;
                const previewResult = await createMasterAskPreviewResult({
                    draft,
                    resolvedTarget: selectedTarget,
                    state,
                    config,
                    runtimeStateStore,
                    pendingMasterAskStateStore,
                    triggerModeOverride: 'manual',
                    sendPreparedRequest: sendPendingMasterAskRequest,
                });
                if (previewResult.ok && previewResult.state === 'awaiting_confirmation') {
                    masterTriggerMemoryState = (0, masterTriggerEngine_1.recordMasterTriggerOutcome)({
                        state: masterTriggerMemoryState,
                        observation: {
                            now: Date.now(),
                            traceId: previewResult.data.traceId,
                            hostMode: DEFAULT_MASTER_HOST_MODE,
                            userIntent: {
                                explicitlyAskedForMaster: true,
                                explicitlyRejectedSuggestion: false,
                            },
                            directory: {
                                availableMasters: 1,
                                trustedMasters: config.askMaster.trustedMasters.includes(selectedTarget.masterPinId) ? 1 : 0,
                                onlineMasters: selectedTarget.online ? 1 : 0,
                            },
                            candidateMasterKindHint: selectedTarget.masterKind,
                        },
                        decision: {
                            action: 'manual_requested',
                            reason: 'Caller explicitly invoked metabot master ask.',
                        },
                    });
                }
                return previewResult;
            },
            suggest: async (rawInput) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before asking a Master.');
                }
                const config = await configStore.read();
                const daemon = input.getDaemonRecord();
                const presence = await providerPresenceStore.read();
                const localProviderOnline = isProviderPresenceOnline(presence);
                const localLastSeenSec = Number.isFinite(presence.lastHeartbeatAt)
                    ? Math.floor(Number(presence.lastHeartbeatAt) / 1000)
                    : null;
                const draft = readMasterAskDraft(readObject(rawInput.draft) ?? rawInput);
                const directoryPresence = readMasterTriggerDirectoryPresence(rawInput);
                const observation = await hydrateMasterTriggerObservationDirectory({
                    observation: readMasterTriggerObservation(rawInput),
                    trustedMasters: config.askMaster.trustedMasters,
                    directoryPresence,
                    masterStateStore,
                    directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
                    chainApiBaseUrl: input.chainApiBaseUrl,
                    localProviderOnline,
                    localLastSeenSec,
                    providerDaemonBaseUrl: daemon?.baseUrl || null,
                    providerGlobalMetaId: state.identity.globalMetaId,
                });
                const suggestState = await masterSuggestStateStore.read();
                const autoFeedbackState = await masterAutoFeedbackStateStore.read();
                const trigger = await (0, masterTriggerEngine_1.collectAndEvaluateMasterTrigger)({
                    config: config.askMaster,
                    suppression: (0, masterTriggerEngine_1.mergeMasterTriggerMemoryStates)(masterTriggerMemoryState, (0, masterSuggestState_1.deriveMasterTriggerMemoryStateFromSuggestState)({
                        state: suggestState,
                        now: observation.now,
                    }), (0, masterAutoFeedbackState_1.deriveMasterTriggerMemoryStateFromAutoFeedbackState)({
                        state: autoFeedbackState,
                        now: observation.now,
                    })),
                    collectObservation: async () => observation,
                });
                if (trigger.collected
                    && (trigger.observation?.userIntent.explicitlyRejectedSuggestion
                        || trigger.observation?.userIntent.explicitlyRejectedAutoAsk)) {
                    masterTriggerMemoryState = (0, masterTriggerEngine_1.recordMasterTriggerOutcome)({
                        state: masterTriggerMemoryState,
                        observation: trigger.observation,
                        decision: trigger.decision,
                    });
                }
                if (trigger.decision.action === 'no_action') {
                    const blocked = trigger.decision.reason === 'Ask Master is disabled by local config.'
                        ? {
                            code: 'ask_master_disabled',
                            message: trigger.decision.reason,
                        }
                        : trigger.decision.reason === 'Ask Master trigger mode is manual.'
                            ? {
                                code: 'trigger_mode_disallows_suggest',
                                message: trigger.decision.reason,
                            }
                            : null;
                    return (0, commandResult_1.commandSuccess)({
                        collected: trigger.collected,
                        decision: trigger.decision,
                        blocked,
                    });
                }
                if (trigger.decision.action === 'manual_requested') {
                    const policy = (0, masterPolicyGate_1.evaluateMasterPolicy)({
                        config: config.askMaster,
                        action: trigger.decision.action,
                        selectedMaster: null,
                    });
                    if (trigger.observation) {
                        masterTriggerMemoryState = (0, masterTriggerEngine_1.recordMasterTriggerOutcome)({
                            state: masterTriggerMemoryState,
                            observation: trigger.observation,
                            decision: trigger.decision,
                        });
                    }
                    return (0, commandResult_1.commandSuccess)({
                        collected: trigger.collected,
                        decision: policy.allowed
                            ? trigger.decision
                            : {
                                action: 'no_action',
                                reason: policy.blockedReason || trigger.decision.reason,
                            },
                        blocked: !policy.allowed
                            ? {
                                code: policy.code,
                                message: policy.blockedReason || trigger.decision.reason,
                            }
                            : null,
                    });
                }
                const resolvedTarget = await resolveSuggestedMasterTarget({
                    draft,
                    preferredMasterKind: 'candidateMasterKind' in trigger.decision
                        ? normalizeText(trigger.decision.candidateMasterKind)
                        : null,
                    trustedMasters: config.askMaster.trustedMasters,
                    masterStateStore,
                    directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
                    chainApiBaseUrl: input.chainApiBaseUrl,
                    host: observation.hostMode,
                    localProviderOnline,
                    localLastSeenSec,
                    providerDaemonBaseUrl: daemon?.baseUrl || null,
                    providerGlobalMetaId: state.identity.globalMetaId,
                });
                if (!resolvedTarget) {
                    return (0, commandResult_1.commandSuccess)({
                        collected: trigger.collected,
                        decision: {
                            action: 'no_action',
                            reason: 'No matching online Master could be resolved for this suggestion.',
                        },
                        blocked: {
                            code: 'master_not_found',
                            message: 'No matching online Master could be resolved for this suggestion.',
                        },
                    });
                }
                if (trigger.decision.action === 'auto_candidate') {
                    const recentTargetFeedback = (0, masterAutoFeedbackState_1.findRecentAutoFeedbackForTarget)({
                        state: autoFeedbackState,
                        masterServicePinId: resolvedTarget.masterPinId,
                        now: observation.now,
                    });
                    if (recentTargetFeedback) {
                        const reason = recentTargetFeedback.status === 'timed_out'
                            ? 'The same Master target timed out recently.'
                            : 'The same Master target was rejected recently.';
                        return (0, commandResult_1.commandSuccess)({
                            collected: trigger.collected,
                            decision: {
                                action: 'no_action',
                                reason,
                            },
                            blocked: {
                                code: recentTargetFeedback.status === 'timed_out'
                                    ? 'auto_global_cooldown'
                                    : 'auto_per_trace_limited',
                                message: reason,
                            },
                            target: {
                                masterPinId: resolvedTarget.masterPinId,
                                displayName: resolvedTarget.displayName,
                                masterKind: resolvedTarget.masterKind,
                                providerGlobalMetaId: resolvedTarget.providerGlobalMetaId,
                            },
                        });
                    }
                    const autoPlan = (0, masterAutoOrchestrator_1.prepareAutoMasterAskPlan)({
                        draft,
                        resolvedTarget,
                        caller: {
                            globalMetaId: state.identity.globalMetaId,
                            name: state.identity.name,
                            host: observation.hostMode,
                        },
                        config: config.askMaster,
                        auto: {
                            reason: trigger.decision.reason,
                            confidence: trigger.decision.confidence,
                            traceAutoPrepareCount: getMasterAutoPrepareCount(observation.traceId),
                            lastAutoAt: lastMasterAutoPreparedAt,
                            now: observation.now,
                        },
                    });
                    if (!autoPlan.policy.allowed) {
                        return (0, commandResult_1.commandSuccess)({
                            collected: trigger.collected,
                            decision: {
                                action: 'no_action',
                                reason: autoPlan.policy.blockedReason || trigger.decision.reason,
                            },
                            blocked: {
                                code: autoPlan.policy.code,
                                message: autoPlan.policy.blockedReason || trigger.decision.reason,
                            },
                            autoPolicy: {
                                selectedFrictionMode: autoPlan.policy.selectedFrictionMode,
                                requiresConfirmation: autoPlan.policy.requiresConfirmation,
                                policyReason: autoPlan.policy.policyReason,
                                sensitivity: autoPlan.policy.sensitivity,
                            },
                            target: {
                                masterPinId: resolvedTarget.masterPinId,
                                displayName: resolvedTarget.displayName,
                                masterKind: resolvedTarget.masterKind,
                                providerGlobalMetaId: resolvedTarget.providerGlobalMetaId,
                            },
                        });
                    }
                    const autoTraceMetadata = buildAskMasterAutoMetadata({
                        reason: autoPlan.autoReason || trigger.decision.reason,
                        confidence: autoPlan.confidence,
                        frictionMode: autoPlan.policy.selectedFrictionMode,
                        detectorVersion: 'phase3-v1',
                        selectedMasterTrusted: autoPlan.policy.trustedTarget,
                        sensitivity: autoPlan.policy.sensitivity,
                    });
                    const autoResult = await createMasterAskPreviewResult({
                        draft,
                        resolvedTarget,
                        state,
                        config,
                        runtimeStateStore,
                        pendingMasterAskStateStore,
                        triggerModeOverride: 'auto',
                        callerHostOverride: observation.hostMode,
                        traceIdOverride: observation.traceId,
                        requiresConfirmationOverride: autoPlan.policy.requiresConfirmation,
                        latestEventOverride: 'auto_preview_prepared',
                        askMasterAutoMetadata: autoTraceMetadata,
                        afterPreviewPersisted: async ({ trace }) => {
                            await putMasterAutoFeedback({
                                traceId: trace.traceId,
                                status: 'prepared',
                                masterKind: resolvedTarget.masterKind,
                                masterServicePinId: resolvedTarget.masterPinId,
                                triggerReasonSignature: buildAutoTriggerReasonSignature({
                                    observation,
                                    autoReason: autoPlan.autoReason || trigger.decision.reason,
                                }),
                                createdAt: trace.createdAt,
                                updatedAt: trace.createdAt,
                            });
                        },
                        sendPreparedRequest: sendPendingMasterAskRequest,
                    });
                    if (!autoResult.ok) {
                        return autoResult;
                    }
                    recordMasterAutoPrepare(observation.traceId, observation.now);
                    if (trigger.observation) {
                        masterTriggerMemoryState = (0, masterTriggerEngine_1.recordMasterTriggerOutcome)({
                            state: masterTriggerMemoryState,
                            observation: trigger.observation,
                            decision: trigger.decision,
                        });
                    }
                    let preview = readObject(autoResult.data.preview) ?? null;
                    if (!preview) {
                        try {
                            const pendingAsk = await pendingMasterAskStateStore.get(autoResult.data.traceId);
                            preview = readObject(pendingAsk.preview) ?? null;
                        }
                        catch {
                            preview = null;
                        }
                    }
                    return {
                        ...autoResult,
                        data: {
                            ...autoResult.data,
                            collected: trigger.collected,
                            blocked: null,
                            triggerMode: 'auto',
                            decision: trigger.decision,
                            autoReason: autoPlan.autoReason || trigger.decision.reason,
                            confidence: autoPlan.confidence,
                            autoPolicy: {
                                selectedFrictionMode: autoPlan.policy.selectedFrictionMode,
                                requiresConfirmation: autoPlan.policy.requiresConfirmation,
                                policyReason: autoPlan.policy.policyReason,
                                sensitivity: autoPlan.policy.sensitivity,
                            },
                            target: {
                                masterPinId: resolvedTarget.masterPinId,
                                displayName: resolvedTarget.displayName,
                                masterKind: resolvedTarget.masterKind,
                                providerGlobalMetaId: resolvedTarget.providerGlobalMetaId,
                            },
                            ...(preview ? { preview } : {}),
                        },
                    };
                }
                const policy = (0, masterPolicyGate_1.evaluateMasterPolicy)({
                    config: config.askMaster,
                    action: 'suggest',
                    selectedMaster: resolvedTarget,
                });
                if (!policy.allowed) {
                    return (0, commandResult_1.commandSuccess)({
                        collected: trigger.collected,
                        decision: {
                            action: 'no_action',
                            reason: policy.blockedReason || 'Ask Master policy blocked this suggestion.',
                        },
                        blocked: {
                            code: policy.code,
                            message: policy.blockedReason || 'Ask Master policy blocked this suggestion.',
                        },
                    });
                }
                const suggestResult = await createMasterSuggestResult({
                    draft,
                    resolvedTarget,
                    state,
                    config,
                    runtimeStateStore,
                    masterSuggestStateStore,
                    observation,
                    decision: trigger.decision,
                });
                if (suggestResult.ok && trigger.observation) {
                    const suggestData = suggestResult.data;
                    masterTriggerMemoryState = (0, masterTriggerEngine_1.recordMasterTriggerOutcome)({
                        state: masterTriggerMemoryState,
                        observation: trigger.observation,
                        decision: trigger.decision,
                    });
                    return {
                        ...suggestResult,
                        data: {
                            ...suggestData,
                            collected: trigger.collected,
                            decision: trigger.decision,
                        },
                    };
                }
                return suggestResult;
            },
            receive: async (rawInput) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before serving Ask Master requests.');
                }
                const masterState = await masterStateStore.read();
                const handled = await (0, masterProviderRuntime_1.handleMasterProviderRequest)({
                    rawRequest: rawInput,
                    providerIdentity: {
                        globalMetaId: state.identity.globalMetaId,
                        name: state.identity.name,
                    },
                    publishedMasters: masterState.masters,
                    sessionEngine,
                });
                if (!handled.ok) {
                    return (0, commandResult_1.commandFailed)(handled.code, handled.message);
                }
                const receivedStatus = await persistSessionMutation(sessionStateStore, handled.received);
                await appendA2ATranscriptItems(sessionStateStore, [
                    {
                        id: `${handled.request.traceId}-master-request`,
                        sessionId: handled.received.session.sessionId,
                        taskRunId: handled.received.taskRun.runId,
                        timestamp: handled.received.session.createdAt,
                        type: 'user_task',
                        sender: 'caller',
                        content: handled.request.task.question,
                        metadata: {
                            userTask: handled.request.task.userTask,
                            callerGlobalMetaId: handled.request.caller.globalMetaId,
                            callerName: handled.request.caller.name,
                            publicStatus: receivedStatus.status,
                            servicePinId: handled.publishedMaster.currentPinId,
                            masterKind: handled.publishedMaster.masterKind,
                        },
                    },
                ]);
                const appliedStatus = await persistSessionMutation(sessionStateStore, handled.applied);
                await appendA2ATranscriptItems(sessionStateStore, [
                    {
                        id: `${handled.request.traceId}-master-response`,
                        sessionId: handled.received.session.sessionId,
                        taskRunId: handled.applied.taskRun.runId,
                        timestamp: handled.applied.session.updatedAt,
                        type: handled.response.status === 'failed'
                            ? 'failure'
                            : handled.response.status === 'need_more_context'
                                ? 'clarification_request'
                                : 'assistant',
                        sender: handled.response.status === 'failed' ? 'system' : 'provider',
                        content: handled.response.summary,
                        metadata: {
                            publicStatus: appliedStatus.status,
                            event: handled.applied.event,
                            requestId: handled.request.requestId,
                            responseStatus: handled.response.status,
                            servicePinId: handled.publishedMaster.currentPinId,
                            masterKind: handled.publishedMaster.masterKind,
                        },
                    },
                ]);
                const trace = (0, sessionTrace_1.buildSessionTrace)({
                    traceId: handled.request.traceId,
                    channel: 'a2a',
                    exportRoot: runtimeStateStore.paths.exportsRoot,
                    session: {
                        id: `master-provider-${handled.request.traceId}`,
                        title: `${handled.publishedMaster.displayName} Ask`,
                        type: 'a2a',
                        metabotId: state.identity.metabotId,
                        peerGlobalMetaId: handled.request.caller.globalMetaId,
                        peerName: handled.request.caller.name || null,
                        externalConversationId: `master:${handled.request.caller.globalMetaId}:${state.identity.globalMetaId}:${handled.request.traceId}`,
                    },
                    a2a: {
                        sessionId: handled.received.session.sessionId,
                        taskRunId: handled.applied.taskRun.runId,
                        role: handled.received.session.role,
                        publicStatus: appliedStatus.status,
                        latestEvent: handled.applied.event,
                        taskRunState: handled.applied.taskRun.state,
                        callerGlobalMetaId: handled.request.caller.globalMetaId,
                        callerName: handled.request.caller.name || null,
                        providerGlobalMetaId: state.identity.globalMetaId,
                        providerName: state.identity.name,
                        servicePinId: handled.publishedMaster.currentPinId,
                    },
                    askMaster: (0, masterTrace_1.buildMasterTraceMetadata)({
                        role: handled.received.session.role,
                        latestEvent: handled.applied.event,
                        publicStatus: appliedStatus.status,
                        requestId: handled.request.requestId,
                        masterKind: handled.publishedMaster.masterKind,
                        servicePinId: handled.publishedMaster.currentPinId,
                        providerGlobalMetaId: state.identity.globalMetaId,
                        displayName: handled.publishedMaster.displayName,
                        triggerMode: normalizeText(handled.request.trigger.mode),
                        contextMode: normalizeText(handled.request.extensions?.contextMode),
                        preview: {
                            userTask: handled.request.task.userTask,
                            question: handled.request.task.question,
                        },
                        response: {
                            status: handled.response.status,
                            summary: handled.response.summary,
                            followUpQuestion: handled.response.followUpQuestion,
                        },
                    }),
                });
                const artifacts = await (0, transcriptExport_1.exportSessionArtifacts)({
                    trace,
                    transcript: {
                        sessionId: trace.session.id,
                        title: trace.session.title || 'Ask Master Provider Runtime',
                        messages: [
                            {
                                id: `${trace.traceId}-caller`,
                                type: 'user',
                                timestamp: trace.createdAt,
                                content: handled.request.task.question,
                                metadata: {
                                    requestId: handled.request.requestId,
                                    callerGlobalMetaId: handled.request.caller.globalMetaId,
                                    servicePinId: handled.publishedMaster.currentPinId,
                                    masterKind: handled.publishedMaster.masterKind,
                                },
                            },
                            {
                                id: `${trace.traceId}-provider`,
                                type: handled.response.status === 'failed' ? 'system' : 'assistant',
                                timestamp: handled.applied.session.updatedAt,
                                content: handled.response.summary,
                                metadata: {
                                    responseStatus: handled.response.status,
                                    followUpQuestion: handled.response.followUpQuestion,
                                    providerGlobalMetaId: state.identity.globalMetaId,
                                    requestId: handled.request.requestId,
                                },
                            },
                        ],
                    },
                });
                await persistTraceRecord(runtimeStateStore, trace);
                const shouldDeliverResponse = rawInput.deliverResponse !== false;
                const replyPin = normalizeText(rawInput.replyPin);
                const explicitCallerChatPublicKey = normalizeText(rawInput.callerChatPublicKey);
                let messagePinId = null;
                const markDeliveryFailure = async (code, message) => {
                    const failedTrace = {
                        ...trace,
                        a2a: trace.a2a
                            ? {
                                ...trace.a2a,
                                publicStatus: 'local_runtime_error',
                                latestEvent: 'provider_delivery_failed',
                            }
                            : trace.a2a,
                        askMaster: (0, masterTrace_1.buildMasterTraceMetadata)({
                            role: trace.a2a?.role,
                            latestEvent: 'provider_delivery_failed',
                            publicStatus: 'local_runtime_error',
                            requestId: trace.askMaster?.requestId,
                            masterKind: trace.askMaster?.masterKind,
                            servicePinId: trace.askMaster?.servicePinId,
                            providerGlobalMetaId: trace.askMaster?.providerGlobalMetaId,
                            displayName: trace.askMaster?.displayName,
                            triggerMode: trace.askMaster?.triggerMode,
                            contextMode: trace.askMaster?.contextMode,
                            confirmationMode: trace.askMaster?.confirmationMode,
                            preview: trace.askMaster?.preview,
                            response: trace.askMaster?.response,
                            failure: {
                                code,
                                message,
                            },
                        }),
                    };
                    if (trace.a2a?.sessionId) {
                        await sessionStateStore.appendPublicStatusSnapshots([
                            {
                                sessionId: trace.a2a.sessionId,
                                taskRunId: trace.a2a.taskRunId ?? null,
                                status: 'local_runtime_error',
                                mapped: true,
                                rawEvent: 'provider_delivery_failed',
                                resolvedAt: Date.now(),
                            },
                        ]);
                    }
                    await rebuildTraceArtifactsFromSessionState({
                        baseTrace: failedTrace,
                        runtimeStateStore,
                        sessionStateStore,
                    });
                    return (0, commandResult_1.commandFailed)(code, message);
                };
                if (shouldDeliverResponse) {
                    let privateChatIdentity;
                    try {
                        privateChatIdentity = await signer.getPrivateChatIdentity();
                    }
                    catch (error) {
                        return markDeliveryFailure('identity_secret_missing', error instanceof Error ? error.message : 'Local private chat key is missing from the secret store.');
                    }
                    const callerChatPublicKey = explicitCallerChatPublicKey
                        || (await resolvePeerChatPublicKey(handled.request.caller.globalMetaId))
                        || '';
                    if (!callerChatPublicKey) {
                        return markDeliveryFailure('peer_chat_public_key_missing', 'Caller has no published chat public key on chain and none was provided.');
                    }
                    let outboundResponse;
                    try {
                        outboundResponse = (0, privateChat_1.sendPrivateChat)({
                            fromIdentity: {
                                globalMetaId: privateChatIdentity.globalMetaId,
                                privateKeyHex: privateChatIdentity.privateKeyHex,
                            },
                            toGlobalMetaId: handled.request.caller.globalMetaId,
                            peerChatPublicKey: callerChatPublicKey,
                            content: handled.responseJson,
                            replyPinId: replyPin || null,
                        });
                    }
                    catch (error) {
                        return markDeliveryFailure('master_response_build_failed', error instanceof Error ? error.message : String(error));
                    }
                    try {
                        const write = await signer.writePin({
                            operation: 'create',
                            path: outboundResponse.path,
                            encryption: outboundResponse.encryption,
                            version: outboundResponse.version,
                            contentType: outboundResponse.contentType,
                            payload: outboundResponse.payload,
                            encoding: 'utf-8',
                            network: 'mvc',
                        });
                        messagePinId = normalizeText(write.pinId) || null;
                    }
                    catch (error) {
                        return markDeliveryFailure('master_response_delivery_failed', error instanceof Error ? error.message : String(error));
                    }
                }
                return (0, commandResult_1.commandSuccess)({
                    traceId: handled.request.traceId,
                    requestId: handled.request.requestId,
                    response: handled.response,
                    responseJson: handled.responseJson,
                    messagePinId,
                    traceSummary: handled.traceSummary,
                    session: {
                        state: handled.applied.session.state,
                        publicStatus: appliedStatus.status,
                        event: handled.applied.event,
                    },
                    traceJsonPath: artifacts.traceJsonPath,
                    traceMarkdownPath: artifacts.traceMarkdownPath,
                    transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
                });
            },
            trace: async ({ traceId }) => {
                const state = await runtimeStateStore.readState();
                const trace = state.traces.find((entry) => entry.traceId === traceId);
                if (!trace) {
                    return (0, commandResult_1.commandFailed)('trace_not_found', `Trace not found: ${traceId}`);
                }
                const view = (0, masterTrace_1.buildMasterTraceView)(trace);
                if (!view) {
                    return (0, commandResult_1.commandFailed)('trace_not_master_flow', `Trace is not an Ask Master flow: ${traceId}`);
                }
                return (0, commandResult_1.commandSuccess)(view);
            },
        },
        network: {
            listServices: async ({ online }) => {
                const state = await runtimeStateStore.readState();
                const directory = await listRuntimeDirectoryServices({
                    state,
                    directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
                    chainApiBaseUrl: input.chainApiBaseUrl,
                    socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
                    socketPresenceFailureMode: input.socketPresenceFailureMode,
                    onlineOnly: online === true,
                });
                return (0, commandResult_1.commandSuccess)({
                    services: directory.services,
                    discoverySource: directory.discoverySource,
                    fallbackUsed: directory.fallbackUsed,
                });
            },
            listBots: async ({ online, limit }) => {
                const normalizedLimit = Number.isFinite(limit)
                    ? Math.min(MAX_NETWORK_BOT_LIST_LIMIT, Math.max(1, Math.floor(limit)))
                    : DEFAULT_NETWORK_BOT_LIST_LIMIT;
                const onlineOnly = online !== false;
                try {
                    const presence = await (0, socketPresenceDirectory_1.readOnlineMetaBotsFromSocketPresence)({
                        apiBaseUrl: input.socketPresenceApiBaseUrl,
                        limit: normalizedLimit,
                    });
                    return (0, commandResult_1.commandSuccess)({
                        source: presence.source,
                        fallbackUsed: false,
                        total: presence.total,
                        onlineWindowSeconds: presence.onlineWindowSeconds,
                        bots: onlineOnly
                            ? presence.bots
                            : presence.bots.map((entry) => ({ ...entry })),
                    });
                }
                catch (error) {
                    try {
                        const state = await runtimeStateStore.readState();
                        const directory = await listRuntimeDirectoryServices({
                            state,
                            directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
                            chainApiBaseUrl: input.chainApiBaseUrl,
                            socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
                            socketPresenceFailureMode: input.socketPresenceFailureMode,
                            onlineOnly: false,
                        });
                        const bots = dedupeOnlineBotsFromServices(directory.services, normalizedLimit);
                        return (0, commandResult_1.commandSuccess)({
                            source: 'service_directory_fallback',
                            fallbackUsed: true,
                            total: bots.length,
                            onlineWindowSeconds: null,
                            bots,
                        });
                    }
                    catch {
                        return (0, commandResult_1.commandFailed)('socket_presence_unavailable', error instanceof Error ? error.message : String(error));
                    }
                }
            },
            listSources: async () => {
                const sources = sortDirectorySeeds(await readDirectorySeeds(runtimeStateStore.paths.directorySeedsPath));
                return (0, commandResult_1.commandSuccess)({ sources });
            },
            addSource: async ({ baseUrl, label }) => {
                const normalizedBaseUrl = normalizeText(baseUrl);
                if (!normalizedBaseUrl) {
                    return (0, commandResult_1.commandFailed)('missing_base_url', 'Network source baseUrl is required.');
                }
                let parsed;
                try {
                    parsed = new URL(normalizedBaseUrl);
                }
                catch {
                    return (0, commandResult_1.commandFailed)('invalid_base_url', `Invalid network source URL: ${normalizedBaseUrl}`);
                }
                if (!/^https?:$/.test(parsed.protocol)) {
                    return (0, commandResult_1.commandFailed)('invalid_base_url', `Network source URL must be http or https: ${normalizedBaseUrl}`);
                }
                const normalizedLabel = normalizeText(label) || null;
                const currentSources = await readDirectorySeeds(runtimeStateStore.paths.directorySeedsPath);
                const nextSources = sortDirectorySeeds([
                    ...currentSources.filter((entry) => entry.baseUrl !== parsed.toString().replace(/\/$/, '')),
                    {
                        baseUrl: parsed.toString().replace(/\/$/, ''),
                        label: normalizedLabel,
                    },
                ]);
                await writeDirectorySeeds(runtimeStateStore.paths.directorySeedsPath, nextSources);
                return (0, commandResult_1.commandSuccess)({
                    baseUrl: parsed.toString().replace(/\/$/, ''),
                    label: normalizedLabel,
                    totalSources: nextSources.length,
                });
            },
            removeSource: async ({ baseUrl }) => {
                const normalizedBaseUrl = normalizeText(baseUrl).replace(/\/$/, '');
                if (!normalizedBaseUrl) {
                    return (0, commandResult_1.commandFailed)('missing_base_url', 'Network source baseUrl is required.');
                }
                const currentSources = await readDirectorySeeds(runtimeStateStore.paths.directorySeedsPath);
                const nextSources = sortDirectorySeeds(currentSources.filter((entry) => entry.baseUrl !== normalizedBaseUrl));
                const removed = nextSources.length !== currentSources.length;
                await writeDirectorySeeds(runtimeStateStore.paths.directorySeedsPath, nextSources);
                return (0, commandResult_1.commandSuccess)({
                    removed,
                    baseUrl: normalizedBaseUrl,
                    totalSources: nextSources.length,
                });
            },
        },
        provider: {
            getSummary: async () => {
                const state = await runtimeStateStore.readState();
                const masterState = await masterStateStore.read();
                const presence = await providerPresenceStore.read();
                const ratingSnapshot = await readRatingDetailSnapshot({
                    ratingDetailStateStore,
                    chainApiBaseUrl: input.chainApiBaseUrl,
                });
                return (0, commandResult_1.commandSuccess)(buildProviderSummaryPayload({
                    state,
                    presence,
                    masters: masterState.masters,
                    ratingDetails: ratingSnapshot.ratingDetails,
                    ratingSyncState: ratingSnapshot.ratingSyncState,
                    ratingSyncError: ratingSnapshot.ratingSyncError,
                }));
            },
            setPresence: async ({ enabled }) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before changing provider presence.');
                }
                const presence = await providerPresenceStore.update((current) => ({
                    ...current,
                    enabled,
                }));
                await input.onProviderPresenceChanged?.(enabled);
                return (0, commandResult_1.commandSuccess)({
                    identity: {
                        metabotId: state.identity.metabotId,
                        name: state.identity.name,
                        globalMetaId: state.identity.globalMetaId,
                    },
                    presence,
                });
            },
            confirmRefund: async ({ orderId }) => {
                const normalizedOrderId = normalizeText(orderId);
                if (!normalizedOrderId) {
                    return (0, commandResult_1.commandFailed)('invalid_refund_confirmation', 'Refund confirmation requires an orderId.');
                }
                const state = await runtimeStateStore.readState();
                const traceIndex = state.traces.findIndex((entry) => {
                    const traceRecord = entry;
                    const order = readObject(traceRecord.order);
                    return normalizeText(order?.id) === normalizedOrderId
                        && normalizeText(order?.role) === 'seller';
                });
                if (traceIndex < 0) {
                    return (0, commandResult_1.commandFailed)('order_not_found', `Provider order was not found: ${normalizedOrderId}`);
                }
                const currentTrace = state.traces[traceIndex];
                const currentOrder = readObject(currentTrace.order);
                if (!currentOrder
                    || normalizeText(currentOrder.status) !== 'refund_pending'
                    || !normalizeText(currentOrder.refundRequestPinId)) {
                    return (0, commandResult_1.commandFailed)('refund_not_required', 'Manual refund is not required.');
                }
                const now = Date.now();
                const nextTrace = {
                    ...currentTrace,
                    order: {
                        ...currentOrder,
                        status: 'refunded',
                        refundConfirmedAt: now,
                        refundedAt: now,
                    },
                };
                await runtimeStateStore.writeState({
                    ...state,
                    traces: [
                        nextTrace,
                        ...state.traces.filter((entry, index) => index !== traceIndex),
                    ],
                });
                return (0, commandResult_1.commandSuccess)({
                    orderId: normalizedOrderId,
                    traceId: normalizeText(currentTrace.traceId),
                    state: 'refunded',
                });
            },
        },
        services: {
            publish: async (rawInput) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before publishing services.');
                }
                const serviceName = normalizeText(rawInput.serviceName);
                const displayName = normalizeText(rawInput.displayName);
                const description = normalizeText(rawInput.description);
                const providerSkill = normalizeText(rawInput.providerSkill);
                const price = normalizeText(rawInput.price);
                const currency = normalizeText(rawInput.currency);
                const outputType = normalizeText(rawInput.outputType);
                const serviceIconUri = normalizeText(rawInput.serviceIconUri) || null;
                const skillDocument = normalizeText(rawInput.skillDocument);
                if (!serviceName || !displayName || !description || !providerSkill || !price || !currency || !outputType) {
                    return (0, commandResult_1.commandFailed)('invalid_service_payload', 'Service payload is missing one or more required fields.');
                }
                try {
                    const now = Date.now();
                    const network = typeof rawInput.network === 'string' ? rawInput.network : undefined;
                    const published = await (0, servicePublishChain_1.publishServiceToChain)({
                        signer,
                        creatorMetabotId: state.identity.metabotId,
                        providerGlobalMetaId: state.identity.globalMetaId,
                        paymentAddress: resolvePaymentAddress(state.identity, currency),
                        draft: {
                            serviceName,
                            displayName,
                            description,
                            providerSkill,
                            price,
                            currency,
                            outputType,
                            serviceIconUri,
                        },
                        skillDocument,
                        now,
                        network,
                    });
                    await runtimeStateStore.writeState({
                        ...state,
                        services: [
                            published.record,
                            ...state.services.filter((service) => service.currentPinId !== published.record.currentPinId),
                        ],
                    });
                    return (0, commandResult_1.commandSuccess)({
                        ...summarizeService(published.record),
                        txids: published.chainWrite.txids,
                        totalCost: published.chainWrite.totalCost,
                        network: published.chainWrite.network,
                        operation: published.chainWrite.operation,
                        path: published.chainWrite.path,
                        contentType: published.chainWrite.contentType,
                    });
                }
                catch (error) {
                    return (0, commandResult_1.commandFailed)('service_publish_failed', error instanceof Error ? error.message : String(error));
                }
            },
            call: async (rawInput) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before calling services.');
                }
                const request = readCallRequest(rawInput);
                if (!request.servicePinId || !request.providerGlobalMetaId || !request.userTask) {
                    return (0, commandResult_1.commandFailed)('invalid_call_request', 'Call request must include servicePinId, providerGlobalMetaId, and userTask.');
                }
                let availableServices;
                if (request.providerDaemonBaseUrl) {
                    const remoteDirectory = await fetchRemoteAvailableServices(request.providerDaemonBaseUrl);
                    if ('ok' in remoteDirectory) {
                        if (!remoteDirectory.ok && remoteDirectory.state === 'manual_action_required') {
                            return remoteDirectory;
                        }
                        return remoteDirectory;
                    }
                    availableServices = remoteDirectory.services;
                }
                else {
                    const directory = await listRuntimeDirectoryServices({
                        state,
                        directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
                        chainApiBaseUrl: input.chainApiBaseUrl,
                        socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
                        socketPresenceFailureMode: input.socketPresenceFailureMode,
                        onlineOnly: true,
                    });
                    availableServices = directory.services;
                }
                const plan = (0, remoteCall_1.planRemoteCall)({
                    request: {
                        servicePinId: request.servicePinId,
                        providerGlobalMetaId: request.providerGlobalMetaId,
                        userTask: request.userTask,
                        taskContext: request.taskContext,
                        rawRequest: request.rawRequest,
                        spendCap: request.spendCap,
                        policyMode: request.policyMode,
                    },
                    availableServices,
                });
                if (!plan.ok) {
                    if (plan.state === 'manual_action_required') {
                        return (0, commandResult_1.commandManualActionRequired)(plan.code, plan.message);
                    }
                    return (0, commandResult_1.commandFailed)(plan.code, plan.message);
                }
                const service = availableServices.find((entry) => (normalizeText(entry.servicePinId) === plan.service.servicePinId
                    && normalizeText(entry.providerGlobalMetaId) === plan.service.providerGlobalMetaId));
                if (!service) {
                    return (0, commandResult_1.commandFailed)('service_not_found', 'Published service was not found in the available service directory.');
                }
                const started = sessionEngine.startCallerSession({
                    traceId: plan.traceId,
                    servicePinId: plan.service.servicePinId,
                    callerGlobalMetaId: state.identity.globalMetaId,
                    providerGlobalMetaId: plan.service.providerGlobalMetaId,
                    userTask: request.userTask,
                    taskContext: request.taskContext,
                });
                const serviceDisplayName = normalizeText(service.displayName) || normalizeText(service.serviceName);
                const paymentTxid = buildSyntheticPaymentTxid({
                    traceId: plan.traceId,
                    servicePinId: plan.service.servicePinId,
                    providerGlobalMetaId: plan.service.providerGlobalMetaId,
                    userTask: request.userTask,
                });
                let orderPinId = null;
                let providerReplyText = null;
                let deliveryPinId = null;
                if (request.providerDaemonBaseUrl) {
                    const execution = await executeRemoteServiceCall({
                        providerDaemonBaseUrl: request.providerDaemonBaseUrl,
                        traceId: plan.traceId,
                        externalConversationId: started.linkage.externalConversationId,
                        servicePinId: plan.service.servicePinId,
                        providerGlobalMetaId: plan.service.providerGlobalMetaId,
                        buyer: state.identity,
                        request: {
                            userTask: request.userTask,
                            taskContext: request.taskContext,
                        },
                    });
                    if (!execution.ok) {
                        if (execution.state === 'manual_action_required') {
                            return execution;
                        }
                        return execution;
                    }
                }
                else {
                    let privateChatIdentity;
                    try {
                        privateChatIdentity = await signer.getPrivateChatIdentity();
                    }
                    catch (error) {
                        return (0, commandResult_1.commandFailed)('identity_secret_missing', error instanceof Error ? error.message : 'Local private chat key is missing from the secret store.');
                    }
                    const peerChatPublicKey = plan.service.providerGlobalMetaId === state.identity.globalMetaId
                        ? state.identity.chatPublicKey
                        : await resolvePeerChatPublicKey(plan.service.providerGlobalMetaId) ?? '';
                    if (!peerChatPublicKey) {
                        return (0, commandResult_1.commandFailed)('peer_chat_public_key_missing', 'Remote agent has no published chat public key on chain.');
                    }
                    const orderPayload = (0, delegationOrderMessage_1.buildDelegationOrderPayload)({
                        rawRequest: request.rawRequest || request.userTask,
                        taskContext: request.taskContext,
                        userTask: request.userTask,
                        serviceName: serviceDisplayName,
                        providerSkill: normalizeText(service.providerSkill) || normalizeText(service.serviceName),
                        servicePinId: plan.service.servicePinId,
                        paymentTxid,
                        price: plan.payment.amount,
                        currency: plan.payment.currency,
                    });
                    let outboundOrder;
                    try {
                        outboundOrder = (0, privateChat_1.sendPrivateChat)({
                            fromIdentity: {
                                globalMetaId: privateChatIdentity.globalMetaId,
                                privateKeyHex: privateChatIdentity.privateKeyHex,
                            },
                            toGlobalMetaId: plan.service.providerGlobalMetaId,
                            peerChatPublicKey,
                            content: orderPayload,
                        });
                    }
                    catch (error) {
                        return (0, commandResult_1.commandFailed)('remote_order_build_failed', error instanceof Error ? error.message : String(error));
                    }
                    try {
                        const orderWrite = await signer.writePin({
                            operation: 'create',
                            path: outboundOrder.path,
                            encryption: outboundOrder.encryption,
                            version: outboundOrder.version,
                            contentType: outboundOrder.contentType,
                            payload: outboundOrder.payload,
                            encoding: 'utf-8',
                            network: 'mvc',
                        });
                        orderPinId = orderWrite.pinId;
                    }
                    catch (error) {
                        return (0, commandResult_1.commandFailed)('remote_order_broadcast_failed', error instanceof Error ? error.message : String(error));
                    }
                }
                const publicStatus = await persistSessionMutation(sessionStateStore, started);
                await appendA2ATranscriptItems(sessionStateStore, [
                    {
                        id: `${plan.traceId}-caller-user-task`,
                        sessionId: started.session.sessionId,
                        taskRunId: started.taskRun.runId,
                        timestamp: started.session.createdAt,
                        type: 'user_task',
                        sender: 'caller',
                        content: request.userTask,
                        metadata: {
                            taskContext: request.taskContext || null,
                            servicePinId: plan.service.servicePinId,
                            providerGlobalMetaId: plan.service.providerGlobalMetaId,
                            paymentTxid,
                        },
                    },
                    {
                        id: `${plan.traceId}-caller-request-sent`,
                        sessionId: started.session.sessionId,
                        taskRunId: started.taskRun.runId,
                        timestamp: started.session.updatedAt,
                        type: 'status_note',
                        sender: 'system',
                        content: `Local MetaBot delegated this task to remote MetaBot ${normalizeText(service.displayName) || normalizeText(service.serviceName) || plan.service.providerGlobalMetaId}.`,
                        metadata: {
                            publicStatus: publicStatus.status,
                            event: started.event,
                            externalConversationId: started.linkage.externalConversationId,
                            orderPinId,
                            paymentTxid,
                        },
                    },
                ]);
                const trace = (0, sessionTrace_1.buildSessionTrace)({
                    traceId: plan.traceId,
                    channel: 'a2a',
                    exportRoot: runtimeStateStore.paths.exportsRoot,
                    session: {
                        id: `session-${plan.traceId}`,
                        title: `${serviceDisplayName} Call`,
                        type: 'a2a',
                        metabotId: state.identity.metabotId,
                        peerGlobalMetaId: normalizeText(service.providerGlobalMetaId),
                        peerName: serviceDisplayName,
                        externalConversationId: started.linkage.externalConversationId,
                    },
                    order: {
                        id: `order-${plan.traceId}`,
                        role: 'buyer',
                        serviceId: plan.service.servicePinId,
                        serviceName: serviceDisplayName,
                        paymentTxid,
                        paymentCurrency: plan.payment.currency,
                        paymentAmount: plan.payment.amount,
                    },
                    a2a: {
                        sessionId: started.session.sessionId,
                        taskRunId: started.taskRun.runId,
                        role: started.session.role,
                        publicStatus: publicStatus.status,
                        latestEvent: started.event,
                        taskRunState: started.taskRun.state,
                        callerGlobalMetaId: started.session.callerGlobalMetaId,
                        providerGlobalMetaId: started.session.providerGlobalMetaId,
                        providerName: serviceDisplayName,
                        servicePinId: started.session.servicePinId,
                    },
                });
                const artifacts = await (0, transcriptExport_1.exportSessionArtifacts)({
                    trace,
                    transcript: {
                        sessionId: trace.session.id,
                        title: trace.session.title,
                        messages: [
                            {
                                id: `${trace.traceId}-user`,
                                type: 'user',
                                timestamp: trace.createdAt,
                                content: request.userTask,
                                metadata: {
                                    taskContext: request.taskContext || null,
                                },
                            },
                            {
                                id: `${trace.traceId}-assistant`,
                                type: 'assistant',
                                timestamp: trace.createdAt,
                                content: `Local MetaBot runtime created a remote MetaBot task session for ${serviceDisplayName}.`,
                                metadata: {
                                    servicePinId: plan.service.servicePinId,
                                    providerGlobalMetaId: normalizeText(service.providerGlobalMetaId),
                                    confirmationPolicyMode: plan.confirmation.policyMode,
                                    confirmationRequired: plan.confirmation.requiresConfirmation,
                                    providerDaemonBaseUrl: request.providerDaemonBaseUrl || null,
                                    orderPinId,
                                    paymentTxid,
                                },
                            },
                        ],
                    },
                });
                await persistTraceRecord(runtimeStateStore, trace);
                let responseTrace = trace;
                let responseArtifacts = artifacts;
                let responseSession = started.session;
                let responseTaskRun = started.taskRun;
                let responseEvent = started.event;
                let responsePublicStatus = publicStatus.status;
                if (!request.providerDaemonBaseUrl) {
                    const privateChatIdentity = await signer.getPrivateChatIdentity();
                    const peerChatPublicKey = plan.service.providerGlobalMetaId === state.identity.globalMetaId
                        ? state.identity.chatPublicKey
                        : await resolvePeerChatPublicKey(plan.service.providerGlobalMetaId) ?? '';
                    const reply = await callerReplyWaiter.awaitServiceReply({
                        callerGlobalMetaId: privateChatIdentity.globalMetaId,
                        callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
                        providerGlobalMetaId: plan.service.providerGlobalMetaId,
                        providerChatPublicKey: peerChatPublicKey,
                        servicePinId: plan.service.servicePinId,
                        paymentTxid,
                        timeoutMs: DEFAULT_CALLER_FOREGROUND_WAIT_MS,
                    });
                    if (reply.state === 'completed') {
                        const applied = await applyCallerReplyResult({
                            reply,
                            session: started.session,
                            taskRun: started.taskRun,
                            sessionEngine,
                            sessionStateStore,
                            runtimeStateStore,
                            trace,
                        });
                        responseTrace = applied.trace;
                        responseArtifacts = applied.artifacts;
                        responseSession = applied.mutation.session;
                        responseTaskRun = applied.mutation.taskRun;
                        responseEvent = applied.mutation.event;
                        responsePublicStatus = 'completed';
                        providerReplyText = reply.responseText;
                        deliveryPinId = reply.deliveryPinId;
                    }
                    else if (reply.state === 'timeout') {
                        const timedOut = await applyCallerForegroundTimeout({
                            session: started.session,
                            taskRun: started.taskRun,
                            sessionEngine,
                            sessionStateStore,
                            runtimeStateStore,
                            trace,
                        });
                        responseTrace = timedOut.trace;
                        responseArtifacts = timedOut.artifacts;
                        responseSession = timedOut.mutation.session;
                        responseTaskRun = timedOut.mutation.taskRun;
                        responseEvent = timedOut.mutation.event;
                        responsePublicStatus = 'timeout';
                        scheduleCallerReplyContinuation({
                            trace: timedOut.trace,
                            sessionId: timedOut.mutation.session.sessionId,
                            waiterInput: {
                                callerGlobalMetaId: privateChatIdentity.globalMetaId,
                                callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
                                providerGlobalMetaId: plan.service.providerGlobalMetaId,
                                providerChatPublicKey: peerChatPublicKey,
                                servicePinId: plan.service.servicePinId,
                                paymentTxid,
                                timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
                            },
                        });
                    }
                }
                return (0, commandResult_1.commandSuccess)({
                    traceId: responseTrace.traceId,
                    providerGlobalMetaId: plan.service.providerGlobalMetaId,
                    serviceName: serviceDisplayName,
                    service: plan.service,
                    payment: plan.payment,
                    confirmation: plan.confirmation,
                    paymentTxid,
                    orderPinId,
                    ...(deliveryPinId ? { deliveryPinId } : {}),
                    ...(providerReplyText ? { responseText: providerReplyText } : {}),
                    session: {
                        sessionId: responseSession.sessionId,
                        taskRunId: responseTaskRun.runId,
                        role: responseSession.role,
                        state: responseSession.state,
                        publicStatus: responsePublicStatus,
                        event: responseEvent,
                        coworkSessionId: started.linkage.coworkSessionId,
                        externalConversationId: started.linkage.externalConversationId,
                    },
                    traceJsonPath: responseArtifacts.traceJsonPath,
                    traceMarkdownPath: responseArtifacts.traceMarkdownPath,
                    transcriptMarkdownPath: responseArtifacts.transcriptMarkdownPath,
                });
            },
            rate: async (rawInput) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before publishing service ratings.');
                }
                const request = readServiceRateRequest(rawInput);
                if (!request.traceId) {
                    return (0, commandResult_1.commandFailed)('invalid_service_rating_request', 'Service rating request must include traceId.');
                }
                if (!Number.isFinite(request.rate) || request.rate < 1 || request.rate > 5) {
                    return (0, commandResult_1.commandFailed)('invalid_service_rating_score', 'Service rating score must be an integer from 1 to 5.');
                }
                if (!request.comment) {
                    return (0, commandResult_1.commandFailed)('invalid_service_rating_comment', 'Service rating request must include a non-empty comment.');
                }
                const trace = state.traces.find((entry) => entry.traceId === request.traceId);
                if (!trace) {
                    return (0, commandResult_1.commandFailed)('trace_not_found', `Trace not found: ${request.traceId}`);
                }
                if (normalizeText(trace.order?.role) !== 'buyer') {
                    return (0, commandResult_1.commandFailed)('service_rating_not_buyer_trace', 'Only buyer-side remote traces can publish service ratings.');
                }
                const serviceId = normalizeText(trace.order?.serviceId);
                const servicePrice = normalizeText(trace.order?.paymentAmount);
                const serviceCurrency = normalizeText(trace.order?.paymentCurrency);
                const servicePaidTx = normalizeText(trace.order?.paymentTxid);
                const serverBot = normalizeText(trace.session.peerGlobalMetaId ?? trace.a2a?.providerGlobalMetaId);
                if (!serviceId || !servicePrice || !serviceCurrency || !servicePaidTx || !serverBot) {
                    return (0, commandResult_1.commandFailed)('service_rating_trace_incomplete', 'Trace is missing service or payment metadata required for skill-service-rate.');
                }
                const directory = await listRuntimeDirectoryServices({
                    state,
                    directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
                    chainApiBaseUrl: input.chainApiBaseUrl,
                    socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
                    socketPresenceFailureMode: input.socketPresenceFailureMode,
                    onlineOnly: false,
                });
                const matchedService = directory.services.find((entry) => (normalizeText(entry.servicePinId) === serviceId
                    || normalizeText(entry.sourceServicePinId) === serviceId));
                const serviceSkill = normalizeText(matchedService?.providerSkill
                    ?? matchedService?.serviceName
                    ?? trace.order?.serviceName);
                const payload = {
                    serviceID: serviceId,
                    servicePrice,
                    serviceCurrency,
                    servicePaidTx,
                    serviceSkill: serviceSkill || normalizeText(trace.order?.serviceName),
                    serverBot,
                    rate: String(request.rate),
                    comment: request.comment,
                };
                const network = typeof rawInput.network === 'string' ? rawInput.network : undefined;
                let ratingWrite;
                try {
                    ratingWrite = await signer.writePin({
                        operation: 'create',
                        path: '/protocols/skill-service-rate',
                        encryption: '0',
                        version: '1.0.0',
                        contentType: 'application/json',
                        payload: JSON.stringify(payload),
                        network,
                    });
                }
                catch (error) {
                    return (0, commandResult_1.commandFailed)('service_rating_publish_failed', error instanceof Error ? error.message : String(error));
                }
                const combinedMessage = buildServiceRatingFollowupMessage({
                    comment: request.comment,
                    ratingPinId: ratingWrite.pinId ?? null,
                });
                let ratingMessageSent = false;
                let ratingMessagePinId = null;
                let ratingMessageError = null;
                if (combinedMessage) {
                    try {
                        const privateChatIdentity = await signer.getPrivateChatIdentity();
                        const peerChatPublicKey = serverBot === state.identity.globalMetaId
                            ? state.identity.chatPublicKey
                            : await resolvePeerChatPublicKey(serverBot) ?? '';
                        if (!peerChatPublicKey) {
                            throw new Error('Remote agent has no published chat public key on chain.');
                        }
                        const outgoingRatingMessage = (0, privateChat_1.sendPrivateChat)({
                            fromIdentity: {
                                globalMetaId: privateChatIdentity.globalMetaId,
                                privateKeyHex: privateChatIdentity.privateKeyHex,
                            },
                            toGlobalMetaId: serverBot,
                            peerChatPublicKey,
                            content: combinedMessage,
                        });
                        const ratingMessageWrite = await signer.writePin({
                            operation: 'create',
                            path: outgoingRatingMessage.path,
                            encryption: outgoingRatingMessage.encryption,
                            version: outgoingRatingMessage.version,
                            contentType: outgoingRatingMessage.contentType,
                            payload: outgoingRatingMessage.payload,
                            encoding: 'utf-8',
                            network,
                        });
                        ratingMessageSent = true;
                        ratingMessagePinId = ratingMessageWrite.pinId ?? null;
                    }
                    catch (error) {
                        ratingMessageError = error instanceof Error ? error.message : String(error);
                    }
                }
                const sessionState = await sessionStateStore.readState();
                const latestSession = sessionState.sessions
                    .filter((entry) => entry.traceId === request.traceId)
                    .sort((left, right) => left.updatedAt - right.updatedAt)
                    .at(-1);
                let nextTrace = trace;
                let nextArtifacts = trace.artifacts;
                if (latestSession) {
                    await appendA2ATranscriptItems(sessionStateStore, [
                        {
                            id: `${trace.traceId}-caller-rating-${Date.now().toString(36)}`,
                            sessionId: latestSession.sessionId,
                            taskRunId: latestSession.currentTaskRunId,
                            timestamp: Date.now(),
                            type: 'rating',
                            sender: 'caller',
                            content: request.comment,
                            metadata: {
                                event: 'service_rating_published',
                                rate: String(request.rate),
                                ratingPinId: ratingWrite.pinId ?? null,
                                ratingMessageSent,
                                ratingMessagePinId,
                                ratingMessageError,
                            },
                        },
                    ]);
                    if (combinedMessage) {
                        await appendA2ATranscriptItems(sessionStateStore, [
                            {
                                id: `${trace.traceId}-caller-rating-followup-${Date.now().toString(36)}`,
                                sessionId: latestSession.sessionId,
                                taskRunId: latestSession.currentTaskRunId,
                                timestamp: Date.now() + 1,
                                type: ratingMessageSent ? 'assistant' : 'status_note',
                                sender: ratingMessageSent ? 'caller' : 'system',
                                content: ratingMessageSent
                                    ? combinedMessage
                                    : `Buyer-side rating was published on-chain, but provider follow-up delivery failed: ${ratingMessageError ?? 'unknown error'}`,
                                metadata: {
                                    event: ratingMessageSent ? 'service_rating_message_sent' : 'service_rating_message_failed',
                                    ratingPinId: ratingWrite.pinId ?? null,
                                    ratingMessagePinId,
                                    ratingMessageError,
                                },
                            },
                        ]);
                    }
                    const rebuilt = await rebuildTraceArtifactsFromSessionState({
                        baseTrace: trace,
                        runtimeStateStore,
                        sessionStateStore,
                    });
                    nextTrace = rebuilt.trace;
                    nextArtifacts = rebuilt.artifacts;
                }
                return (0, commandResult_1.commandSuccess)({
                    traceId: request.traceId,
                    path: '/protocols/skill-service-rate',
                    pinId: ratingWrite.pinId ?? null,
                    txids: ratingWrite.txids,
                    rate: String(request.rate),
                    comment: request.comment,
                    serviceId,
                    servicePaidTx,
                    serverBot,
                    serviceSkill: payload.serviceSkill,
                    ratingMessageSent,
                    ratingMessagePinId,
                    ratingMessageError,
                    traceJsonPath: nextArtifacts.traceJsonPath ?? nextTrace.artifacts.traceJsonPath,
                    traceMarkdownPath: nextArtifacts.traceMarkdownPath ?? nextTrace.artifacts.traceMarkdownPath,
                    transcriptMarkdownPath: nextArtifacts.transcriptMarkdownPath ?? nextTrace.artifacts.transcriptMarkdownPath,
                });
            },
            execute: async (rawInput) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before serving remote calls.');
                }
                const execution = readExecuteServiceRequest(rawInput);
                if (!execution.servicePinId
                    || !execution.providerGlobalMetaId
                    || !execution.request.userTask) {
                    return (0, commandResult_1.commandFailed)('invalid_service_execution_request', 'Execution request must include servicePinId, providerGlobalMetaId, and request.userTask.');
                }
                if (execution.providerGlobalMetaId !== state.identity.globalMetaId) {
                    return (0, commandResult_1.commandFailed)('provider_identity_mismatch', 'Execution request does not match the local provider identity.');
                }
                const service = state.services.find((entry) => (entry.available === 1
                    && entry.currentPinId === execution.servicePinId
                    && entry.providerGlobalMetaId === execution.providerGlobalMetaId));
                if (!service) {
                    return (0, commandResult_1.commandFailed)('service_not_found', `Published service was not found: ${execution.servicePinId}`);
                }
                const traceId = execution.traceId || `trace-${sanitizeServiceSegment(service.serviceName)}-${Date.now().toString(36)}`;
                const received = sessionEngine.receiveProviderTask({
                    traceId,
                    servicePinId: service.currentPinId,
                    callerGlobalMetaId: execution.buyer.globalMetaId,
                    providerGlobalMetaId: execution.providerGlobalMetaId,
                    userTask: execution.request.userTask,
                    taskContext: execution.request.taskContext,
                });
                const receivedStatus = await persistSessionMutation(sessionStateStore, received);
                await appendA2ATranscriptItems(sessionStateStore, [
                    {
                        id: `${traceId}-provider-received-task`,
                        sessionId: received.session.sessionId,
                        taskRunId: received.taskRun.runId,
                        timestamp: received.session.createdAt,
                        type: 'user_task',
                        sender: 'caller',
                        content: execution.request.userTask,
                        metadata: {
                            taskContext: execution.request.taskContext || null,
                            callerGlobalMetaId: execution.buyer.globalMetaId || null,
                            callerName: execution.buyer.name || execution.buyer.host || null,
                            publicStatus: receivedStatus.status,
                        },
                    },
                ]);
                const runnerRegistry = (0, serviceRunnerRegistry_1.createServiceRunnerRegistry)([
                    {
                        servicePinId: service.currentPinId,
                        providerSkill: service.providerSkill,
                        runner: async ({ userTask, taskContext }) => ({
                            state: 'completed',
                            responseText: renderDemoRemoteServiceResponse({
                                serviceName: service.serviceName,
                                displayName: service.displayName,
                                userTask,
                                taskContext,
                            }),
                        }),
                    },
                ]);
                const runnerResult = await runnerRegistry.execute({
                    servicePinId: service.currentPinId,
                    providerSkill: service.providerSkill,
                    providerGlobalMetaId: execution.providerGlobalMetaId,
                    userTask: execution.request.userTask,
                    taskContext: execution.request.taskContext,
                    metadata: {
                        traceId,
                        externalConversationId: execution.externalConversationId || null,
                        buyer: execution.buyer,
                    },
                });
                const applied = sessionEngine.applyProviderRunnerResult({
                    session: received.session,
                    taskRun: received.taskRun,
                    result: runnerResult,
                });
                const appliedStatus = await persistSessionMutation(sessionStateStore, applied);
                const responseText = runnerResult.state === 'completed'
                    ? normalizeText(runnerResult.responseText)
                    : '';
                const providerMessage = runnerResult.state === 'completed'
                    ? normalizeText(runnerResult.responseText)
                    : runnerResult.state === 'needs_clarification'
                        ? normalizeText(runnerResult.question)
                        : normalizeText(runnerResult.message);
                await appendA2ATranscriptItems(sessionStateStore, [
                    {
                        id: `${traceId}-provider-runner-result`,
                        sessionId: received.session.sessionId,
                        taskRunId: applied.taskRun.runId,
                        timestamp: applied.session.updatedAt,
                        type: runnerResult.state === 'needs_clarification'
                            ? 'clarification_request'
                            : runnerResult.state === 'failed'
                                ? 'failure'
                                : 'assistant',
                        sender: runnerResult.state === 'failed' ? 'system' : 'provider',
                        content: providerMessage,
                        metadata: {
                            publicStatus: appliedStatus.status,
                            event: applied.event,
                            runnerState: runnerResult.state,
                        },
                    },
                ]);
                const trace = (0, sessionTrace_1.buildSessionTrace)({
                    traceId,
                    channel: 'a2a',
                    exportRoot: runtimeStateStore.paths.exportsRoot,
                    session: {
                        id: `session-${traceId}`,
                        title: `${service.displayName} Execution`,
                        type: 'a2a',
                        metabotId: state.identity.metabotId,
                        peerGlobalMetaId: execution.buyer.globalMetaId || null,
                        peerName: execution.buyer.name || execution.buyer.host || null,
                        externalConversationId: execution.externalConversationId || null,
                    },
                    order: {
                        id: `order-${traceId}`,
                        role: 'seller',
                        serviceId: service.currentPinId,
                        serviceName: service.displayName,
                        paymentTxid: null,
                        paymentCurrency: service.currency,
                        paymentAmount: service.price,
                    },
                    a2a: {
                        sessionId: received.session.sessionId,
                        taskRunId: applied.taskRun.runId,
                        role: received.session.role,
                        publicStatus: appliedStatus.status,
                        latestEvent: applied.event,
                        taskRunState: applied.taskRun.state,
                        callerGlobalMetaId: received.session.callerGlobalMetaId,
                        callerName: execution.buyer.name || execution.buyer.host || null,
                        providerGlobalMetaId: received.session.providerGlobalMetaId,
                        servicePinId: received.session.servicePinId,
                    },
                });
                const artifacts = await (0, transcriptExport_1.exportSessionArtifacts)({
                    trace,
                    transcript: {
                        sessionId: trace.session.id,
                        title: trace.session.title,
                        messages: [
                            {
                                id: `${trace.traceId}-buyer`,
                                type: 'user',
                                timestamp: trace.createdAt,
                                content: execution.request.userTask,
                                metadata: {
                                    taskContext: execution.request.taskContext || null,
                                    buyerHost: execution.buyer.host || null,
                                    buyerGlobalMetaId: execution.buyer.globalMetaId || null,
                                },
                            },
                            {
                                id: `${trace.traceId}-provider`,
                                type: 'assistant',
                                timestamp: trace.createdAt,
                                content: providerMessage,
                                metadata: {
                                    servicePinId: service.currentPinId,
                                    providerGlobalMetaId: state.identity.globalMetaId,
                                    providerSessionId: received.session.sessionId,
                                    providerTaskRunId: received.taskRun.runId,
                                    providerEvent: applied.event,
                                },
                            },
                        ],
                    },
                });
                await runtimeStateStore.writeState({
                    ...state,
                    traces: [
                        trace,
                        ...state.traces.filter((entry) => entry.traceId !== trace.traceId),
                    ],
                });
                if (runnerResult.state === 'needs_clarification') {
                    return (0, commandResult_1.commandManualActionRequired)('clarification_needed', runnerResult.question, `/ui/trace?traceId=${encodeURIComponent(trace.traceId)}`);
                }
                if (runnerResult.state === 'failed') {
                    return (0, commandResult_1.commandFailed)(runnerResult.code, runnerResult.message);
                }
                return (0, commandResult_1.commandSuccess)({
                    traceId: trace.traceId,
                    externalConversationId: trace.session.externalConversationId,
                    responseText,
                    providerGlobalMetaId: state.identity.globalMetaId,
                    servicePinId: service.currentPinId,
                    serviceName: service.displayName,
                    traceJsonPath: artifacts.traceJsonPath,
                    traceMarkdownPath: artifacts.traceMarkdownPath,
                    transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
                });
            },
        },
        chat: {
            privateConversation: async (rawInput) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before viewing private chat.');
                }
                const request = readPrivateConversationRequest(rawInput);
                if (!request.peer) {
                    return (0, commandResult_1.commandFailed)('missing_peer', 'peer query parameter is required.');
                }
                let privateChatIdentity;
                try {
                    privateChatIdentity = await signer.getPrivateChatIdentity();
                }
                catch (error) {
                    return (0, commandResult_1.commandFailed)('identity_secret_missing', error instanceof Error ? error.message : 'Local private chat key is missing from the secret store.');
                }
                let peerChatPublicKey = request.peer === state.identity.globalMetaId
                    ? normalizeText(state.identity.chatPublicKey) || privateChatIdentity.chatPublicKey
                    : '';
                if (!peerChatPublicKey) {
                    peerChatPublicKey = await resolvePeerChatPublicKey(request.peer) ?? '';
                }
                if (!peerChatPublicKey) {
                    return (0, commandResult_1.commandFailed)('peer_chat_public_key_missing', 'Target has no chat public key on chain.');
                }
                try {
                    const response = await (0, privateConversation_1.buildPrivateConversationResponse)({
                        selfGlobalMetaId: state.identity.globalMetaId,
                        peerGlobalMetaId: request.peer,
                        localPrivateKeyHex: privateChatIdentity.privateKeyHex,
                        peerChatPublicKey,
                        afterIndex: request.afterIndex,
                        limit: request.limit,
                        fetchHistory: input.fetchPrivateChatHistory,
                        idChatApiBaseUrl: input.idChatApiBaseUrl,
                    });
                    return (0, commandResult_1.commandSuccess)(response);
                }
                catch (error) {
                    return (0, commandResult_1.commandFailed)('history_fetch_failed', error instanceof Error ? error.message : 'Failed to fetch private chat history.');
                }
            },
            private: async (rawInput) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before sending private chat.');
                }
                const request = readPrivateChatRequest(rawInput);
                if (!request.to || !request.content) {
                    return (0, commandResult_1.commandFailed)('invalid_chat_request', 'Private chat request must include to and content.');
                }
                let privateChatIdentity;
                try {
                    privateChatIdentity = await signer.getPrivateChatIdentity();
                }
                catch (error) {
                    return (0, commandResult_1.commandFailed)('identity_secret_missing', error instanceof Error ? error.message : 'Local private chat key is missing from the secret store.');
                }
                let peerChatPublicKey = request.peerChatPublicKey;
                if (!peerChatPublicKey && request.to === state.identity.globalMetaId) {
                    peerChatPublicKey = state.identity.chatPublicKey;
                }
                if (!peerChatPublicKey) {
                    peerChatPublicKey = await resolvePeerChatPublicKey(request.to) ?? '';
                }
                if (!peerChatPublicKey) {
                    return (0, commandResult_1.commandFailed)('peer_chat_public_key_missing', 'Target has no chat public key on chain and none was provided.');
                }
                const sent = (0, privateChat_1.sendPrivateChat)({
                    fromIdentity: {
                        globalMetaId: privateChatIdentity.globalMetaId,
                        privateKeyHex: privateChatIdentity.privateKeyHex,
                    },
                    toGlobalMetaId: request.to,
                    peerChatPublicKey,
                    content: request.content,
                    replyPinId: request.replyPin,
                });
                let chatWrite;
                try {
                    chatWrite = await signer.writePin({
                        operation: 'create',
                        path: sent.path,
                        encryption: sent.encryption,
                        version: sent.version,
                        contentType: sent.contentType,
                        payload: sent.payload,
                        encoding: 'utf-8',
                        network: 'mvc',
                    });
                }
                catch (error) {
                    return (0, commandResult_1.commandFailed)('chat_broadcast_failed', error instanceof Error ? error.message : 'Failed to broadcast private chat to chain.');
                }
                const structuredContent = describeStructuredPrivateChatContent(request.content);
                const traceId = `trace-private-${Date.now().toString(36)}`;
                const trace = (0, sessionTrace_1.buildSessionTrace)({
                    traceId,
                    channel: 'simplemsg',
                    exportRoot: runtimeStateStore.paths.exportsRoot,
                    session: {
                        id: `chat-${traceId}`,
                        title: 'Private Chat',
                        type: 'a2a',
                        metabotId: state.identity.metabotId,
                        peerGlobalMetaId: request.to,
                        peerName: null,
                        externalConversationId: `simplemsg:${state.identity.globalMetaId}:${request.to}:${traceId}`,
                    },
                });
                const artifacts = await (0, transcriptExport_1.exportSessionArtifacts)({
                    trace,
                    transcript: {
                        sessionId: trace.session.id,
                        title: trace.session.title,
                        messages: [
                            {
                                id: `${trace.traceId}-user`,
                                type: 'user',
                                timestamp: trace.createdAt,
                                content: request.content,
                            },
                            {
                                id: `${trace.traceId}-assistant`,
                                type: 'assistant',
                                timestamp: trace.createdAt,
                                content: `Encrypted private message prepared for ${request.to}.`,
                                metadata: {
                                    path: sent.path,
                                    pinId: normalizeText(chatWrite.pinId) || null,
                                    txids: Array.isArray(chatWrite.txids) ? chatWrite.txids : [],
                                    replyPin: request.replyPin || null,
                                    messageType: structuredContent.messageType,
                                    requestId: structuredContent.requestId,
                                    correlatedTraceId: structuredContent.traceId,
                                },
                            },
                        ],
                    },
                });
                await runtimeStateStore.writeState({
                    ...state,
                    traces: [
                        trace,
                        ...state.traces.filter((entry) => entry.traceId !== trace.traceId),
                    ],
                });
                return (0, commandResult_1.commandSuccess)({
                    to: request.to,
                    path: sent.path,
                    pinId: normalizeText(chatWrite.pinId) || null,
                    txids: Array.isArray(chatWrite.txids) ? chatWrite.txids : [],
                    totalCost: Number.isFinite(Number(chatWrite.totalCost))
                        ? Number(chatWrite.totalCost)
                        : null,
                    network: normalizeText(chatWrite.network) || 'mvc',
                    deliveryMode: 'onchain_simplemsg',
                    messageType: structuredContent.messageType,
                    requestId: structuredContent.requestId,
                    correlatedTraceId: structuredContent.traceId,
                    traceId: trace.traceId,
                    localUiUrl: buildDaemonLocalUiUrl(input.getDaemonRecord(), '/ui/chat-viewer', { peer: request.to }),
                    transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
                    traceMarkdownPath: artifacts.traceMarkdownPath,
                    traceJsonPath: artifacts.traceJsonPath,
                });
            },
            privateChatConversations: async () => {
                const state = await privateChatStateStore.readState();
                return (0, commandResult_1.commandSuccess)({ conversations: state.conversations });
            },
            privateChatMessages: async (msgInput) => {
                const messages = await privateChatStateStore.getRecentMessages(normalizeText(msgInput.conversationId), typeof msgInput.limit === 'number' && Number.isFinite(msgInput.limit)
                    ? Math.max(1, Math.trunc(msgInput.limit))
                    : 50);
                return (0, commandResult_1.commandSuccess)({ messages });
            },
            autoReplyStatus: async () => {
                return (0, commandResult_1.commandSuccess)({
                    enabled: autoReplyConfig.enabled,
                    acceptPolicy: autoReplyConfig.acceptPolicy,
                    defaultStrategyId: autoReplyConfig.defaultStrategyId,
                });
            },
            setAutoReply: async (autoReplyInput) => {
                autoReplyConfig.enabled = autoReplyInput.enabled === true;
                if (autoReplyInput.defaultStrategyId !== undefined) {
                    autoReplyConfig.defaultStrategyId = normalizeText(autoReplyInput.defaultStrategyId) || null;
                }
                return (0, commandResult_1.commandSuccess)({
                    enabled: autoReplyConfig.enabled,
                    defaultStrategyId: autoReplyConfig.defaultStrategyId,
                });
            },
        },
        file: {
            upload: async (rawInput) => {
                const state = await runtimeStateStore.readState();
                if (!state.identity) {
                    return (0, commandResult_1.commandFailed)('identity_missing', 'Create a local MetaBot identity before uploading files.');
                }
                try {
                    const result = await (0, uploadFile_1.uploadLocalFileToChain)({
                        filePath: normalizeText(rawInput.filePath),
                        contentType: typeof rawInput.contentType === 'string' ? rawInput.contentType : undefined,
                        network: typeof rawInput.network === 'string' ? rawInput.network : undefined,
                        signer,
                    });
                    return (0, commandResult_1.commandSuccess)(result);
                }
                catch (error) {
                    return (0, commandResult_1.commandFailed)('file_upload_failed', error instanceof Error ? error.message : String(error));
                }
            },
        },
        trace: {
            getTrace: async ({ traceId }) => {
                const state = await runtimeStateStore.readState();
                const trace = state.traces.find((entry) => entry.traceId === traceId);
                if (!trace) {
                    return (0, commandResult_1.commandFailed)('trace_not_found', `Trace not found: ${traceId}`);
                }
                return (0, commandResult_1.commandSuccess)(await buildTraceInspectorPayload({
                    traceId,
                    trace,
                    sessionStateStore,
                    ratingDetailStateStore,
                    chainApiBaseUrl: input.chainApiBaseUrl,
                }));
            },
            watchTrace: async ({ traceId }) => {
                const normalizedTraceId = normalizeText(traceId);
                if (!normalizedTraceId) {
                    return '';
                }
                const deadline = Date.now() + DEFAULT_TRACE_WATCH_WAIT_MS;
                while (true) {
                    const sessionState = await sessionStateStore.readState();
                    const events = (0, traceWatch_1.buildTraceWatchEvents)({
                        traceId: normalizedTraceId,
                        sessions: sessionState.sessions,
                        snapshots: sessionState.publicStatusSnapshots,
                    });
                    if (events.length > 0) {
                        const serialized = (0, traceWatch_1.serializeTraceWatchEvents)(events);
                        if (events.at(-1)?.terminal || Date.now() >= deadline) {
                            return serialized;
                        }
                    }
                    else {
                        const runtimeState = await runtimeStateStore.readState();
                        const traceExists = runtimeState.traces.some((entry) => entry.traceId === normalizedTraceId)
                            || sessionState.sessions.some((entry) => normalizeText(entry.traceId) === normalizedTraceId);
                        if (!traceExists || Date.now() >= deadline) {
                            return '';
                        }
                    }
                    const remainingMs = deadline - Date.now();
                    if (remainingMs <= 0) {
                        const finalState = await sessionStateStore.readState();
                        const finalEvents = (0, traceWatch_1.buildTraceWatchEvents)({
                            traceId: normalizedTraceId,
                            sessions: finalState.sessions,
                            snapshots: finalState.publicStatusSnapshots,
                        });
                        return (0, traceWatch_1.serializeTraceWatchEvents)(finalEvents);
                    }
                    await sleep(Math.min(TRACE_WATCH_POLL_INTERVAL_MS, remainingMs));
                }
            },
        },
    };
}
