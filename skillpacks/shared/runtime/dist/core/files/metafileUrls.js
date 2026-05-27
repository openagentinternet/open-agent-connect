"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMetafileContentUrls = buildMetafileContentUrls;
const FILE_INDEXER_BASE = 'https://file.metaid.io/metafile-indexer/api/v1/files';
function buildMetafileContentUrls(pinId) {
    const normalized = String(pinId || '').trim();
    if (!normalized) {
        throw new Error('pinId is required.');
    }
    const encoded = encodeURIComponent(normalized);
    const accelerateUrl = `${FILE_INDEXER_BASE}/accelerate/content/${encoded}`;
    const contentUrl = `${FILE_INDEXER_BASE}/content/${encoded}`;
    return {
        accelerateUrl,
        contentUrl,
        legacyContentUrl: `https://file.metaid.io/metafile-indexer/content/${encoded}`,
        previewUrl: contentUrl,
        downloadUrl: accelerateUrl,
    };
}
