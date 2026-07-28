"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.materializeMetaAppSource = materializeMetaAppSource;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const agent_browser_core_1 = require("@openagentinternet/agent-browser-core");
const commandResult_1 = require("../contracts/commandResult");
const artifactCache_1 = require("./artifactCache");
const artifactDownload_1 = require("./artifactDownload");
const forkMarker_1 = require("./forkMarker");
const pinId_1 = require("./pinId");
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function normalizeTags(value) {
    return Array.isArray(value)
        ? value.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean)
        : [];
}
function mapResolveFailure(result) {
    const message = result.message || 'Unable to resolve the MetaApp pin.';
    switch (result.code) {
        case 'invalid_browser_uri':
            return (0, commandResult_1.commandFailed)('invalid_argument', message);
        case 'browser_resource_not_found':
            return (0, commandResult_1.commandFailed)('metaapp_not_found', message);
        case 'browser_resource_disabled':
            return (0, commandResult_1.commandFailed)('metaapp_disabled', message);
        case 'browser_protocol_mismatch':
            return (0, commandResult_1.commandFailed)('metaapp_protocol_mismatch', message);
        default:
            return (0, commandResult_1.commandFailed)('metaapp_source_failed', message);
    }
}
async function resolveSourcePackage(pinId, deps, artifactCache) {
    const fetchImpl = deps.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        return (0, commandResult_1.commandFailed)('metaapp_source_failed', 'A fetch implementation is required to resolve MetaApp pins.');
    }
    // The pin resolver hands the package descriptor to this hook, mirroring the
    // daemon host adapter's createPreviewSession integration. The download into
    // the artifact cache happens afterwards via the shared artifactDownload
    // path so failures map to precise CLI error codes.
    const captured = {};
    const resolved = await (0, agent_browser_core_1.resolveMetaAppPinToRecord)({
        pinId,
        fetch: fetchImpl,
        manApiBaseUrl: deps.manApiBaseUrl,
        metafileContentBaseUrl: deps.metafileContentBaseUrl,
        createPreviewSession: (input) => {
            captured.descriptor = {
                contentReference: input.contentReference,
                contentType: input.contentType,
                indexFile: input.indexFile,
                pinRecord: input.pinRecord,
            };
            return { localPreviewUrl: '' };
        },
    });
    if (!resolved.ok) {
        return mapResolveFailure(resolved);
    }
    const descriptor = captured.descriptor;
    if (!descriptor) {
        return (0, commandResult_1.commandFailed)('metaapp_source_failed', 'MetaApp pin resolution did not return a package descriptor.');
    }
    let artifact;
    try {
        artifact = await (0, artifactDownload_1.resolveMetaAppArtifact)({
            pinId,
            contentReference: descriptor.contentReference,
            contentType: descriptor.contentType,
            indexFile: descriptor.indexFile,
            pinRecord: descriptor.pinRecord,
            artifactCache,
            fetchImpl,
        });
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('metaapp_source_download_failed', errorMessage(error));
    }
    if (!artifact) {
        return (0, commandResult_1.commandFailed)('metaapp_source_unsupported', 'MetaApp package content is not a downloadable ZIP archive; its source cannot be materialized.');
    }
    const record = resolved.data;
    return {
        artifact,
        title: record.title || record.appName || pinId,
        tags: normalizeTags(record.tags),
    };
}
async function materializeMetaAppSource(input, deps) {
    const pinId = (0, pinId_1.normalizeMetaAppPinId)(input.pinId);
    if (!pinId) {
        return (0, commandResult_1.commandFailed)('invalid_argument', 'Invalid MetaApp pinId. Expected a 64-hex MetaWeb pinId ending in i0.');
    }
    const artifactCache = deps.artifactCache ?? (0, artifactCache_1.createMetaAppArtifactCacheStore)(deps.homeDir);
    const resolved = await resolveSourcePackage(pinId, deps, artifactCache);
    if ('state' in resolved) {
        return resolved;
    }
    const { artifact, title, tags } = resolved;
    if (!input.outDir) {
        return (0, commandResult_1.commandSuccess)({
            dir: artifact.artifactDir,
            indexFile: artifact.indexFile,
            title,
            sourcePinId: pinId,
        });
    }
    const outDir = node_path_1.default.resolve(input.outDir);
    try {
        const existing = await node_fs_1.promises.readdir(outDir).catch((error) => {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        });
        if (existing && existing.length > 0) {
            return (0, commandResult_1.commandFailed)('metaapp_source_out_not_empty', `Output directory is not empty: ${outDir}. Choose an empty or new directory so app files are not overwritten.`);
        }
        await node_fs_1.promises.mkdir(outDir, { recursive: true });
        await node_fs_1.promises.cp(artifact.artifactDir, outDir, {
            recursive: true,
            // A marker in the source tree is stale provenance; the fresh one below
            // records this fork instead.
            filter: (sourcePath) => node_path_1.default.basename(sourcePath) !== forkMarker_1.METAAPP_FORK_MARKER,
        });
        const marker = {
            sourcePinId: pinId,
            sourceUri: `metaapp://${pinId}`,
            title,
            indexFile: artifact.indexFile,
            ...(tags.length > 0 ? { tags } : {}),
            forkedAt: new Date((deps.now ?? Date.now)()).toISOString(),
        };
        const markerPath = await (0, forkMarker_1.writeMetaAppForkMarker)(outDir, marker);
        return (0, commandResult_1.commandSuccess)({
            dir: outDir,
            indexFile: artifact.indexFile,
            title,
            sourcePinId: pinId,
            sourceUri: marker.sourceUri,
            markerPath,
        });
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('metaapp_source_failed', errorMessage(error));
    }
}
