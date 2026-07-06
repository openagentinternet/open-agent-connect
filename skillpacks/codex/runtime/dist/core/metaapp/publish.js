"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewMetaAppProject = previewMetaAppProject;
exports.publishMetaApp = publishMetaApp;
exports.updateMetaApp = updateMetaApp;
exports.shareMetaApp = shareMetaApp;
exports.announceMetaAppShare = announceMetaAppShare;
exports.commentMetaApp = commentMetaApp;
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../contracts/commandResult");
const metafileUri_1 = require("../files/metafileUri");
const manifest_1 = require("./manifest");
const pinId_1 = require("./pinId");
const projectInspector_1 = require("./projectInspector");
const share_1 = require("./share");
const zipArchive_1 = require("./zipArchive");
const METAAPP_RUNTIME_URI_PREVIEW = 'metafile://<uploaded-metaapp-zip-pin>.zip';
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readFeeAssistFailureData(error) {
    const data = error?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return undefined;
    }
    const feeAssist = data.feeAssist;
    if (!feeAssist || typeof feeAssist !== 'object' || Array.isArray(feeAssist)) {
        return undefined;
    }
    return {
        feeAssist: feeAssist,
    };
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function slugFromProjectDir(projectDir) {
    const baseName = node_path_1.default.basename(projectDir) || 'metaapp';
    const slug = baseName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'metaapp';
}
function setIfDefined(target, key, value) {
    if (value !== undefined) {
        target[key] = value;
    }
}
function cleanManifestForPayload(manifest) {
    const payload = {};
    for (const key of [
        'title',
        'appName',
        'prompt',
        'icon',
        'coverImg',
        'introImgs',
        'intro',
        'runtime',
        'indexFile',
        'version',
        'contentType',
        'content',
        'code',
        'contentHash',
        'metadata',
        'tags',
        'disabled',
        'codeType',
    ]) {
        setIfDefined(payload, key, manifest[key]);
    }
    return payload;
}
function applyPreviousMetaAppInheritance(draft, plan, previous) {
    const explicit = plan.manifest;
    const inherited = { ...draft };
    const previousRecord = previous;
    for (const field of ['title', 'appName', 'intro', 'icon', 'coverImg', 'runtime', 'indexFile']) {
        const value = normalizeText(previousRecord[field]);
        if (explicit[field] === undefined && value) {
            inherited[field] = value;
        }
    }
    if (explicit.tags === undefined && previous.tags.length > 0) {
        inherited.tags = [...previous.tags];
    }
    return inherited;
}
function finalizeManifestForWrite(input) {
    const fallbackAppName = slugFromProjectDir(input.plan.projectDir);
    const title = normalizeText(input.manifest.title) || normalizeText(input.manifest.appName) || fallbackAppName;
    const appName = normalizeText(input.manifest.appName) || slugFromProjectDir(title);
    const artifactUri = (0, metafileUri_1.appendMetafileUriExtension)(input.artifactUri, '.zip');
    const codeExtension = (0, metafileUri_1.extensionFromContentType)(input.manifest.codeType) ?? '.zip';
    const explicitCode = (0, metafileUri_1.appendMetafileUriExtension)(normalizeText(input.manifest.code), codeExtension);
    const code = explicitCode || (input.plan.projectType === 'static' || input.compatibilityMirrorContent
        ? artifactUri
        : '');
    return {
        ...input.manifest,
        title,
        appName,
        runtime: normalizeText(input.manifest.runtime) || 'browser',
        version: normalizeText(input.manifest.version) || '1.0.0',
        indexFile: normalizeText(input.manifest.indexFile) || input.plan.indexFile,
        contentType: normalizeText(input.manifest.contentType) || 'application/zip',
        codeType: normalizeText(input.manifest.codeType) || 'application/zip',
        code,
        content: artifactUri,
        contentHash: input.contentHash,
    };
}
function buildLocalUiUrl(pinId, firstPinId) {
    return `/ui/metaapps?pinId=${encodeURIComponent((0, share_1.pickMetaAppViewPinId)(pinId, firstPinId))}`;
}
function buildGalleryRecord(input) {
    return {
        pinId: input.pinId,
        firstPinId: input.firstPinId,
        operation: input.operation,
        title: normalizeText(input.manifest.title) || input.pinId,
        appName: normalizeText(input.manifest.appName) || input.pinId,
        prompt: normalizeText(input.manifest.prompt) || undefined,
        icon: normalizeText(input.manifest.icon) || undefined,
        coverImg: normalizeText(input.manifest.coverImg) || undefined,
        introImgs: normalizeStringArray(input.manifest.introImgs),
        intro: normalizeText(input.manifest.intro) || undefined,
        version: normalizeText(input.manifest.version) || '1.0.0',
        runtime: normalizeText(input.manifest.runtime) || 'browser',
        indexFile: normalizeText(input.manifest.indexFile) || 'index.html',
        code: normalizeText(input.manifest.code),
        content: normalizeText(input.manifest.content),
        contentType: normalizeText(input.manifest.contentType) || 'application/zip',
        codeType: normalizeText(input.manifest.codeType) || 'application/zip',
        tags: normalizeStringArray(input.manifest.tags),
        ownerGlobalMetaId: normalizeText(input.chainWrite.globalMetaId ?? input.upload.globalMetaId),
        ownerAddress: normalizeText(input.chainWrite.mvcAddress),
        network: normalizeText(input.chainWrite.network ?? input.upload.network) || 'mvc',
        metawebUrl: (0, share_1.buildMetaAppCanonicalUrl)(input.pinId, input.firstPinId),
        localUiUrl: buildLocalUiUrl(input.pinId, input.firstPinId),
        runUrl: (0, share_1.buildMetaAppBrowserPath)(input.pinId, input.firstPinId),
        updatedAt: input.now,
        source: 'local',
        raw: {
            chainWrite: input.chainWrite,
            upload: input.upload,
        },
    };
}
async function inspectAndDraft(input) {
    const plan = await (0, projectInspector_1.inspectMetaAppProject)({
        cwd: input.cwd,
        projectDir: input.projectDir,
        manifestFile: input.manifestFile,
    });
    return {
        plan,
        manifest: (0, manifest_1.buildMetaAppManifestDraft)(plan),
    };
}
function createPreviewData(input, deps, plan, manifest) {
    const data = {
        plan,
        manifest,
    };
    if (plan.artifactDir && deps.createPreviewSession) {
        const previewSession = deps.createPreviewSession({
            artifactDir: plan.artifactDir,
            indexFile: normalizeText(manifest.indexFile) || plan.indexFile,
        });
        data.previewId = previewSession.previewId;
        data.localPreviewUrl = previewSession.localPreviewUrl;
        if (input.open) {
            data.localUiUrl = previewSession.localPreviewUrl;
        }
    }
    return data;
}
function manualActionResult(plan, manifest) {
    const manualAction = plan.manualAction ?? {
        code: 'metaapp_artifact_missing',
        message: 'The project does not have a detected runtime artifact directory.',
    };
    return (0, commandResult_1.commandManualActionRequired)(manualAction.code, manualAction.message, {
        data: {
            plan,
            manifest,
        },
    });
}
async function makeArchive(input) {
    const tempDir = input.deps.makeTempDir
        ? await input.deps.makeTempDir()
        : await node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), 'metabot-metaapp-'));
    return (0, zipArchive_1.writeMetaAppZipArchive)({
        sourceDir: input.artifactDir,
        outFile: node_path_1.default.join(tempDir, 'metaapp.zip'),
    });
}
async function createConfirmationData(input, deps, plan, manifest) {
    const data = createPreviewData(input, deps, plan, manifest);
    if (!plan.artifactDir) {
        return data;
    }
    const archive = await makeArchive({ deps, artifactDir: plan.artifactDir });
    data.archivePreview = {
        bytes: archive.bytes,
        sha256: archive.sha256,
        entries: archive.entries,
    };
    data.payloadPreview = cleanManifestForPayload(finalizeManifestForWrite({
        plan,
        manifest,
        artifactUri: METAAPP_RUNTIME_URI_PREVIEW,
        contentHash: archive.sha256,
        compatibilityMirrorContent: input.compatibilityMirrorContent,
    }));
    return data;
}
function uploadArtifactUri(upload) {
    const metafileUri = normalizeText(upload.metafileUri);
    if (metafileUri) {
        return (0, metafileUri_1.appendMetafileUriExtension)(metafileUri, '.zip');
    }
    const pinId = normalizeText(upload.pinId);
    if (pinId) {
        return (0, metafileUri_1.metafileUriFromPinId)(pinId, '.zip');
    }
    throw new Error('Upload result did not include a metafile URI or pinId.');
}
async function writePublishedMetaApp(input) {
    if (!input.plan.artifactDir) {
        return manualActionResult(input.plan, input.manifest);
    }
    if (!input.deps.uploadFile) {
        return (0, commandResult_1.commandFailed)('metaapp_upload_failed', 'MetaApp publish requires an upload dependency.');
    }
    if (!input.deps.writeChain) {
        return (0, commandResult_1.commandFailed)('metaapp_publish_failed', 'MetaApp publish requires a chain write dependency.');
    }
    if (!input.deps.upsertLocal) {
        return (0, commandResult_1.commandFailed)('metaapp_cache_unavailable', 'MetaApp publish requires a local cache dependency before writing on-chain.');
    }
    const archive = await makeArchive({
        deps: input.deps,
        artifactDir: input.plan.artifactDir,
    });
    let upload;
    try {
        upload = await input.deps.uploadFile({
            filePath: archive.filePath,
            contentType: 'application/zip',
            network: input.network,
        });
    }
    catch (error) {
        const feeAssistData = readFeeAssistFailureData(error);
        return (0, commandResult_1.commandFailed)('metaapp_upload_failed', `Unable to upload MetaApp archive: ${errorMessage(error)}`, {
            data: {
                archive,
                ...(feeAssistData ?? {}),
            },
        });
    }
    const artifactUri = uploadArtifactUri(upload);
    const manifest = finalizeManifestForWrite({
        plan: input.plan,
        manifest: input.manifest,
        artifactUri,
        contentHash: archive.sha256,
        compatibilityMirrorContent: input.compatibilityMirrorContent,
    });
    const payload = cleanManifestForPayload(manifest);
    let chainWrite;
    try {
        chainWrite = await input.deps.writeChain({
            operation: input.operation,
            path: input.path,
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            network: input.network,
        });
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('metaapp_publish_failed', `Unable to write MetaApp protocol payload: ${errorMessage(error)}`, {
            data: {
                archive,
                upload,
                payload,
            },
        });
    }
    const pinId = (0, pinId_1.assertMetaAppPinId)(chainWrite.pinId, 'chain write pinId');
    const firstPinId = input.operation === 'modify'
        ? normalizeText(chainWrite.firstPinId) || normalizeText(input.firstPinIdFallback) || input.targetPinId || pinId
        : normalizeText(chainWrite.firstPinId) || pinId;
    const now = input.deps.now ? input.deps.now() : Date.now();
    const record = buildGalleryRecord({
        operation: input.operation,
        pinId,
        firstPinId,
        manifest,
        chainWrite,
        upload,
        now,
    });
    const warnings = [...input.warnings];
    try {
        await input.deps.upsertLocal(record);
    }
    catch (error) {
        warnings.push({
            code: 'metaapp_local_cache_upsert_failed',
            message: `Unable to update local MetaApp cache: ${errorMessage(error)}`,
        });
    }
    return (0, commandResult_1.commandSuccess)({
        pinId,
        firstPinId,
        metawebUrl: (0, share_1.buildMetaAppCanonicalUrl)(pinId, firstPinId),
        localUiUrl: buildLocalUiUrl(pinId, firstPinId),
        archive,
        upload,
        chainWrite,
        record,
        warnings,
    });
}
async function previewMetaAppProject(input, deps = {}) {
    const { plan, manifest } = await inspectAndDraft(input);
    if (plan.manualAction || !plan.artifactDir) {
        return manualActionResult(plan, manifest);
    }
    const data = createPreviewData(input, deps, plan, manifest);
    const result = (0, commandResult_1.commandSuccess)(data);
    if (input.open && typeof data.localPreviewUrl === 'string') {
        result.localUiUrl = data.localPreviewUrl;
    }
    return result;
}
async function publishMetaApp(input, deps) {
    const { plan, manifest } = await inspectAndDraft(input);
    if (plan.manualAction || !plan.artifactDir) {
        return manualActionResult(plan, manifest);
    }
    if (!input.confirm) {
        return (0, commandResult_1.commandAwaitingConfirmation)(await createConfirmationData(input, deps, plan, manifest));
    }
    return writePublishedMetaApp({
        operation: 'create',
        path: '/protocols/metaapp',
        plan,
        manifest,
        network: input.network,
        compatibilityMirrorContent: input.compatibilityMirrorContent,
        deps,
        warnings: [],
    });
}
async function updateMetaApp(input, deps) {
    const targetPinId = (0, pinId_1.assertMetaAppPinId)(input.targetPinId, 'targetPinId');
    const warnings = [];
    const { plan, manifest: draftManifest } = await inspectAndDraft(input);
    let manifest = draftManifest;
    let firstPinIdFallback = targetPinId;
    if (deps.readExistingMetaApp) {
        try {
            const previous = await deps.readExistingMetaApp(targetPinId);
            if (previous) {
                manifest = applyPreviousMetaAppInheritance(draftManifest, plan, previous);
                firstPinIdFallback = normalizeText(previous.firstPinId) || targetPinId;
            }
        }
        catch (error) {
            warnings.push({
                code: 'metaapp_previous_lookup_failed',
                message: `Unable to inherit previous MetaApp metadata: ${errorMessage(error)}`,
            });
        }
    }
    if (plan.manualAction || !plan.artifactDir) {
        return manualActionResult(plan, manifest);
    }
    if (!input.confirm) {
        const preview = await createConfirmationData(input, deps, plan, manifest);
        preview.targetPinId = targetPinId;
        preview.warnings = warnings;
        return (0, commandResult_1.commandAwaitingConfirmation)(preview);
    }
    return writePublishedMetaApp({
        operation: 'modify',
        path: `@${targetPinId}`,
        plan,
        manifest,
        targetPinId,
        firstPinIdFallback,
        network: input.network,
        compatibilityMirrorContent: input.compatibilityMirrorContent,
        deps,
        warnings,
    });
}
async function shareMetaApp(input, _deps) {
    return (0, commandResult_1.commandSuccess)((0, share_1.buildMetaAppShareBundle)(input.pinId));
}
async function announceMetaAppShare(input, deps) {
    const share = (0, share_1.buildMetaAppShareBundle)(input.pinId);
    if (!deps.postBuzz) {
        return (0, commandResult_1.commandFailed)('metaapp_share_announcement_failed', 'MetaApp share announcement requires a buzz dependency.', {
            data: { share },
        });
    }
    const request = (0, share_1.buildMetaAppBuzzRequest)(input);
    try {
        const announcement = await deps.postBuzz({
            ...request,
            network: input.network,
        });
        return (0, commandResult_1.commandSuccess)({
            share,
            announcement,
        });
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('metaapp_share_announcement_failed', `Unable to announce MetaApp share: ${errorMessage(error)}`, {
            data: { share },
        });
    }
}
async function commentMetaApp(input, deps) {
    if (!deps.writeChain) {
        return (0, commandResult_1.commandFailed)('metaapp_comment_failed', 'MetaApp comment requires a chain write dependency.');
    }
    const write = (0, share_1.buildMetaAppCommentWrite)(input);
    try {
        const chainWrite = await deps.writeChain({
            ...write,
            network: input.network,
        });
        const commentPinId = (0, pinId_1.assertMetaAppPinId)(chainWrite.pinId, 'comment pinId');
        return (0, commandResult_1.commandSuccess)({
            commentPinId,
            commentTo: (0, pinId_1.assertMetaAppPinId)(input.pinId),
            network: normalizeText(chainWrite.network ?? input.network) || 'mvc',
            txids: Array.isArray(chainWrite.txids) ? chainWrite.txids : [],
            chainWrite,
        });
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('metaapp_comment_failed', `Unable to comment on MetaApp: ${errorMessage(error)}`);
    }
}
