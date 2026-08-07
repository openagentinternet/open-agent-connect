"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOacBrowserHostAdapter = createOacBrowserHostAdapter;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const metabotProfileManager_1 = require("../../core/bot/metabotProfileManager");
const conversationUrl_1 = require("../../core/a2a/conversationUrl");
const agent_browser_core_1 = require("@openagentinternet/agent-browser-core");
const agent_browser_name_resolvers_1 = require("@openagentinternet/agent-browser-name-resolvers");
const agent_browser_host_contract_1 = require("@openagentinternet/agent-browser-host-contract");
const configStore_1 = require("../../core/config/configStore");
const infrastructureConfigStore_1 = require("../../core/config/infrastructureConfigStore");
const llmTypes_1 = require("../../core/llm/llmTypes");
const artifactCache_1 = require("../../core/metaapp/artifactCache");
const artifactDownload_1 = require("../../core/metaapp/artifactDownload");
const types_1 = require("../../core/appSession/types");
const DEFAULT_PIN_WRITE_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const LLM_COMPLETE_DEFAULT_TIMEOUT_MS = 120_000;
const LLM_COMPLETE_MAX_TIMEOUT_MS = 180_000;
const LLM_COMPLETE_RATE_LIMIT_PER_MINUTE = 6;
const GRANTED_WRITE_RATE_LIMIT_PER_MINUTE = 12;
const GRANTED_WRITE_MAX_PAYLOAD_BYTES = 16 * 1024;
const PERMISSION_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const PROTOCOL_GRANT_WHITELIST = new Set([
    '/protocols/simplegroupcreate',
    '/protocols/simplegroupjoin',
    '/protocols/simplegroupchat',
]);
const PROTOCOL_GRANT_PATH_PATTERN = /^\/protocols\/[A-Za-z0-9_-]+$/u;
const PIN_ID_PATTERN = /^[0-9a-f]{64}i\d+$/iu;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizePreferredCreateHost(value) {
    const provider = normalizeText(value);
    return provider && provider !== 'custom' && (0, llmTypes_1.isLlmProvider)(provider) ? provider : null;
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function normalizeStringList(value) {
    if (Array.isArray(value)) {
        return value
            .filter((item) => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}
function hasExplicitEmptyEnsRpcUrls(config, env) {
    if (normalizeStringList(env.METABOT_BROWSER_ENS_RPC_URLS).length > 0) {
        return false;
    }
    const browser = browserRecord(config.browser);
    const nameResolution = browserRecord(browser.nameResolution);
    const ens = browserRecord(nameResolution.ens);
    return hasOwn(ens, 'rpcUrls') && normalizeStringList(ens.rpcUrls).length === 0;
}
function resolveBrowserHostConfig(input) {
    const browserConfig = (0, agent_browser_core_1.resolveBrowserConfig)(input.config, input.env);
    const nameAliasConfig = hasExplicitEmptyEnsRpcUrls(input.config, input.env)
        ? {
            ...browserConfig,
            nameResolution: {
                ...browserConfig.nameResolution,
                ens: {
                    ...browserConfig.nameResolution.ens,
                    enabled: false,
                    rpcUrls: [],
                },
            },
        }
        : browserConfig;
    return {
        browserConfig,
        nameAliasProviders: (0, agent_browser_name_resolvers_1.createBrowserNameAliasProviders)({
            configured: input.configuredNameAliasProviders,
            config: nameAliasConfig,
            ...(input.ensNameAliasProviderFactory
                ? { ensNameAliasProviderFactory: input.ensNameAliasProviderFactory }
                : {}),
        }),
    };
}
function withInfrastructureConfig(config, infrastructure) {
    return {
        ...config,
        browser: {
            ...config.browser,
            ...infrastructure,
        },
    };
}
function splitBrowserSettingsConfig(config) {
    const { metasoP2PBaseUrl, metafileContentBaseUrl, manApiBaseUrl, ...profileBrowser } = config.browser ?? {};
    const defaults = (0, infrastructureConfigStore_1.createDefaultInfrastructureConfig)();
    return {
        profileConfig: {
            ...config,
            browser: profileBrowser,
        },
        infrastructure: {
            metasoP2PBaseUrl: metasoP2PBaseUrl ?? defaults.metasoP2PBaseUrl,
            metafileContentBaseUrl: metafileContentBaseUrl ?? defaults.metafileContentBaseUrl,
            manApiBaseUrl: manApiBaseUrl ?? defaults.manApiBaseUrl,
        },
    };
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
// Renderer content types for preview-metaapp://localhost entry files, mirroring
// the IDBots host wiring. Unknown extensions preview as HTML, matching the
// reference hosts' default.
const PREVIEW_METAAPP_CONTENT_TYPES = {
    '.html': 'text/html',
    '.htm': 'text/html',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
};
function previewMetaAppContentType(filePath) {
    return PREVIEW_METAAPP_CONTENT_TYPES[node_path_1.default.extname(filePath).toLowerCase()] || 'text/html';
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
function profileToMetaAppBridgeActor(profile) {
    const globalMetaId = normalizeText(profile.globalMetaId);
    if (!globalMetaId) {
        return null;
    }
    return {
        uri: `metaid://${globalMetaId}`,
        globalMetaId,
        name: normalizeText(profile.name) || profile.slug,
    };
}
function toBrowserRecord(value) {
    return { ...value };
}
function browserRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function stringField(value) {
    return typeof value === 'string' ? value : null;
}
function safeBridgeMessage(value, fallback) {
    const message = normalizeText(value);
    if (!message)
        return fallback;
    if (/\/Users\/|\.metabot|\/api\/|private\s*key|mnemonic|token|stack\s*trace/iu.test(message)) {
        return fallback;
    }
    return message;
}
function normalizeBridgeDisplay(value) {
    const source = browserRecord(value);
    const title = normalizeText(source.title);
    const summary = normalizeText(source.summary);
    if (!title && !summary) {
        return undefined;
    }
    return {
        ...(title ? { title } : {}),
        ...(summary ? { summary } : {}),
    };
}
function normalizePinWriteOperation(value) {
    const operation = normalizeText(value).toLowerCase();
    return operation === 'create' || operation === 'modify' || operation === 'revoke' ? operation : null;
}
function normalizePinWriteEncryption(value) {
    const encryption = normalizeText(value);
    return encryption === '0' || encryption === '1' || encryption === '2' ? encryption : null;
}
function normalizePinWritePayloadEncoding(value) {
    const encoding = normalizeText(value).toLowerCase();
    if (encoding === 'utf8' || encoding === 'utf-8')
        return 'utf-8';
    if (encoding === 'base64')
        return 'base64';
    return null;
}
function isValidBase64Payload(value) {
    if (!value || value.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
        return false;
    }
    try {
        Buffer.from(value, 'base64');
        return true;
    }
    catch {
        return false;
    }
}
function isPinId(value) {
    return PIN_ID_PATTERN.test(value);
}
function normalizeTargetPinId(value) {
    const text = normalizeText(value);
    if (!text)
        return '';
    if (text.startsWith('@'))
        return text.slice(1);
    if (text.startsWith('pin://'))
        return text.slice('pin://'.length);
    return text;
}
function targetPinIdFromPath(value) {
    if (!value.startsWith('@'))
        return '';
    const pinId = value.slice(1);
    return isPinId(pinId) ? pinId : '';
}
function normalizeOptionalBridgeField(value, fieldName) {
    const text = normalizeText(value);
    if (!text)
        return {};
    if (/[\r\n]/u.test(text)) {
        return { failure: invalidBridgeParams(`metaid.pin.write ${fieldName} must be a single-line string.`) };
    }
    return { value: text };
}
function sameAppSessionStartParams(left, right) {
    const leftBudget = left.budget ?? {};
    const rightBudget = right.budget ?? {};
    return left.appId === right.appId
        && left.sessionType === right.sessionType
        && left.groupId === right.groupId
        && left.gameId === right.gameId
        && left.manifestUri === right.manifestUri
        && left.rulesHash === right.rulesHash
        && left.seat === right.seat
        && left.agentId === right.agentId
        && (left.ttlMs ?? 86_400_000) === (right.ttlMs ?? 86_400_000)
        && (leftBudget.llmCalls ?? 500) === (rightBudget.llmCalls ?? 500)
        && (leftBudget.writes ?? 500) === (rightBudget.writes ?? 500);
}
function payloadByteSize(input) {
    return input.encoding === 'base64'
        ? Buffer.from(input.payload, 'base64').byteLength
        : Buffer.byteLength(input.payload, 'utf8');
}
function invalidBridgeParams(message) {
    return (0, agent_browser_host_contract_1.browserFailure)('invalid_params', message);
}
function validateMetaIdPinWritePayload(payload) {
    const operation = normalizePinWriteOperation(payload.operation);
    if (!operation) {
        return { failure: invalidBridgeParams('metaid.pin.write operation must be create, modify, or revoke.') };
    }
    const pathValue = normalizeText(payload.path);
    if (operation === 'create') {
        if (!pathValue || !pathValue.startsWith('/')) {
            return { failure: invalidBridgeParams('metaid.pin.write create path must be an absolute MetaID protocol path.') };
        }
    }
    else {
        // OAC's signer targets modify/revoke writes through path: @pinId; originalId is preserved but must agree.
        const targetPinId = targetPinIdFromPath(pathValue);
        if (!targetPinId) {
            return { failure: invalidBridgeParams('metaid.pin.write modify and revoke path must be @<pinId>.') };
        }
        const originalId = normalizeTargetPinId(payload.originalId);
        if (originalId && (!isPinId(originalId) || originalId !== targetPinId)) {
            return { failure: invalidBridgeParams('metaid.pin.write originalId must match the @<pinId> path target.') };
        }
    }
    const encryption = normalizePinWriteEncryption(payload.encryption);
    if (!encryption) {
        return { failure: invalidBridgeParams('metaid.pin.write encryption must be 0, 1, or 2.') };
    }
    const version = normalizeText(payload.version);
    if (!version) {
        return { failure: invalidBridgeParams('metaid.pin.write version is required.') };
    }
    const contentType = normalizeText(payload.contentType);
    if (!contentType || /[\r\n]/u.test(contentType)) {
        return { failure: invalidBridgeParams('metaid.pin.write contentType is required.') };
    }
    const rawPayload = browserRecord(payload.payload);
    const encoding = normalizePinWritePayloadEncoding(rawPayload.encoding);
    const payloadValue = stringField(rawPayload.value);
    if (!encoding || payloadValue === null) {
        return { failure: invalidBridgeParams('metaid.pin.write payload requires encoding and string value.') };
    }
    if (encoding === 'base64' && !isValidBase64Payload(payloadValue)) {
        return { failure: invalidBridgeParams('metaid.pin.write base64 payload is invalid.') };
    }
    const originalIdResult = normalizeOptionalBridgeField(payload.originalId, 'originalId');
    if ('failure' in originalIdResult)
        return originalIdResult;
    const appActionResult = normalizeOptionalBridgeField(payload.appAction, 'appAction');
    if ('failure' in appActionResult)
        return appActionResult;
    const hostConfirmationSource = browserRecord(payload.hostConfirmation);
    const hostConfirmationId = normalizeText(hostConfirmationSource.id);
    const hostConfirmationToken = normalizeText(hostConfirmationSource.token);
    const hostConfirmation = hostConfirmationId && hostConfirmationToken
        ? { id: hostConfirmationId, token: hostConfirmationToken }
        : undefined;
    const request = {
        operation,
        path: pathValue,
        encryption,
        version,
        contentType,
        encoding,
        payload: payloadValue,
        ...(originalIdResult.value ? { originalId: originalIdResult.value } : {}),
        ...(appActionResult.value ? { appAction: appActionResult.value } : {}),
    };
    const display = normalizeBridgeDisplay(payload.display);
    const bridgePayload = {
        operation,
        path: pathValue,
        encryption,
        version,
        contentType,
        payload: {
            encoding: encoding === 'utf-8' ? 'utf8' : 'base64',
            value: payloadValue,
        },
        ...(originalIdResult.value ? { originalId: originalIdResult.value } : {}),
        ...(appActionResult.value ? { appAction: appActionResult.value } : {}),
        ...(display ? { display } : {}),
    };
    return {
        request,
        bridgePayload,
        ...(display ? { display } : {}),
        ...(hostConfirmation ? { hostConfirmation } : {}),
        confirmed: payload.confirmed === true,
        payloadSize: payloadByteSize(request),
    };
}
function decodeMetaFileUploadData(rawData, fileName) {
    if (Buffer.isBuffer(rawData)) {
        return rawData.length ? rawData : null;
    }
    const dataString = normalizeText(rawData);
    if (!dataString) {
        return null;
    }
    // Accept data: URLs and bare base64. A content-type in the data: URL takes
    // precedence only as a fallback; the explicit entry contentType wins upstream.
    const match = /^data:([^;,]*)?(;base64)?,(.*)$/isu.exec(dataString);
    const base64 = match ? (match[3] ?? '') : dataString;
    if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) {
        return null;
    }
    try {
        const buffer = Buffer.from(base64, 'base64');
        return buffer.length ? buffer : null;
    }
    catch {
        return null;
    }
}
function validateMetaFileUploadPayload(payload) {
    const source = browserRecord(payload.source);
    if (normalizeText(source.kind) !== 'host-picker') {
        return { failure: invalidBridgeParams('metafile.upload source.kind must be host-picker.') };
    }
    const accept = Array.isArray(source.accept)
        ? source.accept.map((entry) => normalizeText(entry)).filter(Boolean)
        : [];
    const purpose = normalizeText(payload.purpose) || undefined;
    const entries = [];
    const rawEntries = Array.isArray(payload.entries) ? payload.entries : [];
    for (const rawEntry of rawEntries) {
        const record = browserRecord(rawEntry);
        const name = normalizeText(record.name) || normalizeText(record.fileName);
        const contentType = normalizeText(record.contentType) || normalizeText(record.mimeType) || undefined;
        const data = decodeMetaFileUploadData(record.data, name);
        if (!data) {
            return { failure: invalidBridgeParams('metafile.upload entry requires base64 data.') };
        }
        entries.push({ name: name || 'upload', ...(contentType ? { contentType } : {}), data });
    }
    return {
        multiple: source.multiple === true,
        accept,
        entries,
        ...(purpose ? { purpose } : {}),
    };
}
function sanitizeMetaAppBridgeActor(value) {
    const source = browserRecord(value);
    const globalMetaId = normalizeText(source.globalMetaId);
    const uri = normalizeText(source.uri) || (globalMetaId ? `metaid://${globalMetaId}` : '');
    const name = normalizeText(source.name);
    if (!globalMetaId || !uri.startsWith('metaid://') || !name) {
        return null;
    }
    const avatarPinId = normalizeText(source.avatarPinId);
    return {
        uri,
        globalMetaId,
        name,
        ...(avatarPinId && !avatarPinId.includes('/') && !avatarPinId.includes('\\') ? { avatarPinId } : {}),
    };
}
function mapPinWriteFailureCode(value) {
    if (value === 'profile_not_found' || value === 'identity_missing' || value === 'browser_identity_required') {
        return 'actor_required';
    }
    if (value === 'manual_action_required' || value === 'confirmation_required') {
        return 'manual_action_required';
    }
    if (value === 'invalid_argument' || value === 'invalid_browser_action') {
        return 'invalid_params';
    }
    return value || 'pin_write_failed';
}
function firstString(value) {
    if (!Array.isArray(value))
        return '';
    for (const item of value) {
        const text = normalizeText(item);
        if (text)
            return text;
    }
    return '';
}
function sanitizePinWriteResultData(input) {
    const source = browserRecord(input.resultData);
    const pinId = normalizeText(source.pinId);
    const txid = normalizeText(source.txid) || firstString(source.txids);
    if (!pinId || !txid) {
        return null;
    }
    const operation = normalizePinWriteOperation(source.operation) ?? input.request.operation;
    const pathValue = normalizeText(source.path) || input.request.path;
    const actor = sanitizeMetaAppBridgeActor(source.actor) ?? input.actor;
    return {
        pinId,
        txid,
        operation,
        path: pathValue,
        actor,
    };
}
function sanitizeMetaFileUploadResultFiles(input) {
    const source = browserRecord(input.resultData);
    const rawFiles = Array.isArray(source.files) ? source.files : (Array.isArray(source) ? source : null);
    if (!rawFiles) {
        const singleFile = normalizeMetaFileUploadFileEntry(source, input.actor);
        return singleFile ? [singleFile] : [];
    }
    const files = [];
    for (const entry of rawFiles) {
        const file = normalizeMetaFileUploadFileEntry(entry, input.actor);
        if (file) {
            files.push(file);
        }
    }
    return files;
}
function normalizeMetaFileUploadFileEntry(entry, fallbackActor) {
    const source = browserRecord(entry);
    const pinId = normalizeText(source.pinId);
    if (!pinId) {
        return null;
    }
    const name = normalizeText(source.name) || normalizeText(source.fileName) || 'upload';
    const contentType = normalizeText(source.contentType) || 'application/octet-stream';
    const uri = normalizeText(source.uri) || normalizeText(source.metafileUri) || `metafile://${pinId}`;
    const sizeValue = Number(source.size ?? source.bytes);
    const actor = sanitizeMetaAppBridgeActor(source.actor) ?? fallbackActor;
    const file = {
        pinId,
        uri,
        name,
        size: Number.isFinite(sizeValue) && sizeValue >= 0 ? Math.floor(sizeValue) : 0,
        contentType,
        actor,
    };
    const contentHash = normalizeText(source.contentHash);
    if (contentHash) {
        file.contentHash = contentHash;
    }
    return file;
}
function sha256Text(value) {
    return (0, node_crypto_1.createHash)('sha256').update(value, 'utf8').digest('hex');
}
function safeHashEqual(left, right) {
    const leftBuffer = Buffer.from(left, 'hex');
    const rightBuffer = Buffer.from(right, 'hex');
    return leftBuffer.length === rightBuffer.length && (0, node_crypto_1.timingSafeEqual)(leftBuffer, rightBuffer);
}
function pinWriteRequestHash(input) {
    const payloadHash = sha256Text(input.request.payload);
    return sha256Text(JSON.stringify({
        actorId: input.actorId,
        actorGlobalMetaId: input.actor.globalMetaId,
        actorUri: input.actor.uri,
        resourceUri: input.resourceUri,
        operation: input.request.operation,
        path: input.request.path,
        encryption: input.request.encryption,
        version: input.request.version,
        contentType: input.request.contentType,
        encoding: input.request.encoding,
        payloadHash,
        originalId: input.request.originalId ?? '',
        appAction: input.request.appAction ?? '',
    }));
}
function followUpActionFromOac(result) {
    const resultData = browserRecord(result.data);
    const href = normalizeText(result.localUiUrl);
    // When the producer did not hand back a Conversations localUiUrl, try to
    // build one from the local+peer ids commonly present on OAC results so the
    // follow-up card still lands on the right conversation thread. Only emit a
    // follow-up when there is something to link to.
    const fallbackLocal = normalizeText(resultData.localGlobalMetaId)
        || normalizeText(resultData.callerGlobalMetaId);
    const fallbackPeer = normalizeText(resultData.peerGlobalMetaId)
        || normalizeText(resultData.providerGlobalMetaId)
        || normalizeText(resultData.counterpartyGlobalMetaId)
        || normalizeText(resultData.to)
        || normalizeText(resultData.toGlobalMetaId);
    const route = href || (!fallbackLocal && !fallbackPeer)
        ? ''
        : (0, conversationUrl_1.buildConversationHref)(fallbackLocal, fallbackPeer);
    if (!href && !route)
        return undefined;
    const action = {
        label: normalizeText(result.actionLabel) || 'Open details',
    };
    if (href)
        action.href = href;
    if (route)
        action.route = route;
    return action;
}
function browserResultData(value) {
    const data = browserRecord(value);
    return Object.keys(data).length ? data : undefined;
}
function browserFailureCode(result) {
    return normalizeText(result.code) || normalizeText(result.state) || 'browser_oac_failure';
}
function browserFailureMessage(result) {
    return normalizeText(result.message) || 'OAC Browser command failed.';
}
async function resolveMetaAppPreviewUrl(input) {
    const artifact = await (0, artifactDownload_1.resolveMetaAppArtifact)({
        pinId: input.pinId,
        contentReference: input.contentReference,
        contentType: input.contentType,
        indexFile: input.indexFile,
        pinRecord: input.pinRecord,
        artifactCache: input.artifactCache,
        fetchImpl: input.fetchImpl,
    });
    if (!artifact) {
        return '';
    }
    const session = input.metaAppPreviewSessions.create({
        artifactDir: artifact.artifactDir,
        indexFile: artifact.indexFile,
    });
    return buildMetaAppPreviewAssetUrl(session.previewId, artifact.indexFile);
}
function toBrowserFailure(result) {
    const options = {};
    const action = followUpActionFromOac(result);
    const data = browserResultData(result.data);
    if (action)
        options.action = action;
    if (data)
        options.data = data;
    return (0, agent_browser_host_contract_1.browserFailure)(browserFailureCode(result), browserFailureMessage(result), options);
}
function toBrowserResult(result) {
    if (result.ok) {
        return (0, agent_browser_host_contract_1.browserSuccess)(result.data);
    }
    if (result.state === 'waiting') {
        const options = {};
        const pollAfterMs = result.pollAfterMs;
        const action = followUpActionFromOac(result);
        const data = browserResultData(result.data);
        if (typeof pollAfterMs === 'number')
            options.pollAfterMs = pollAfterMs;
        if (action)
            options.action = action;
        if (data)
            options.data = data;
        return (0, agent_browser_host_contract_1.browserWaiting)(browserFailureCode(result), browserFailureMessage(result), options);
    }
    if (result.state === 'manual_action_required') {
        const options = {};
        const action = followUpActionFromOac(result);
        const data = browserResultData(result.data);
        if (action)
            options.action = action;
        if (data)
            options.data = data;
        return (0, agent_browser_host_contract_1.browserManualActionRequired)(browserFailureCode(result), browserFailureMessage(result), options);
    }
    return toBrowserFailure(result);
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
    return (0, conversationUrl_1.buildConversationHref)(localGlobalMetaId, peerGlobalMetaId);
}
function createBotHref(env) {
    const query = new URLSearchParams({ mode: 'create' });
    const host = normalizePreferredCreateHost(env.METABOT_HOST) ?? normalizePreferredCreateHost(env.OAC_HOST);
    if (host)
        query.set('host', host);
    return `/ui/bot?${query.toString()}`;
}
function toHostBrowserSettingsSnapshot(snapshot) {
    return {
        browser: toBrowserRecord(snapshot.browser ?? {}),
        effectiveBrowser: toBrowserRecord(snapshot.effectiveBrowser ?? {}),
        defaults: toBrowserRecord(snapshot.defaults ?? {}),
        ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
    };
}
function toBrowserTrustedActionResult(kind, result) {
    if (!result.ok) {
        return toBrowserResult(result);
    }
    return (0, agent_browser_host_contract_1.browserSuccess)({
        kind,
        handled: true,
        ...(trustedActionResultData(result.data) ? {
            data: trustedActionResultData(result.data),
        } : {}),
    });
}
function copyUriTrustedActionResult(actionInput) {
    const payload = readActionPayload(actionInput);
    const copiedText = normalizeText(payload.uri) || normalizeText(payload.currentUri) || normalizeText(actionInput.resourceUri);
    return (0, agent_browser_host_contract_1.browserSuccess)({
        kind: 'copy-uri',
        handled: true,
        data: {
            copiedText,
        },
    });
}
function successTrustedActionResult(kind, data) {
    return (0, agent_browser_host_contract_1.browserSuccess)({
        kind,
        handled: true,
        ...(data ? { data } : {}),
    });
}
function createOacBrowserHostAdapter(input) {
    const env = input.env ?? process.env;
    const fetchImpl = input.fetch ?? globalThis.fetch;
    const nowMs = input.now ?? (() => Date.now());
    const confirmationTtlMs = Number.isFinite(input.confirmationTtlMs) && Number(input.confirmationTtlMs) > 0
        ? Math.floor(Number(input.confirmationTtlMs))
        : DEFAULT_PIN_WRITE_CONFIRMATION_TTL_MS;
    const pendingPinWriteConfirmations = new Map();
    const pendingPermissionConfirmations = new Map();
    const pendingAppSessionStarts = new Map();
    const sessionPermissionGrants = new Map();
    const llmTimestamps = new Map();
    const llmInFlight = new Set();
    const grantedWriteTimestamps = new Map();
    const infrastructureConfigStore = (0, infrastructureConfigStore_1.createInfrastructureConfigStore)(input.systemHomeDir);
    async function resolveActor(actorInput) {
        return input.resolveActorWriteContext(actorSelector(actorInput));
    }
    async function resolveMetaAppBridgeActor(actorInput) {
        const actor = await resolveActor(actorInput);
        if ('failure' in actor) {
            const code = mapPinWriteFailureCode(browserFailureCode(actor.failure));
            return {
                failure: (0, agent_browser_host_contract_1.browserManualActionRequired)(code, safeBridgeMessage(browserFailureMessage(actor.failure), 'A selected MetaID Actor Bot is required.')),
            };
        }
        let profiles;
        try {
            profiles = await (0, metabotProfileManager_1.listMetabotProfiles)(input.systemHomeDir);
        }
        catch {
            return {
                failure: (0, agent_browser_host_contract_1.browserManualActionRequired)('actor_required', 'A selected MetaID Actor Bot is required.'),
            };
        }
        const selectedProfile = findProfileByHomeDir(profiles, actor.homeDir);
        const bridgeActor = selectedProfile ? profileToMetaAppBridgeActor(selectedProfile) : null;
        if (!selectedProfile || !bridgeActor) {
            return {
                failure: (0, agent_browser_host_contract_1.browserManualActionRequired)('actor_required', 'A selected MetaID Actor Bot with a Global MetaID is required.'),
            };
        }
        return { actor: bridgeActor, actorId: selectedProfile.slug };
    }
    function metaIdPinWriteConfirmation(inputForConfirmation) {
        const issuedAt = nowMs();
        for (const [id, pending] of pendingPinWriteConfirmations.entries()) {
            if (pending.expiresAt <= issuedAt) {
                pendingPinWriteConfirmations.delete(id);
            }
        }
        const confirmationId = `pin-write-${(0, node_crypto_1.randomUUID)()}`;
        const confirmationToken = (0, node_crypto_1.randomBytes)(32).toString('base64url');
        const expiresAt = issuedAt + confirmationTtlMs;
        const requestHash = pinWriteRequestHash({
            actorId: inputForConfirmation.actorId,
            actor: inputForConfirmation.actor,
            resourceUri: inputForConfirmation.actionInput.resourceUri,
            request: inputForConfirmation.validation.request,
        });
        pendingPinWriteConfirmations.set(confirmationId, {
            id: confirmationId,
            tokenHash: sha256Text(confirmationToken),
            actorId: inputForConfirmation.actorId,
            actorGlobalMetaId: inputForConfirmation.actor.globalMetaId,
            actorUri: inputForConfirmation.actor.uri,
            resourceUri: inputForConfirmation.actionInput.resourceUri,
            requestHash,
            expiresAt,
        });
        return (0, agent_browser_host_contract_1.browserManualActionRequired)('manual_action_required', 'Confirm this MetaID PIN write before OAC signs or broadcasts it.', {
            data: {
                confirmation: {
                    actor: inputForConfirmation.actor,
                    operation: inputForConfirmation.validation.request.operation,
                    path: inputForConfirmation.validation.request.path,
                    contentType: inputForConfirmation.validation.request.contentType,
                    payloadSize: inputForConfirmation.validation.payloadSize,
                    confirmationId,
                    expiresAt,
                    ...(inputForConfirmation.validation.display ? { display: inputForConfirmation.validation.display } : {}),
                },
                confirmRequest: {
                    resourceUri: inputForConfirmation.actionInput.resourceUri,
                    kind: 'metaid-pin-write',
                    payload: {
                        ...inputForConfirmation.validation.bridgePayload,
                        confirmed: true,
                        hostConfirmation: {
                            id: confirmationId,
                            token: confirmationToken,
                        },
                    },
                },
            },
        });
    }
    function consumeMetaIdPinWriteConfirmation(inputForConfirmation) {
        const hostConfirmation = inputForConfirmation.validation.hostConfirmation;
        if (!inputForConfirmation.validation.confirmed || !hostConfirmation) {
            return false;
        }
        const pending = pendingPinWriteConfirmations.get(hostConfirmation.id);
        if (!pending) {
            return false;
        }
        const currentTime = nowMs();
        if (pending.expiresAt <= currentTime) {
            pendingPinWriteConfirmations.delete(pending.id);
            return false;
        }
        const requestHash = pinWriteRequestHash({
            actorId: inputForConfirmation.actorId,
            actor: inputForConfirmation.actor,
            resourceUri: inputForConfirmation.actionInput.resourceUri,
            request: inputForConfirmation.validation.request,
        });
        const tokenHash = sha256Text(hostConfirmation.token);
        if (pending.actorId !== inputForConfirmation.actorId
            || pending.actorGlobalMetaId !== inputForConfirmation.actor.globalMetaId
            || pending.actorUri !== inputForConfirmation.actor.uri
            || pending.resourceUri !== inputForConfirmation.actionInput.resourceUri
            || pending.requestHash !== requestHash
            || !safeHashEqual(pending.tokenHash, tokenHash)) {
            return false;
        }
        pendingPinWriteConfirmations.delete(pending.id);
        return true;
    }
    async function runMetaIdPinWriteAction(actionInput) {
        const payload = readActionPayload(actionInput);
        const validation = validateMetaIdPinWritePayload(payload);
        if ('failure' in validation) {
            return validation.failure;
        }
        const actor = await resolveMetaAppBridgeActor(actionInput);
        if ('failure' in actor) {
            return actor.failure;
        }
        const sessionId = normalizeText(actionInput.sessionId);
        const requestedOperation = validation.request.operation;
        const grantKey = `${sessionId}\u0000${actionInput.resourceUri}\u0000${actor.actorId}\u0000${requestedOperation}\u0000${validation.request.path}`;
        const hasGrant = requestedOperation === 'create' && Boolean(sessionId) && (sessionPermissionGrants.get(sessionId) ?? []).some((grant) => `${grant.sessionId}\u0000${grant.resourceUri}\u0000${grant.actorId}\u0000${grant.operation}\u0000${grant.path}` === grantKey);
        if (hasGrant) {
            const resourceKey = normalizeText(actionInput.resourceUri);
            const activeWrites = (grantedWriteTimestamps.get(resourceKey) ?? []).filter((stamp) => nowMs() - stamp < 60_000);
            if (activeWrites.length >= GRANTED_WRITE_RATE_LIMIT_PER_MINUTE) {
                return (0, agent_browser_host_contract_1.browserFailure)('rate_limited', 'Too many granted writes in the last minute.');
            }
            if (validation.payloadSize > GRANTED_WRITE_MAX_PAYLOAD_BYTES) {
                return invalidBridgeParams('Granted write payload exceeds the 16KB limit.');
            }
            activeWrites.push(nowMs());
            grantedWriteTimestamps.set(resourceKey, activeWrites);
            void Promise.resolve(input.audit?.({
                type: 'granted_write',
                actorId: actor.actorId,
                resourceUri: actionInput.resourceUri,
                sessionId,
                path: validation.request.path,
            })).catch(() => { });
        }
        const confirmedByHost = hasGrant || consumeMetaIdPinWriteConfirmation({
            actionInput,
            actor: actor.actor,
            actorId: actor.actorId,
            validation,
        });
        if (!confirmedByHost) {
            return metaIdPinWriteConfirmation({
                actionInput,
                actor: actor.actor,
                actorId: actor.actorId,
                validation,
            });
        }
        if (!input.writeMetaIdPin) {
            return (0, agent_browser_host_contract_1.browserFailure)('unsupported_method', 'OAC Browser MetaID PIN write is not configured.');
        }
        const result = await input.writeMetaIdPin({
            actorId: actor.actorId,
            resourceUri: actionInput.resourceUri,
            request: validation.request,
        });
        if (!result.ok) {
            const code = mapPinWriteFailureCode(browserFailureCode(result));
            const message = safeBridgeMessage(browserFailureMessage(result), 'MetaID PIN write failed.');
            if (result.state === 'manual_action_required') {
                return (0, agent_browser_host_contract_1.browserManualActionRequired)(code, message);
            }
            if (result.state === 'waiting') {
                return (0, agent_browser_host_contract_1.browserWaiting)(code, message);
            }
            return (0, agent_browser_host_contract_1.browserFailure)(code === 'actor_required' ? code : 'pin_write_failed', message);
        }
        const data = sanitizePinWriteResultData({
            resultData: result.data,
            request: validation.request,
            actor: actor.actor,
        });
        if (!data) {
            return (0, agent_browser_host_contract_1.browserFailure)('pin_write_failed', 'MetaID PIN write did not return a pinId and txid.');
        }
        return (0, agent_browser_host_contract_1.browserSuccess)({
            kind: 'metaid-pin-write',
            handled: true,
            data: data,
        });
    }
    function sessionIdForAction(actionInput) {
        return normalizeText(actionInput.sessionId);
    }
    function isPermissionGrant(value) {
        return browserRecord(value).method === 'metaid.pin.write'
            && browserRecord(value).operation === 'create'
            && typeof browserRecord(value).path === 'string'
            && PROTOCOL_GRANT_PATH_PATTERN.test(String(browserRecord(value).path));
    }
    async function runLlmCompleteAction(actionInput) {
        const payload = readActionPayload(actionInput);
        const messages = payload.messages;
        if (!Array.isArray(messages) || messages.length === 0 || messages.some((message) => {
            const record = browserRecord(message);
            return !['system', 'user', 'assistant'].includes(String(record.role)) || typeof record.content !== 'string';
        })) {
            return invalidBridgeParams('browser.llm.complete requires non-empty text messages.');
        }
        const messageBytes = messages.reduce((total, message) => total + Buffer.byteLength(String(browserRecord(message).content), 'utf8'), 0);
        if (messageBytes > 64 * 1024)
            return invalidBridgeParams('browser.llm.complete messages exceed the 64KB limit.');
        if (hasOwn(payload, 'model') || hasOwn(payload, 'endpoint') || hasOwn(payload, 'provider') || hasOwn(payload, 'stream') || hasOwn(payload, 'tools') || hasOwn(payload, 'modalities')) {
            return invalidBridgeParams('The host selects the local LLM model and configuration.');
        }
        const resourceKey = normalizeText(actionInput.resourceUri);
        const active = (llmTimestamps.get(resourceKey) ?? []).filter((stamp) => nowMs() - stamp < 60_000);
        if (active.length >= LLM_COMPLETE_RATE_LIMIT_PER_MINUTE || llmInFlight.has(resourceKey)) {
            return (0, agent_browser_host_contract_1.browserFailure)('rate_limited', 'Local LLM rate limit reached; try again later.');
        }
        if (!input.llmComplete)
            return (0, agent_browser_host_contract_1.browserFailure)('llm_unavailable', 'No local LLM is configured for this host.');
        const options = browserRecord(payload.options);
        for (const key of Object.keys(options)) {
            if (!['temperature', 'maxOutputTokens', 'timeoutMs'].includes(key)) {
                return invalidBridgeParams('Only temperature, maxOutputTokens, and timeoutMs are supported.');
            }
        }
        if (hasOwn(options, 'temperature') && (typeof options.temperature !== 'number' || !Number.isFinite(options.temperature) || options.temperature < 0 || options.temperature > 2)) {
            return invalidBridgeParams('temperature must be a number between 0 and 2.');
        }
        if (hasOwn(options, 'maxOutputTokens') && (typeof options.maxOutputTokens !== 'number' || !Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens <= 0)) {
            return invalidBridgeParams('maxOutputTokens must be a positive integer.');
        }
        if (hasOwn(options, 'timeoutMs') && (typeof options.timeoutMs !== 'number' || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
            return invalidBridgeParams('timeoutMs must be a positive number.');
        }
        const requestedTimeout = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
            ? options.timeoutMs : LLM_COMPLETE_DEFAULT_TIMEOUT_MS;
        const timeoutMs = Math.min(requestedTimeout, LLM_COMPLETE_MAX_TIMEOUT_MS);
        llmInFlight.add(resourceKey);
        let timer;
        try {
            const result = await Promise.race([
                input.llmComplete({
                    actorId: actorSelector(actionInput) || undefined,
                    resourceUri: actionInput.resourceUri,
                    messages: messages,
                    ...(Object.keys(options).length ? { options } : {}),
                    ...(normalizeText(payload.purpose) ? { purpose: normalizeText(payload.purpose) } : {}),
                }),
                new Promise((_resolve, reject) => {
                    timer = setTimeout(() => reject(Object.assign(new Error('Local LLM completion timed out.'), { code: 'llm_timeout' })), timeoutMs);
                }),
            ]);
            active.push(nowMs());
            llmTimestamps.set(resourceKey, active);
            const data = { text: normalizeText(result.text) };
            if (normalizeText(result.model))
                data.model = normalizeText(result.model);
            if (result.finishReason)
                data.finishReason = result.finishReason;
            return (0, agent_browser_host_contract_1.browserSuccess)({ kind: 'llm-complete', handled: true, data: { ...data } });
        }
        catch (error) {
            const code = error instanceof Error && normalizeText(error.code);
            if (code === 'consent_denied' || code === 'invalid_params' || code === 'rate_limited' || code === 'llm_timeout' || code === 'llm_unavailable') {
                return (0, agent_browser_host_contract_1.browserFailure)(code, code === 'llm_timeout' ? 'Local LLM completion timed out.' : 'Local LLM completion failed.');
            }
            return (0, agent_browser_host_contract_1.browserFailure)('llm_unavailable', 'Local LLM completion failed.');
        }
        finally {
            if (timer)
                clearTimeout(timer);
            llmInFlight.delete(resourceKey);
        }
    }
    async function runPermissionsRequestAction(actionInput) {
        const payload = readActionPayload(actionInput);
        const sessionId = sessionIdForAction(actionInput);
        const resourceUri = normalizeText(actionInput.resourceUri);
        if (!sessionId || !resourceUri)
            return (0, agent_browser_host_contract_1.browserFailure)('consent_denied', 'A page session and resource are required.');
        if (payload.revoke === true) {
            sessionPermissionGrants.delete(sessionId);
            const actorId = actorSelector(actionInput) || '';
            void Promise.resolve(input.audit?.({ type: 'permission_revoked', actorId, resourceUri, sessionId })).catch(() => { });
            return (0, agent_browser_host_contract_1.browserSuccess)({ kind: 'permissions-request', handled: true, data: { revoked: true } });
        }
        const actor = await resolveMetaAppBridgeActor(actionInput);
        if ('failure' in actor)
            return actor.failure;
        const actorId = actor.actorId;
        const rawGrants = Array.isArray(payload.grants) ? payload.grants : [];
        const grants = rawGrants.filter(isPermissionGrant);
        if (!rawGrants.length || grants.length !== rawGrants.length)
            return invalidBridgeParams('Only create metaid.pin.write grants on exact protocol paths are supported.');
        for (const grant of grants) {
            if (!PROTOCOL_GRANT_WHITELIST.has(grant.path))
                return (0, agent_browser_host_contract_1.browserFailure)('consent_denied', `Protocol path is not allowed: ${grant.path}`);
        }
        const hostConfirmation = browserRecord(payload.hostConfirmation);
        if (payload.confirmed === true && normalizeText(hostConfirmation.id) && normalizeText(hostConfirmation.token)) {
            const id = normalizeText(hostConfirmation.id);
            const pending = pendingPermissionConfirmations.get(id);
            const requestedReason = normalizeText(payload.reason);
            const grantsMatch = pending?.grants.length === grants.length
                && pending.grants.every((grant, index) => grant.method === grants[index].method && grant.operation === grants[index].operation && grant.path === grants[index].path);
            if (!pending || pending.expiresAt <= nowMs() || pending.sessionId !== sessionId || pending.resourceUri !== resourceUri || pending.actorId !== actorId || pending.reason !== (requestedReason || undefined) || !grantsMatch || !safeHashEqual(pending.tokenHash, sha256Text(normalizeText(hostConfirmation.token)))) {
                return (0, agent_browser_host_contract_1.browserFailure)('consent_denied', 'The permission confirmation is invalid or expired.');
            }
            pendingPermissionConfirmations.delete(id);
            sessionPermissionGrants.set(sessionId, pending.grants.map((grant) => ({ ...grant, sessionId, resourceUri, actorId })));
            void Promise.resolve(input.audit?.({ type: 'permission_granted', actorId, resourceUri, sessionId, paths: pending.grants.map((grant) => grant.path) })).catch(() => { });
            return (0, agent_browser_host_contract_1.browserSuccess)({ kind: 'permissions-request', handled: true, data: { granted: pending.grants, expiresAt: pending.expiresAt } });
        }
        const id = `permission-${(0, node_crypto_1.randomUUID)()}`;
        const token = (0, node_crypto_1.randomBytes)(32).toString('base64url');
        const reason = normalizeText(payload.reason);
        pendingPermissionConfirmations.set(id, { tokenHash: sha256Text(token), actorId, resourceUri, sessionId, grants, ...(reason ? { reason } : {}), expiresAt: nowMs() + PERMISSION_CONFIRMATION_TTL_MS });
        return (0, agent_browser_host_contract_1.browserManualActionRequired)('manual_action_required', 'Confirm protocol write permissions for this MetaApp.', {
            data: {
                confirmation: { actor: actor.actor, grants, ...(reason ? { reason } : {}) },
                confirmRequest: { resourceUri, kind: 'permissions-request', payload: { grants, ...(reason ? { reason } : {}), confirmed: true, hostConfirmation: { id, token } } },
            },
        });
    }
    async function runMetaFileUploadAction(actionInput) {
        const payload = readActionPayload(actionInput);
        const validation = validateMetaFileUploadPayload(payload);
        if ('failure' in validation) {
            return validation.failure;
        }
        const actor = await resolveMetaAppBridgeActor(actionInput);
        if ('failure' in actor) {
            return actor.failure;
        }
        if (!input.uploadMetaFile) {
            return (0, agent_browser_host_contract_1.browserFailure)('unsupported_method', 'OAC Browser MetaFile upload is not configured.');
        }
        const result = await input.uploadMetaFile({
            actorId: actor.actorId,
            resourceUri: actionInput.resourceUri,
            request: validation,
        });
        if (!result.ok) {
            const code = browserFailureCode(result) === 'actor_required' ? 'actor_required' : 'upload_failed';
            const message = safeBridgeMessage(browserFailureMessage(result), 'MetaFile upload failed.');
            if (result.state === 'manual_action_required') {
                return (0, agent_browser_host_contract_1.browserManualActionRequired)(code, message);
            }
            if (result.state === 'waiting') {
                return (0, agent_browser_host_contract_1.browserWaiting)(code, message);
            }
            return (0, agent_browser_host_contract_1.browserFailure)(code, message);
        }
        const files = sanitizeMetaFileUploadResultFiles({ resultData: result.data, actor: actor.actor });
        if (!files.length) {
            return (0, agent_browser_host_contract_1.browserFailure)('upload_failed', 'MetaFile upload did not return any files.');
        }
        return (0, agent_browser_host_contract_1.browserSuccess)({
            kind: 'metafile-upload',
            handled: true,
            data: { files },
        });
    }
    async function getRuntime(runtimeInput = {}) {
        const requestedActor = actorSelector(runtimeInput);
        const activeHomeDir = node_path_1.default.resolve(input.homeDir);
        const profiles = await (0, metabotProfileManager_1.listMetabotProfiles)(input.systemHomeDir).catch(() => []);
        const selectedProfile = requestedActor
            ? profiles.find((profile) => profile.slug === requestedActor) ?? null
            : profiles.find((profile) => node_path_1.default.resolve(profile.homeDir) === activeHomeDir) ?? profiles[0] ?? null;
        if (requestedActor && !selectedProfile) {
            return (0, agent_browser_host_contract_1.browserFailure)('profile_not_found', `MetaBot profile not found: ${requestedActor}`);
        }
        const selectedHomeDir = selectedProfile ? node_path_1.default.resolve(selectedProfile.homeDir) : '';
        const actors = profiles.map((profile) => profileToBrowserActor(profile, selectedHomeDir));
        const defaultActor = selectedProfile
            ? actors.find((actor) => actor.id === selectedProfile.slug) ?? null
            : null;
        return (0, agent_browser_host_contract_1.browserSuccess)({
            host: {
                kind: 'oac',
                name: 'Open Agent Connect',
                localMode: true,
            },
            actors,
            defaultActor,
            // Do not preset a defaultUri: opening /browser should land on the welcome
            // page (matching the ABC standalone host), not auto-navigate into the
            // selected identity's own homepage. defaultActor is still returned so the
            // UI can highlight the active "Using" chip.
            defaultUri: null,
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
            return toBrowserResult(actor.failure);
        const targetConfigStore = (0, configStore_1.createConfigStore)(actor.homeDir);
        const [profileConfig, infrastructure] = await Promise.all([
            targetConfigStore.read(),
            infrastructureConfigStore.read(),
        ]);
        const config = withInfrastructureConfig(profileConfig, infrastructure);
        return (0, agent_browser_host_contract_1.browserSuccess)(toHostBrowserSettingsSnapshot((0, agent_browser_core_1.createBrowserSettingsSnapshot)({
            config,
            configPath: infrastructureConfigStore.paths.infrastructureConfigPath,
            env,
        })));
    }
    async function updateSettings(settingsInput) {
        const actor = await resolveActor(settingsInput);
        if ('failure' in actor)
            return toBrowserResult(actor.failure);
        const targetConfigStore = (0, configStore_1.createConfigStore)(actor.homeDir);
        const [currentProfileConfig, currentInfrastructure] = await Promise.all([
            targetConfigStore.read(),
            infrastructureConfigStore.read(),
        ]);
        const current = withInfrastructureConfig(currentProfileConfig, currentInfrastructure);
        try {
            const next = (0, agent_browser_core_1.applyBrowserSettingsUpdate)(current, settingsInput.browser);
            const split = splitBrowserSettingsConfig(next);
            await infrastructureConfigStore.set(split.infrastructure);
            await targetConfigStore.set(split.profileConfig);
            const [savedProfileConfig, savedInfrastructure] = await Promise.all([
                targetConfigStore.read(),
                infrastructureConfigStore.read(),
            ]);
            const saved = withInfrastructureConfig(savedProfileConfig, savedInfrastructure);
            if (savedInfrastructure.metasoP2PBaseUrl !== currentInfrastructure.metasoP2PBaseUrl) {
                try {
                    await input.onInfrastructureSettingsUpdated?.();
                }
                catch {
                    // The saved configuration remains authoritative and will be used on the next reconnect.
                }
            }
            return (0, agent_browser_host_contract_1.browserSuccess)(toHostBrowserSettingsSnapshot((0, agent_browser_core_1.createBrowserSettingsSnapshot)({
                config: saved,
                configPath: infrastructureConfigStore.paths.infrastructureConfigPath,
                env,
            })));
        }
        catch (error) {
            return (0, agent_browser_host_contract_1.browserFailure)('invalid_argument', error instanceof Error ? error.message : String(error));
        }
    }
    async function getCache(cacheInput = {}) {
        const actor = await resolveActor(cacheInput);
        if ('failure' in actor)
            return toBrowserResult(actor.failure);
        const stats = await (0, artifactCache_1.createMetaAppArtifactCacheStore)(actor.homeDir).getStats();
        return (0, agent_browser_host_contract_1.browserSuccess)(toBrowserRecord(stats));
    }
    async function clearCache(cacheInput) {
        const actor = await resolveActor(cacheInput);
        if ('failure' in actor)
            return toBrowserResult(actor.failure);
        try {
            const scope = normalizeText(cacheInput.scope) || 'all';
            if (scope === 'pin') {
                const result = await (0, artifactCache_1.createMetaAppArtifactCacheStore)(actor.homeDir).clear({
                    scope,
                    pinId: normalizeText(cacheInput.pinId),
                });
                return (0, agent_browser_host_contract_1.browserSuccess)(toBrowserRecord(result));
            }
            if (scope === 'artifact') {
                const result = await (0, artifactCache_1.createMetaAppArtifactCacheStore)(actor.homeDir).clear({
                    scope,
                    cacheKey: normalizeText(cacheInput.cacheKey),
                });
                return (0, agent_browser_host_contract_1.browserSuccess)(toBrowserRecord(result));
            }
            if (scope === 'all') {
                const result = await (0, artifactCache_1.createMetaAppArtifactCacheStore)(actor.homeDir).clear({ scope });
                return (0, agent_browser_host_contract_1.browserSuccess)(toBrowserRecord(result));
            }
            return (0, agent_browser_host_contract_1.browserFailure)('invalid_argument', 'Unsupported Browser cache clear scope.');
        }
        catch (error) {
            return (0, agent_browser_host_contract_1.browserFailure)('invalid_argument', error instanceof Error ? error.message : String(error));
        }
    }
    // preview-metaapp://localhost: resolve a live local file or directory into a
    // MetaApp preview session rooted at that path. Mirrors the ABC standalone
    // host's resolveLocalPreviewPath. The daemon preview-assets route reads files
    // from disk on every request, so reloads pick up edits; the session registry
    // confines serving to the session root. Local-dev only, 127.0.0.1 binding;
    // METABOT_BROWSER_DISABLE_PREVIEW_METAAPP=1 disables the whole scheme.
    const resolveLocalPreviewPath = async ({ path: localPath }) => {
        let stats;
        try {
            stats = await node_fs_1.promises.stat(localPath);
        }
        catch (error) {
            const code = error?.code;
            if (code === 'ENOENT') {
                throw new Error(`Local path not found: ${localPath}`);
            }
            if (code === 'EACCES') {
                throw new Error(`Permission denied: ${localPath}`);
            }
            throw error;
        }
        let artifactDir;
        let indexFile;
        if (stats.isDirectory()) {
            const candidates = ['index.html', 'index.htm'];
            const found = await Promise.all(candidates.map(async (name) => {
                try {
                    await node_fs_1.promises.access(node_path_1.default.join(localPath, name));
                    return name;
                }
                catch {
                    return null;
                }
            }));
            indexFile = found.find((name) => name !== null) ?? '';
            if (!indexFile) {
                throw new Error(`No index.html found in directory: ${localPath}`);
            }
            artifactDir = localPath;
        }
        else {
            artifactDir = node_path_1.default.dirname(localPath);
            indexFile = node_path_1.default.basename(localPath);
        }
        const session = input.metaAppPreviewSessions.create({ artifactDir, indexFile });
        return {
            localPreviewUrl: buildMetaAppPreviewAssetUrl(session.previewId, indexFile),
            previewId: session.previewId,
            contentType: previewMetaAppContentType(indexFile),
        };
    };
    async function resolveResource(resolveInput) {
        const actor = await resolveActor(resolveInput);
        if ('failure' in actor)
            return toBrowserResult(actor.failure);
        const [profileConfig, infrastructure] = await Promise.all([
            (0, configStore_1.createConfigStore)(actor.homeDir).read(),
            infrastructureConfigStore.read(),
        ]);
        const config = withInfrastructureConfig(profileConfig, infrastructure);
        const { browserConfig, nameAliasProviders, } = resolveBrowserHostConfig({
            config,
            env,
            configuredNameAliasProviders: input.nameAliasProviders,
            ensNameAliasProviderFactory: input.ensNameAliasProviderFactory,
        });
        const artifactCache = (0, artifactCache_1.createMetaAppArtifactCacheStore)(actor.homeDir);
        return (0, agent_browser_core_1.resolveBrowserResource)({
            uri: resolveInput.uri,
            config: browserConfig,
            fetch: fetchImpl,
            nameAliasProviders,
            previewMetaAppLocalResolve: resolveLocalPreviewPath,
            metaAppResolve: async (pinId) => {
                return (0, agent_browser_core_1.resolveMetaAppPinToRecord)({
                    pinId,
                    fetch: fetchImpl,
                    manApiBaseUrl: browserConfig.manApiBaseUrl,
                    metafileContentBaseUrl: browserConfig.metafileContentBaseUrl,
                    createPreviewSession: async ({ contentReference, contentType, indexFile, pinRecord }) => ({
                        localPreviewUrl: await resolveMetaAppPreviewUrl({
                            pinId,
                            contentReference,
                            contentType,
                            indexFile,
                            pinRecord,
                            artifactCache,
                            metaAppPreviewSessions: input.metaAppPreviewSessions,
                            fetchImpl,
                        }),
                    }),
                });
            },
        });
    }
    function mapAppSessionRuntimeError(error) {
        const code = normalizeText(error?.code) || 'internal_error';
        const message = normalizeText(error?.message) || 'OAC App Session runtime failed.';
        return (0, agent_browser_host_contract_1.browserFailure)(code, message);
    }
    function appSessionActorBinding(actionInput, actor) {
        return {
            resourceUri: normalizeText(actionInput.resourceUri),
            actorId: actor.actorId,
            actorGlobalMetaId: actor.actor.globalMetaId,
        };
    }
    function validateAppSessionStartPayload(payload) {
        const requiredFields = [
            ['appId', payload.appId],
            ['sessionType', payload.sessionType],
            ['groupId', payload.groupId],
            ['gameId', payload.gameId],
            ['manifestUri', payload.manifestUri],
            ['rulesHash', payload.rulesHash],
            ['seat', payload.seat],
            ['agentId', payload.agentId],
        ];
        const params = {};
        for (const [fieldName, rawValue] of requiredFields) {
            const value = normalizeText(rawValue);
            if (!value) {
                return { ok: false, failure: invalidBridgeParams(`browser.app.session.start ${fieldName} is required.`) };
            }
            params[fieldName] = value;
        }
        if (normalizeText(payload.sessionType) !== 'agent-game') {
            return { ok: false, failure: invalidBridgeParams('browser.app.session.start sessionType must be "agent-game".') };
        }
        if (payload.ttlMs !== undefined
            && (!Number.isInteger(payload.ttlMs) || Number(payload.ttlMs) <= 0)) {
            return { ok: false, failure: invalidBridgeParams('browser.app.session.start ttlMs must be a positive integer.') };
        }
        const budget = browserRecord(payload.budget);
        for (const key of Object.keys(budget)) {
            if (key !== 'llmCalls' && key !== 'writes') {
                return { ok: false, failure: invalidBridgeParams('browser.app.session.start budget only supports llmCalls and writes.') };
            }
            const value = budget[key];
            if (value !== undefined && (!Number.isInteger(value) || Number(value) <= 0)) {
                return { ok: false, failure: invalidBridgeParams(`browser.app.session.start budget.${key} must be a positive integer.`) };
            }
        }
        const paramsResult = params;
        if (payload.ttlMs !== undefined) {
            paramsResult.ttlMs = Number(payload.ttlMs);
        }
        if (Object.keys(budget).length) {
            paramsResult.budget = {
                ...(Number.isInteger(budget.llmCalls) ? { llmCalls: Number(budget.llmCalls) } : {}),
                ...(Number.isInteger(budget.writes) ? { writes: Number(budget.writes) } : {}),
            };
        }
        return { ok: true, params: paramsResult };
    }
    async function runAppSessionStartAction(actionInput) {
        if (!input.appSession) {
            return (0, agent_browser_host_contract_1.browserFailure)('unsupported_method', 'OAC App Session runtime is not configured.');
        }
        const payload = readActionPayload(actionInput);
        const validation = validateAppSessionStartPayload(payload);
        if (!validation.ok) {
            return validation.failure;
        }
        const actor = await resolveMetaAppBridgeActor(actionInput);
        if ('failure' in actor) {
            return actor.failure;
        }
        if (validation.params.agentId !== actor.actor.globalMetaId) {
            return invalidBridgeParams('browser.app.session.start agentId must match the current actor globalMetaId.');
        }
        const resourceUri = normalizeText(actionInput.resourceUri);
        if (!resourceUri) {
            return invalidBridgeParams('browser.app.session.start requires a resourceUri.');
        }
        const binding = appSessionActorBinding(actionInput, actor);
        const hostConfirmation = browserRecord(payload.hostConfirmation);
        if (payload.confirmed === true && normalizeText(hostConfirmation.id)) {
            const id = normalizeText(hostConfirmation.id);
            const token = normalizeText(hostConfirmation.token);
            const pending = pendingAppSessionStarts.get(id);
            const paramsMatch = pending
                && sameAppSessionStartParams(pending.params, validation.params);
            if (!pending
                || pending.expiresAt <= nowMs()
                || pending.actorId !== actor.actorId
                || pending.actorGlobalMetaId !== actor.actor.globalMetaId
                || pending.resourceUri !== resourceUri
                || !paramsMatch
                || !safeHashEqual(pending.tokenHash, sha256Text(token))) {
                return (0, agent_browser_host_contract_1.browserFailure)('consent_denied', 'The app session confirmation is invalid or expired.');
            }
            pendingAppSessionStarts.delete(id);
            try {
                const session = await input.appSession.start({
                    ...validation.params,
                    ...binding,
                });
                void Promise.resolve(input.audit?.({
                    type: 'app_session_consent_confirmed',
                    actorId: actor.actorId,
                    resourceUri,
                    sessionId: session.sessionId,
                    groupId: session.groupId,
                    gameId: session.gameId,
                })).catch(() => undefined);
                return (0, agent_browser_host_contract_1.browserSuccess)({
                    kind: 'app-session-start',
                    handled: true,
                    data: { session },
                });
            }
            catch (error) {
                return mapAppSessionRuntimeError(error);
            }
        }
        // First phase: docs/09 validation steps 1-7, then the task authorization card.
        const preflight = await input.appSession.validateStart({
            ...validation.params,
            ...binding,
        });
        if (!preflight.ok) {
            return mapAppSessionRuntimeError(preflight.error);
        }
        const issuedAt = nowMs();
        for (const [id, pending] of pendingAppSessionStarts.entries()) {
            if (pending.expiresAt <= issuedAt) {
                pendingAppSessionStarts.delete(id);
            }
        }
        const id = `app-session-${(0, node_crypto_1.randomUUID)()}`;
        const token = (0, node_crypto_1.randomBytes)(32).toString('base64url');
        const requestHash = sha256Text(JSON.stringify({
            actorId: actor.actorId,
            actorGlobalMetaId: actor.actor.globalMetaId,
            resourceUri,
            params: validation.params,
        }));
        pendingAppSessionStarts.set(id, {
            id,
            tokenHash: sha256Text(token),
            actorId: actor.actorId,
            actorGlobalMetaId: actor.actor.globalMetaId,
            resourceUri,
            params: validation.params,
            requestHash,
            adapterHash: preflight.adapterHash,
            expiresAt: issuedAt + confirmationTtlMs,
        });
        void Promise.resolve(input.audit?.({
            type: 'app_session_consent_requested',
            actorId: actor.actorId,
            resourceUri,
            groupId: validation.params.groupId,
            gameId: validation.params.gameId,
            seat: validation.params.seat,
            requestHash,
        })).catch(() => undefined);
        return (0, agent_browser_host_contract_1.browserManualActionRequired)('manual_action_required', 'Confirm this agent-game session before OAC starts it.', {
            data: {
                confirmation: {
                    actor: actor.actor,
                    appId: validation.params.appId,
                    sessionType: validation.params.sessionType,
                    groupId: validation.params.groupId,
                    gameId: validation.params.gameId,
                    manifestUri: validation.params.manifestUri,
                    rulesHash: validation.params.rulesHash,
                    adapterHash: preflight.adapterHash,
                    seat: validation.params.seat,
                    agentId: validation.params.agentId,
                    protocolPaths: [...types_1.DEFAULT_AGENT_GAME_PROTOCOL_PATHS],
                    ttlMs: validation.params.ttlMs ?? 86_400_000,
                    budget: {
                        llmCalls: validation.params.budget?.llmCalls ?? 500,
                        writes: validation.params.budget?.writes ?? 500,
                    },
                },
                confirmRequest: {
                    resourceUri,
                    kind: 'app-session-start',
                    payload: {
                        ...validation.params,
                        confirmed: true,
                        hostConfirmation: { id, token },
                    },
                },
            },
        });
    }
    async function runAppSessionListAction(actionInput) {
        if (!input.appSession) {
            return (0, agent_browser_host_contract_1.browserFailure)('unsupported_method', 'OAC App Session runtime is not configured.');
        }
        const actor = await resolveMetaAppBridgeActor(actionInput);
        if ('failure' in actor) {
            return actor.failure;
        }
        const binding = appSessionActorBinding(actionInput, actor);
        if (!binding.resourceUri) {
            return invalidBridgeParams('browser.app.session.list requires a resourceUri.');
        }
        const payload = readActionPayload(actionInput);
        try {
            const sessions = await input.appSession.list({
                ...binding,
                ...(normalizeText(payload.appId) ? { appId: normalizeText(payload.appId) } : {}),
                ...(normalizeText(payload.status) ? { status: normalizeText(payload.status) } : {}),
                ...(normalizeText(payload.groupId) ? { groupId: normalizeText(payload.groupId) } : {}),
            });
            return (0, agent_browser_host_contract_1.browserSuccess)({
                kind: 'app-session-list',
                handled: true,
                data: { sessions },
            });
        }
        catch (error) {
            return mapAppSessionRuntimeError(error);
        }
    }
    async function runAppSessionStatusAction(actionInput) {
        if (!input.appSession) {
            return (0, agent_browser_host_contract_1.browserFailure)('unsupported_method', 'OAC App Session runtime is not configured.');
        }
        const actor = await resolveMetaAppBridgeActor(actionInput);
        if ('failure' in actor) {
            return actor.failure;
        }
        const payload = readActionPayload(actionInput);
        const sessionId = normalizeText(payload.sessionId);
        if (!sessionId) {
            return invalidBridgeParams('browser.app.session.status sessionId is required.');
        }
        try {
            const session = await input.appSession.status(sessionId, appSessionActorBinding(actionInput, actor));
            return (0, agent_browser_host_contract_1.browserSuccess)({
                kind: 'app-session-status',
                handled: true,
                data: { session },
            });
        }
        catch (error) {
            return mapAppSessionRuntimeError(error);
        }
    }
    async function runAppSessionPauseAction(actionInput) {
        if (!input.appSession) {
            return (0, agent_browser_host_contract_1.browserFailure)('unsupported_method', 'OAC App Session runtime is not configured.');
        }
        const actor = await resolveMetaAppBridgeActor(actionInput);
        if ('failure' in actor) {
            return actor.failure;
        }
        const payload = readActionPayload(actionInput);
        const sessionId = normalizeText(payload.sessionId);
        if (!sessionId) {
            return invalidBridgeParams('browser.app.session.pause sessionId is required.');
        }
        try {
            const session = await input.appSession.pause(sessionId, appSessionActorBinding(actionInput, actor));
            return (0, agent_browser_host_contract_1.browserSuccess)({
                kind: 'app-session-pause',
                handled: true,
                data: { session },
            });
        }
        catch (error) {
            return mapAppSessionRuntimeError(error);
        }
    }
    async function runAppSessionResumeAction(actionInput) {
        if (!input.appSession) {
            return (0, agent_browser_host_contract_1.browserFailure)('unsupported_method', 'OAC App Session runtime is not configured.');
        }
        const actor = await resolveMetaAppBridgeActor(actionInput);
        if ('failure' in actor) {
            return actor.failure;
        }
        const payload = readActionPayload(actionInput);
        const sessionId = normalizeText(payload.sessionId);
        if (!sessionId) {
            return invalidBridgeParams('browser.app.session.resume sessionId is required.');
        }
        try {
            const session = await input.appSession.resume(sessionId, appSessionActorBinding(actionInput, actor));
            return (0, agent_browser_host_contract_1.browserSuccess)({
                kind: 'app-session-resume',
                handled: true,
                data: { session },
            });
        }
        catch (error) {
            return mapAppSessionRuntimeError(error);
        }
    }
    async function runAppSessionStopAction(actionInput) {
        if (!input.appSession) {
            return (0, agent_browser_host_contract_1.browserFailure)('unsupported_method', 'OAC App Session runtime is not configured.');
        }
        const actor = await resolveMetaAppBridgeActor(actionInput);
        if ('failure' in actor) {
            return actor.failure;
        }
        const payload = readActionPayload(actionInput);
        const sessionId = normalizeText(payload.sessionId);
        if (!sessionId) {
            return invalidBridgeParams('browser.app.session.stop sessionId is required.');
        }
        try {
            const session = await input.appSession.stop(sessionId, appSessionActorBinding(actionInput, actor), { releaseSeat: payload.releaseSeat === true });
            return (0, agent_browser_host_contract_1.browserSuccess)({
                kind: 'app-session-stop',
                handled: true,
                data: { session },
            });
        }
        catch (error) {
            return mapAppSessionRuntimeError(error);
        }
    }
    async function runTrustedAction(actionInput) {
        if (actionInput.kind === 'copy-uri') {
            return copyUriTrustedActionResult(actionInput);
        }
        if (actionInput.kind === 'metafile-upload') {
            return runMetaFileUploadAction(actionInput);
        }
        if (actionInput.kind === 'metaid-pin-write') {
            return runMetaIdPinWriteAction(actionInput);
        }
        if (actionInput.kind === 'llm-complete') {
            return runLlmCompleteAction(actionInput);
        }
        if (actionInput.kind === 'permissions-request') {
            return runPermissionsRequestAction(actionInput);
        }
        if (actionInput.kind === 'app-session-start') {
            return runAppSessionStartAction(actionInput);
        }
        if (actionInput.kind === 'app-session-list') {
            return runAppSessionListAction(actionInput);
        }
        if (actionInput.kind === 'app-session-status') {
            return runAppSessionStatusAction(actionInput);
        }
        if (actionInput.kind === 'app-session-pause') {
            return runAppSessionPauseAction(actionInput);
        }
        if (actionInput.kind === 'app-session-resume') {
            return runAppSessionResumeAction(actionInput);
        }
        if (actionInput.kind === 'app-session-stop') {
            return runAppSessionStopAction(actionInput);
        }
        const actor = await resolveActor(actionInput);
        if ('failure' in actor)
            return toBrowserResult(actor.failure);
        const from = actorSelector(actionInput);
        const payload = readActionPayload(actionInput);
        if (actionInput.kind === 'private-chat') {
            const to = normalizeText(payload.to) || normalizeText(payload.targetGlobalMetaId);
            const content = normalizeText(payload.content) || normalizeText(payload.message);
            if (!to || !content) {
                return (0, agent_browser_host_contract_1.browserFailure)('invalid_browser_action', 'Browser private-chat action requires to and content.');
            }
            if (!input.privateChat) {
                return (0, agent_browser_host_contract_1.browserFailure)('browser_action_not_supported', 'Browser private-chat action is not supported by the OAC adapter.');
            }
            const result = await input.privateChat({
                ...(from ? { from } : {}),
                to,
                content,
                ...(normalizeText(payload.replyPin) ? { replyPin: normalizeText(payload.replyPin) } : {}),
                ...(normalizeText(payload.peerChatPublicKey) ? { peerChatPublicKey: normalizeText(payload.peerChatPublicKey) } : {}),
                ...(normalizeText(payload.network) ? { network: normalizeText(payload.network) } : {}),
            });
            return toBrowserTrustedActionResult(actionInput.kind, result);
        }
        if (actionInput.kind === 'service-call') {
            const servicePinId = normalizeText(payload.servicePinId);
            const providerGlobalMetaId = normalizeText(payload.providerGlobalMetaId);
            const userTask = normalizeText(payload.userTask) || normalizeText(payload.rawRequest);
            if (!servicePinId || !providerGlobalMetaId || !userTask) {
                return (0, agent_browser_host_contract_1.browserFailure)('invalid_browser_action', 'Browser service-call action requires servicePinId, providerGlobalMetaId, and userTask.');
            }
            if (!input.serviceCall) {
                return (0, agent_browser_host_contract_1.browserFailure)('browser_action_not_supported', 'Browser service-call action is not supported by the OAC adapter.');
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
            return toBrowserTrustedActionResult(actionInput.kind, result);
        }
        if (actionInput.kind === 'open-conversation') {
            const openPayload = payload;
            const peerGlobalMetaId = normalizeText(openPayload.peerGlobalMetaId);
            if (!peerGlobalMetaId) {
                return (0, agent_browser_host_contract_1.browserFailure)('invalid_browser_action', 'Browser open-conversation action requires peerGlobalMetaId.');
            }
            let profiles;
            try {
                profiles = await (0, metabotProfileManager_1.listMetabotProfiles)(input.systemHomeDir);
            }
            catch (error) {
                return (0, agent_browser_host_contract_1.browserFailure)('browser_profile_list_failed', error instanceof Error ? error.message : 'Browser open-conversation action could not list MetaBot profiles.');
            }
            const selectedProfile = findProfileByHomeDir(profiles, actor.homeDir);
            const localGlobalMetaId = normalizeText(selectedProfile?.globalMetaId);
            if (!selectedProfile || !localGlobalMetaId) {
                return (0, agent_browser_host_contract_1.browserManualActionRequired)('browser_identity_required', 'Open conversation requires a selected local Bot with a Global MetaID.');
            }
            return successTrustedActionResult('open-conversation', {
                href: conversationHref(localGlobalMetaId, peerGlobalMetaId),
            });
        }
        if (actionInput.kind === 'edit-profile' ||
            actionInput.kind === 'configure-chat' ||
            actionInput.kind === 'view-messages') {
            const ownerActorId = ownerActorIdFromPayload(payload);
            if (!ownerActorId) {
                return (0, agent_browser_host_contract_1.browserFailure)('invalid_browser_action', 'Browser owner action requires ownerActorId.');
            }
            let profiles;
            try {
                profiles = await (0, metabotProfileManager_1.listMetabotProfiles)(input.systemHomeDir);
            }
            catch (error) {
                return (0, agent_browser_host_contract_1.browserFailure)('browser_profile_list_failed', error instanceof Error ? error.message : 'Browser owner action could not list MetaBot profiles.');
            }
            const ownerProfile = profiles.find((profile) => profile.slug === ownerActorId) ?? null;
            if (!ownerProfile) {
                return (0, agent_browser_host_contract_1.browserFailure)('profile_not_found', `MetaBot profile not found: ${ownerActorId}`);
            }
            const href = actionInput.kind === 'edit-profile'
                ? botManagementHref(ownerProfile.slug, 'info', 'profile')
                : actionInput.kind === 'configure-chat'
                    ? botManagementHref(ownerProfile.slug, 'info', 'chat')
                    : botManagementHref(ownerProfile.slug, 'history', 'messages');
            return successTrustedActionResult(actionInput.kind, { href });
        }
        return (0, agent_browser_host_contract_1.browserFailure)('browser_action_not_supported', `Browser trusted action is not supported by the OAC adapter yet: ${actionInput.kind}`);
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
