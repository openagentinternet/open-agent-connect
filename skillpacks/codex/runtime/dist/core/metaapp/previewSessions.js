"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferMetaAppPreviewMimeType = inferMetaAppPreviewMimeType;
exports.createMetaAppPreviewSessionRegistry = createMetaAppPreviewSessionRegistry;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
};
class MetaAppPreviewSessionError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'MetaAppPreviewSessionError';
        this.code = code;
    }
}
function normalizeRelativeAssetPath(assetPath, indexFile) {
    const trimmed = typeof assetPath === 'string' ? assetPath.trim() : '';
    const relativePath = trimmed || indexFile;
    if (!relativePath
        || relativePath.includes('\\')
        || node_path_1.default.posix.isAbsolute(relativePath)
        || node_path_1.default.win32.isAbsolute(relativePath)) {
        throw new MetaAppPreviewSessionError('invalid_preview_asset_path', 'Preview asset path must be relative.');
    }
    const normalized = node_path_1.default.posix.normalize(relativePath.replace(/^\.\//, ''));
    if (!normalized || normalized === '.' || normalized.split('/').includes('..')) {
        throw new MetaAppPreviewSessionError('invalid_preview_asset_path', 'Preview asset path cannot escape the artifact directory.');
    }
    return normalized;
}
function assertInsideArtifactDir(artifactDir, filePath) {
    const relative = node_path_1.default.relative(artifactDir, filePath);
    if (!relative || relative.startsWith('..') || node_path_1.default.isAbsolute(relative)) {
        throw new MetaAppPreviewSessionError('invalid_preview_asset_path', 'Preview asset path cannot escape the artifact directory.');
    }
}
async function assertRealPathInsideArtifactDir(artifactDir, filePath) {
    let realArtifactDir;
    let realFilePath;
    try {
        [realArtifactDir, realFilePath] = await Promise.all([
            node_fs_1.promises.realpath(artifactDir),
            node_fs_1.promises.realpath(filePath),
        ]);
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT' || code === 'EISDIR') {
            throw new MetaAppPreviewSessionError('preview_asset_not_found', 'Preview asset was not found.');
        }
        throw error;
    }
    assertInsideArtifactDir(realArtifactDir, realFilePath);
    return realFilePath;
}
function getSession(sessions, previewId, now) {
    const session = sessions.get(previewId);
    if (!session) {
        throw new MetaAppPreviewSessionError('preview_session_not_found', 'Preview session was not found.');
    }
    if (session.expiresAt <= now) {
        sessions.delete(previewId);
        throw new MetaAppPreviewSessionError('preview_session_expired', 'Preview session has expired.');
    }
    return session;
}
function inferMetaAppPreviewMimeType(filePath) {
    return MIME_TYPES[node_path_1.default.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
function createMetaAppPreviewSessionRegistry(input) {
    const now = input?.now ?? Date.now;
    const ttlMs = input?.ttlMs ?? DEFAULT_TTL_MS;
    const sessions = new Map();
    return {
        create(sessionInput) {
            const createdAt = now();
            const artifactDir = node_path_1.default.resolve(sessionInput.artifactDir);
            const indexFile = normalizeRelativeAssetPath(sessionInput.indexFile, 'index.html');
            const previewId = `metaapp-preview-${(0, node_crypto_1.randomUUID)()}`;
            const session = {
                previewId,
                artifactDir,
                indexFile,
                createdAt,
                expiresAt: createdAt + ttlMs,
                localPreviewUrl: `/api/metaapp/preview-assets/${previewId}/`,
            };
            sessions.set(previewId, session);
            return session;
        },
        async resolveAsset(assetInput) {
            const session = getSession(sessions, assetInput.previewId, now());
            const assetPath = normalizeRelativeAssetPath(assetInput.assetPath, session.indexFile);
            const filePath = node_path_1.default.resolve(session.artifactDir, assetPath);
            assertInsideArtifactDir(session.artifactDir, filePath);
            const realFilePath = await assertRealPathInsideArtifactDir(session.artifactDir, filePath);
            let body;
            try {
                body = await node_fs_1.promises.readFile(realFilePath);
            }
            catch (error) {
                const code = error.code;
                if (code === 'ENOENT' || code === 'EISDIR') {
                    throw new MetaAppPreviewSessionError('preview_asset_not_found', 'Preview asset was not found.');
                }
                throw error;
            }
            return {
                previewId: session.previewId,
                assetPath,
                filePath,
                contentType: inferMetaAppPreviewMimeType(filePath),
                body,
            };
        },
        pruneExpired() {
            const currentTime = now();
            for (const [previewId, session] of sessions) {
                if (session.expiresAt <= currentTime) {
                    sessions.delete(previewId);
                }
            }
        },
    };
}
