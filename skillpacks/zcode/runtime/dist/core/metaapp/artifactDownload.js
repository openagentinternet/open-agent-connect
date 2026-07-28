"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isZipMetaAppContent = isZipMetaAppContent;
exports.metaAppArchiveUrls = metaAppArchiveUrls;
exports.downloadMetaAppArchive = downloadMetaAppArchive;
exports.resolveMetaAppArtifact = resolveMetaAppArtifact;
const metafileUrls_1 = require("../files/metafileUrls");
const artifactCache_1 = require("./artifactCache");
/**
 * MetaApp archive download helpers shared by the daemon Browser host adapter
 * (`/browser/metaapp/<pinId>` preview) and the CLI `metaapp source` command.
 * Both flows resolve a MetaApp pin to its zip content reference, download the
 * archive through the metafile content URLs, and extract it into the shared
 * artifact cache — this module is the single implementation of that path.
 */
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
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
/**
 * Resolve a MetaApp zip package into the artifact cache: return the cached
 * extraction when present, otherwise download the archive and extract it.
 * Returns null when the package content is not a downloadable zip archive.
 */
async function resolveMetaAppArtifact(input) {
    if (!isZipMetaAppContent(input.contentType, input.contentReference)) {
        return null;
    }
    const modifyHistory = (0, artifactCache_1.normalizeMetaAppModifyHistory)(input.pinRecord?.modify_history ?? input.pinRecord?.modifyHistory);
    const descriptor = {
        metaAppPinId: input.pinId,
        contentReference: normalizeText(input.contentReference),
        contentType: normalizeText(input.contentType) || 'application/octet-stream',
        indexFile: normalizeText(input.indexFile) || 'index.html',
        modifyHistory,
    };
    const cached = await input.artifactCache.getArtifact(descriptor);
    if (cached) {
        return cached;
    }
    const archive = await downloadMetaAppArchive(input.fetchImpl, descriptor.contentReference);
    if (!archive) {
        throw new Error('MetaApp ZIP content could not be downloaded.');
    }
    return input.artifactCache.writeArtifact({ ...descriptor, archive });
}
