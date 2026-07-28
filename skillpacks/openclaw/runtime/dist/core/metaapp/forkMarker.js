"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.METAAPP_FORK_MARKER = void 0;
exports.writeMetaAppForkMarker = writeMetaAppForkMarker;
exports.readMetaAppForkMarker = readMetaAppForkMarker;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const pinId_1 = require("./pinId");
/**
 * Provenance marker written into a workspace directory by
 * `metabot metaapp source --out <dir>` when a MetaApp package is forked for
 * editing/remixing. The publish flow reads it to default the manifest's
 * `forkedFrom` lineage and to inherit capability tags. The marker is local
 * provenance only; it is never shipped inside the published zip.
 *
 * Mirrors the IDBots `.idbots-fork.json` flow with a host-neutral name.
 */
exports.METAAPP_FORK_MARKER = '.metaapp-fork.json';
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeForkedAt(value) {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    // Tolerate epoch-millisecond markers written by other hosts.
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return new Date(value).toISOString();
    }
    return '';
}
/** Write the fork marker into a workspace directory; returns the marker path. */
async function writeMetaAppForkMarker(dir, marker) {
    const markerPath = node_path_1.default.join(dir, exports.METAAPP_FORK_MARKER);
    await node_fs_1.promises.writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
    return markerPath;
}
/**
 * Read the fork marker written by `metabot metaapp source --out`, if present.
 * Returns null when the file is missing, malformed, or carries an invalid
 * source pin id (a broken marker must never inject garbage into an on-chain
 * manifest).
 */
async function readMetaAppForkMarker(dir) {
    let raw;
    try {
        raw = await node_fs_1.promises.readFile(node_path_1.default.join(dir, exports.METAAPP_FORK_MARKER), 'utf8');
    }
    catch {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }
    const record = parsed;
    const sourcePinId = (0, pinId_1.normalizeMetaAppPinId)(record.sourcePinId);
    if (!sourcePinId) {
        return null;
    }
    const tags = Array.isArray(record.tags)
        ? record.tags.map((tag) => normalizeText(tag)).filter(Boolean)
        : [];
    return {
        sourcePinId,
        sourceUri: normalizeText(record.sourceUri) || `metaapp://${sourcePinId}`,
        title: normalizeText(record.title),
        indexFile: normalizeText(record.indexFile) || 'index.html',
        ...(tags.length > 0 ? { tags } : {}),
        forkedAt: normalizeForkedAt(record.forkedAt),
    };
}
