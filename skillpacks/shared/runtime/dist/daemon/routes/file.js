"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleFileRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
const AVATAR_ROUTE_PATH = '/api/file/avatar';
const FILE_UPLOAD_ROUTE_PATH = '/api/file/upload';
const DEFAULT_P2P_CONTENT_BASE = 'http://localhost:7281';
const AVATAR_FETCH_TIMEOUT_MS = 4500;
const PIN_CONTENT_PATTERNS = [
    /^\/content\/([^/?#]+)/iu,
    /^\/metafile-indexer\/content\/([^/?#]+)/iu,
    /^\/metafile-indexer\/thumbnail\/([^/?#]+)/iu,
    /^\/metafile-indexer\/api\/v1\/files\/content\/([^/?#]+)/iu,
    /^\/metafile-indexer\/api\/v1\/files\/accelerate\/content\/([^/?#]+)/iu,
    /^\/metafile-indexer\/api\/v1\/users\/avatar\/accelerate\/([^/?#]+)/iu,
];
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function stripQueryAndFragment(value) {
    return value.split(/[?#]/u)[0] ?? value;
}
function isLikelyPinId(value) {
    return /^[0-9a-f]{64}(?:i\d+)?$/iu.test(value) || /^[A-Za-z0-9._:-]{8,256}$/u.test(value);
}
function extractAvatarPinId(reference) {
    const normalized = normalizeText(reference);
    if (!normalized || normalized.startsWith('data:') || normalized.startsWith('blob:')) {
        return '';
    }
    if (/^metafile:\/\//iu.test(normalized)) {
        const pinId = stripQueryAndFragment(normalized.slice('metafile://'.length).trim());
        return isLikelyPinId(pinId) ? pinId : '';
    }
    const path = (() => {
        if (/^https?:\/\//iu.test(normalized)) {
            try {
                return new URL(normalized).pathname;
            }
            catch {
                return '';
            }
        }
        return normalized;
    })();
    for (const pattern of PIN_CONTENT_PATTERNS) {
        const match = path.match(pattern);
        if (match?.[1]) {
            const pinId = decodeURIComponent(stripQueryAndFragment(match[1]));
            return isLikelyPinId(pinId) ? pinId : '';
        }
    }
    const bare = stripQueryAndFragment(normalized);
    if (!bare.includes('/') && !bare.includes('\\') && isLikelyPinId(bare)) {
        return bare;
    }
    return '';
}
function avatarContentUrls(pinId) {
    const encodedPinId = encodeURIComponent(pinId);
    const localBase = normalizeText(process.env.METABOT_P2P_LOCAL_BASE) || DEFAULT_P2P_CONTENT_BASE;
    return [
        `${localBase.replace(/\/+$/u, '')}/content/${encodedPinId}`,
        `https://file.metaid.io/metafile-indexer/content/${encodedPinId}`,
        `https://file.metaid.io/metafile-indexer/api/v1/users/avatar/accelerate/${encodedPinId}?process=thumbnail`,
        `https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/${encodedPinId}?process=thumbnail`,
        `https://file.metaid.io/metafile-indexer/api/v1/files/content/${encodedPinId}`,
    ];
}
function isRejectedAvatarMime(contentType) {
    return /^text\//iu.test(contentType) || /(?:application\/json|[+/]json)(?:\s*;|$)/iu.test(contentType);
}
async function fetchAvatarContent(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AVATAR_FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            return null;
        }
        const contentType = normalizeText(response.headers.get('content-type')).split(';')[0]?.trim() || 'application/octet-stream';
        if (isRejectedAvatarMime(contentType)) {
            return null;
        }
        const body = Buffer.from(await response.arrayBuffer());
        if (!body.length) {
            return null;
        }
        return { body, contentType };
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timeout);
    }
}
async function serveAvatarRoute(context) {
    const { req, url } = context;
    if (url.pathname !== AVATAR_ROUTE_PATH) {
        return false;
    }
    if (req.method !== 'GET') {
        context.sendMethodNotAllowed(['GET']);
        return true;
    }
    const pinId = extractAvatarPinId(url.searchParams.get('ref'));
    if (!pinId) {
        context.sendJson(400, (0, commandResult_1.commandFailed)('invalid_avatar_ref', 'A valid MetaID avatar pin reference is required.'));
        return true;
    }
    for (const contentUrl of avatarContentUrls(pinId)) {
        const resolved = await fetchAvatarContent(contentUrl);
        if (resolved) {
            context.sendText(200, resolved.body, resolved.contentType);
            return true;
        }
    }
    context.sendJson(404, (0, commandResult_1.commandFailed)('avatar_not_found', `Avatar content was not found for ${pinId}.`));
    return true;
}
const handleFileRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (await serveAvatarRoute(context)) {
        return true;
    }
    if (url.pathname !== FILE_UPLOAD_ROUTE_PATH) {
        return false;
    }
    if (req.method !== 'POST') {
        context.sendMethodNotAllowed(['POST']);
        return true;
    }
    const input = await context.readJsonBody();
    const result = handlers.file?.upload
        ? await handlers.file.upload(input)
        : (0, commandResult_1.commandFailed)('not_implemented', 'File upload handler is not configured.');
    context.sendJson(200, result);
    return true;
};
exports.handleFileRoutes = handleFileRoutes;
