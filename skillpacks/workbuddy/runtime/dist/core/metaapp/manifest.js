"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMetaAppManifestInput = normalizeMetaAppManifestInput;
exports.readMetaAppManifestFile = readMetaAppManifestFile;
exports.buildMetaAppManifestDraft = buildMetaAppManifestDraft;
const node_fs_1 = require("node:fs");
const STRING_FIELDS = new Set([
    'title',
    'appName',
    'prompt',
    'icon',
    'coverImg',
    'intro',
    'runtime',
    'version',
    'contentType',
    'content',
    'indexFile',
    'code',
    'contentHash',
    'codeType',
    'artifactDir',
]);
const STRING_ARRAY_FIELDS = new Set(['introImgs', 'tags']);
const BOOLEAN_FIELDS = new Set(['disabled', 'sourceArchive']);
const OBJECT_FIELDS = new Set(['metadata']);
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : undefined;
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const normalized = value
        .map((entry) => normalizeString(entry))
        .filter((entry) => Boolean(entry));
    return normalized.length > 0 ? normalized : [];
}
function normalizeMetadata(value) {
    if (!isPlainObject(value)) {
        return undefined;
    }
    const metadata = {};
    if (isPlainObject(value.user)) {
        metadata.user = { ...value.user };
    }
    return metadata;
}
function normalizeMetaAppManifestInput(value) {
    if (!isPlainObject(value)) {
        throw new Error('MetaApp manifest override must be a JSON object.');
    }
    const manifest = {};
    for (const [key, rawValue] of Object.entries(value)) {
        if (STRING_FIELDS.has(key)) {
            const normalized = normalizeString(rawValue);
            if (normalized !== undefined) {
                manifest[key] = normalized;
            }
            continue;
        }
        if (STRING_ARRAY_FIELDS.has(key)) {
            const normalized = normalizeStringArray(rawValue);
            if (normalized !== undefined) {
                manifest[key] = normalized;
            }
            continue;
        }
        if (BOOLEAN_FIELDS.has(key)) {
            if (typeof rawValue === 'boolean') {
                manifest[key] = rawValue;
            }
            continue;
        }
        if (OBJECT_FIELDS.has(key)) {
            const normalized = normalizeMetadata(rawValue);
            if (normalized !== undefined) {
                manifest.metadata = normalized;
            }
        }
    }
    return manifest;
}
async function readMetaAppManifestFile(filePath) {
    const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
    return normalizeMetaAppManifestInput(JSON.parse(raw));
}
function buildMetaAppManifestDraft(plan) {
    const draft = {
        ...plan.manifest,
        runtime: plan.manifest.runtime ?? 'browser',
        version: plan.manifest.version ?? '1.0.0',
        contentType: plan.manifest.contentType ?? 'application/zip',
        codeType: plan.manifest.codeType ?? 'application/zip',
        indexFile: plan.manifest.indexFile ?? plan.indexFile,
        code: plan.manifest.code ?? '',
        content: plan.manifest.content ?? '',
    };
    if (isPlainObject(plan.manifest.metadata) && Object.keys(plan.manifest.metadata).length > 0) {
        draft.metadata = { ...plan.manifest.metadata };
    }
    return draft;
}
