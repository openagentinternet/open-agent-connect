"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStandaloneBrowserHostAdapter = createStandaloneBrowserHostAdapter;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("../../core/browser/config");
const browserResolver_1 = require("../../core/browser/browserResolver");
const metaAppPinResolver_1 = require("../../core/browser/metaAppPinResolver");
const settings_1 = require("../../core/browser/settings");
const configTypes_1 = require("../../core/config/configTypes");
const commandResult_1 = require("../../core/contracts/commandResult");
const STANDALONE_ACTOR_ID = 'standalone-wallet';
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function actorSelector(input) {
    return normalizeText(input?.actorId) || normalizeText(input?.from);
}
function createStandaloneConfig() {
    const config = (0, configTypes_1.createDefaultConfig)();
    return {
        ...config,
        browser: {
            ...config.browser,
            localMode: false,
        },
    };
}
function buildStandaloneActor() {
    return {
        id: STANDALONE_ACTOR_ID,
        label: 'Standalone Wallet',
        kind: 'wallet',
        isDefault: true,
        capabilities: ['template-settings'],
    };
}
function encodeAssetPath(assetPath) {
    return assetPath
        .split('/')
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}
function contentTypeForPath(filePath) {
    const extension = node_path_1.default.extname(filePath).toLowerCase();
    if (extension === '.html' || extension === '.htm')
        return 'text/html; charset=utf-8';
    if (extension === '.css')
        return 'text/css; charset=utf-8';
    if (extension === '.js' || extension === '.mjs')
        return 'text/javascript; charset=utf-8';
    if (extension === '.json')
        return 'application/json; charset=utf-8';
    if (extension === '.svg')
        return 'image/svg+xml';
    if (extension === '.png')
        return 'image/png';
    if (extension === '.jpg' || extension === '.jpeg')
        return 'image/jpeg';
    if (extension === '.webp')
        return 'image/webp';
    return 'application/octet-stream';
}
function normalizePreviewAssetPath(value) {
    const text = normalizeText(value).replace(/\\/g, '/');
    if (!text || text.startsWith('/') || text.includes('\0')) {
        return null;
    }
    const normalized = node_path_1.default.posix.normalize(text.replace(/^\.\//u, ''));
    if (!normalized || normalized === '.' || normalized.split('/').includes('..')) {
        return null;
    }
    return normalized;
}
function createStandaloneBrowserHostAdapter(input = {}) {
    const env = input.env ?? process.env;
    const fetchImpl = input.fetch ?? globalThis.fetch;
    const now = input.now ?? Date.now;
    let config = createStandaloneConfig();
    let cacheClearedAt = null;
    let previewCounter = 0;
    const previewSessions = new Map();
    function resolveActor(actorInput) {
        const requestedActor = actorSelector(actorInput);
        if (requestedActor && requestedActor !== STANDALONE_ACTOR_ID) {
            return {
                failure: (0, commandResult_1.commandFailed)('actor_not_found', `Standalone Browser actor not found: ${requestedActor}`),
            };
        }
        return null;
    }
    async function getRuntime(runtimeInput = {}) {
        const actorFailure = resolveActor(runtimeInput);
        if (actorFailure)
            return actorFailure.failure;
        const actor = buildStandaloneActor();
        return (0, commandResult_1.commandSuccess)({
            host: {
                kind: 'standalone',
                name: 'Agent Internet Browser',
                localMode: false,
            },
            actors: [actor],
            defaultActor: actor,
            defaultUri: null,
            features: {
                privateChat: false,
                serviceCall: false,
                cacheManagement: true,
                templateSettings: true,
                walletLogin: false,
            },
            labels: {
                actorChip: 'Wallet',
                noActorTitle: 'No Wallet',
                noActorBody: 'Standalone Browser is running without wallet login.',
            },
        });
    }
    async function getSettings(settingsInput = {}) {
        const actorFailure = resolveActor(settingsInput);
        if (actorFailure)
            return actorFailure.failure;
        return (0, commandResult_1.commandSuccess)((0, settings_1.createBrowserSettingsSnapshot)({ config, env }));
    }
    async function updateSettings(settingsInput) {
        const actorFailure = resolveActor(settingsInput);
        if (actorFailure)
            return actorFailure.failure;
        try {
            config = (0, settings_1.applyBrowserSettingsUpdate)(config, settingsInput.browser);
            return (0, commandResult_1.commandSuccess)((0, settings_1.createBrowserSettingsSnapshot)({ config, env }));
        }
        catch (error) {
            return (0, commandResult_1.commandFailed)('invalid_argument', error instanceof Error ? error.message : String(error));
        }
    }
    async function getCache(cacheInput = {}) {
        const actorFailure = resolveActor(cacheInput);
        if (actorFailure)
            return actorFailure.failure;
        return (0, commandResult_1.commandSuccess)({
            cacheRoot: 'standalone-memory',
            artifactCount: 0,
            pinRecordCount: 0,
            totalBytes: 0,
            ...(cacheClearedAt ? { lastClearedAt: cacheClearedAt } : {}),
        });
    }
    async function clearCache(cacheInput) {
        const actorFailure = resolveActor(cacheInput);
        if (actorFailure)
            return actorFailure.failure;
        const scope = normalizeText(cacheInput.scope) || 'all';
        if (scope !== 'all' && scope !== 'pin' && scope !== 'artifact') {
            return (0, commandResult_1.commandFailed)('invalid_argument', 'Unsupported Browser cache clear scope.');
        }
        cacheClearedAt = now();
        return (0, commandResult_1.commandSuccess)({
            clearedArtifacts: 0,
            clearedPinRecords: 0,
            scope,
            cacheRoot: 'standalone-memory',
            lastClearedAt: cacheClearedAt,
        });
    }
    async function resolveResource(resolveInput) {
        const actorFailure = resolveActor(resolveInput);
        if (actorFailure)
            return actorFailure.failure;
        const browserConfig = (0, config_1.resolveBrowserConfig)(config, env);
        return (0, browserResolver_1.resolveBrowserResource)({
            uri: resolveInput.uri,
            config: browserConfig,
            fetch: fetchImpl,
            metaAppResolve: (pinId) => (0, metaAppPinResolver_1.resolveMetaAppPinToRecord)({
                pinId,
                fetch: fetchImpl,
                manApiBaseUrl: browserConfig.manApiBaseUrl,
                createPreviewSession: ({ artifactDir, indexFile }) => {
                    previewCounter += 1;
                    const previewId = `standalone-${now().toString(36)}-${previewCounter.toString(36)}`;
                    previewSessions.set(previewId, {
                        artifactDir,
                        indexFile,
                        createdAt: now(),
                    });
                    return {
                        previewId,
                        localPreviewUrl: `/api/browser/preview-assets/${encodeURIComponent(previewId)}/${encodeAssetPath(indexFile)}`,
                    };
                },
            }),
        });
    }
    async function runTrustedAction(actionInput) {
        const actorFailure = resolveActor(actionInput);
        if (actorFailure)
            return actorFailure.failure;
        return (0, commandResult_1.commandFailed)('browser_action_not_supported', `Standalone Browser does not support trusted action: ${actionInput.kind}`);
    }
    async function resolvePreviewAsset(assetInput) {
        const previewId = normalizeText(assetInput.previewId);
        const assetPath = normalizePreviewAssetPath(assetInput.assetPath);
        if (!previewId || !assetPath) {
            return (0, commandResult_1.commandFailed)('invalid_argument', 'Preview asset path is invalid.');
        }
        const session = previewSessions.get(previewId);
        if (!session) {
            return (0, commandResult_1.commandFailed)('browser_resource_not_found', 'Preview session was not found.');
        }
        const artifactRoot = node_path_1.default.resolve(session.artifactDir);
        const filePath = node_path_1.default.resolve(artifactRoot, assetPath);
        if (filePath !== artifactRoot && !filePath.startsWith(`${artifactRoot}${node_path_1.default.sep}`)) {
            return (0, commandResult_1.commandFailed)('invalid_argument', 'Preview asset path is outside the app package.');
        }
        try {
            const body = await node_fs_1.promises.readFile(filePath);
            return (0, commandResult_1.commandSuccess)({
                body,
                contentType: contentTypeForPath(filePath),
            });
        }
        catch {
            return (0, commandResult_1.commandFailed)('browser_resource_not_found', 'Preview asset was not found.');
        }
    }
    return {
        getRuntime,
        resolveResource,
        getSettings,
        updateSettings,
        getCache,
        clearCache,
        runTrustedAction,
        resolvePreviewAsset,
    };
}
