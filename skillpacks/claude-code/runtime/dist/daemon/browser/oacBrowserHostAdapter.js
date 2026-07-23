"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOacBrowserHostAdapter = createOacBrowserHostAdapter;
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const metabotProfileManager_1 = require("../../core/bot/metabotProfileManager");
const conversationUrl_1 = require("../../core/a2a/conversationUrl");
const agent_browser_core_1 = require("@openagentinternet/agent-browser-core");
const agent_browser_name_resolvers_1 = require("@openagentinternet/agent-browser-name-resolvers");
const agent_browser_host_contract_1 = require("@openagentinternet/agent-browser-host-contract");
const configStore_1 = require("../../core/config/configStore");
const metafileUrls_1 = require("../../core/files/metafileUrls");
const llmTypes_1 = require("../../core/llm/llmTypes");
const artifactCache_1 = require("../../core/metaapp/artifactCache");
const DEFAULT_PIN_WRITE_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
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
function isZipMetaAppContent(contentType, contentReference) {
    const normalizedContentType = normalizeText(contentType).toLowerCase();
    const normalizedReference = normalizeText(contentReference).toLowerCase().split(/[?#]/u, 1)[0] ?? '';
    return normalizedContentType === 'application/zip'
        || normalizedContentType.includes('/zip')
        || normalizedContentType.includes('+zip')
        || normalizedReference.endsWith('.zip');
}
function extractMetafilePinId(contentReference) {
    if (!/^metafile:\/\//iu.test(contentReference)) {
        return '';
    }
    const withoutScheme = contentReference.slice('metafile://'.length).split(/[?#]/u, 1)[0] ?? '';
    if (!withoutScheme || withoutScheme.includes('/') || withoutScheme.includes('\\')) {
        return '';
    }
    return withoutScheme.replace(/\.[A-Za-z0-9]+$/u, '');
}
function metaAppArchiveUrls(contentReference) {
    const normalizedReference = normalizeText(contentReference);
    if (!normalizedReference) {
        return [];
    }
    const metafilePinId = extractMetafilePinId(normalizedReference);
    if (metafilePinId) {
        const urls = (0, metafileUrls_1.buildMetafileContentUrls)(metafilePinId);
        return [urls.accelerateUrl, urls.contentUrl, urls.legacyContentUrl];
    }
    return /^https?:\/\//iu.test(normalizedReference) ? [normalizedReference] : [];
}
async function downloadMetaAppArchive(fetchImpl, contentReference) {
    for (const url of metaAppArchiveUrls(contentReference)) {
        const response = await fetchImpl(url).catch(() => null);
        if (!response?.ok || typeof response.arrayBuffer !== 'function') {
            continue;
        }
        const archive = Buffer.from(await response.arrayBuffer());
        if (archive.byteLength > 0) {
            return archive;
        }
    }
    return null;
}
async function resolveMetaAppPreviewUrl(input) {
    if (!isZipMetaAppContent(input.contentType, input.contentReference)) {
        return '';
    }
    const modifyHistory = (0, artifactCache_1.normalizeMetaAppModifyHistory)(input.pinRecord.modify_history ?? input.pinRecord.modifyHistory);
    const descriptor = {
        metaAppPinId: input.pinId,
        contentReference: normalizeText(input.contentReference),
        contentType: normalizeText(input.contentType) || 'application/octet-stream',
        indexFile: normalizeText(input.indexFile) || 'index.html',
        modifyHistory,
    };
    let artifact = await input.artifactCache.getArtifact(descriptor);
    if (!artifact) {
        const archive = await downloadMetaAppArchive(input.fetchImpl, descriptor.contentReference);
        if (!archive) {
            throw new Error('MetaApp ZIP content could not be downloaded.');
        }
        artifact = await input.artifactCache.writeArtifact({ ...descriptor, archive });
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
        const confirmedByHost = consumeMetaIdPinWriteConfirmation({
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
        const config = await targetConfigStore.read();
        return (0, agent_browser_host_contract_1.browserSuccess)(toHostBrowserSettingsSnapshot((0, agent_browser_core_1.createBrowserSettingsSnapshot)({
            config,
            configPath: targetConfigStore.paths.configPath,
            env,
        })));
    }
    async function updateSettings(settingsInput) {
        const actor = await resolveActor(settingsInput);
        if ('failure' in actor)
            return toBrowserResult(actor.failure);
        const targetConfigStore = (0, configStore_1.createConfigStore)(actor.homeDir);
        const current = await targetConfigStore.read();
        try {
            const next = (0, agent_browser_core_1.applyBrowserSettingsUpdate)(current, settingsInput.browser);
            await targetConfigStore.set(next);
            const saved = await targetConfigStore.read();
            if (saved.browser.metasoP2PBaseUrl !== current.browser.metasoP2PBaseUrl) {
                try {
                    await input.onInfrastructureSettingsUpdated?.(actor.homeDir);
                }
                catch {
                    // The saved configuration remains authoritative and will be used on the next reconnect.
                }
            }
            return (0, agent_browser_host_contract_1.browserSuccess)(toHostBrowserSettingsSnapshot((0, agent_browser_core_1.createBrowserSettingsSnapshot)({
                config: saved,
                configPath: targetConfigStore.paths.configPath,
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
    async function resolveResource(resolveInput) {
        const actor = await resolveActor(resolveInput);
        if ('failure' in actor)
            return toBrowserResult(actor.failure);
        const config = await (0, configStore_1.createConfigStore)(actor.homeDir).read();
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
    async function runTrustedAction(actionInput) {
        if (actionInput.kind === 'copy-uri') {
            return copyUriTrustedActionResult(actionInput);
        }
        if (actionInput.kind === 'metafile-upload') {
            return (0, agent_browser_host_contract_1.browserFailure)('unsupported_method', 'OAC Browser MetaFile upload requires a host-owned file picker.');
        }
        if (actionInput.kind === 'metaid-pin-write') {
            return runMetaIdPinWriteAction(actionInput);
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
