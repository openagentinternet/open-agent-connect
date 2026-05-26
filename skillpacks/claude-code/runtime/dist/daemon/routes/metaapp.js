"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMetaAppRoutes = void 0;
const node_buffer_1 = require("node:buffer");
const commandResult_1 = require("../../core/contracts/commandResult");
const PREVIEW_ASSET_PREFIX = '/api/metaapp/preview-assets/';
function readBooleanQueryValue(value) {
    return value === 'true' || value === '1';
}
function isCommandResult(value) {
    return Boolean(value && typeof value === 'object' && 'ok' in value && 'state' in value);
}
function parsePreviewAssetPath(pathname) {
    if (!pathname.startsWith(PREVIEW_ASSET_PREFIX)) {
        return null;
    }
    const raw = pathname.slice(PREVIEW_ASSET_PREFIX.length);
    const pieces = raw.split('/').filter(Boolean);
    if (pieces.length === 0) {
        return null;
    }
    const decoded = [];
    for (const piece of pieces) {
        try {
            const value = decodeURIComponent(piece);
            if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
                return null;
            }
            decoded.push(value);
        }
        catch {
            return null;
        }
    }
    const [previewId, ...assetSegments] = decoded;
    return {
        previewId,
        ...(assetSegments.length > 0 ? { assetPath: assetSegments.join('/') } : {}),
    };
}
async function writePreviewAssetResponse(context, result) {
    const body = typeof result.body === 'string' ? result.body : node_buffer_1.Buffer.from(result.body);
    context.res.writeHead(200, {
        'content-type': result.contentType,
        'content-length': node_buffer_1.Buffer.byteLength(body),
        'cache-control': 'no-store',
    });
    context.res.end(body);
}
function previewAssetFailureStatus(result) {
    switch (result.code) {
        case 'preview_asset_not_found':
        case 'preview_session_not_found':
            return 404;
        case 'preview_session_expired':
            return 410;
        case 'invalid_preview_asset_path':
            return 400;
        default:
            return 500;
    }
}
const handleMetaAppRoutes = async (context) => {
    const { req, url, handlers } = context;
    const previewAssetMatch = parsePreviewAssetPath(url.pathname);
    if (previewAssetMatch) {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const handler = handlers.metaapp?.previewAsset;
        const result = handler
            ? await handler(previewAssetMatch)
            : (0, commandResult_1.commandFailed)('not_implemented', 'MetaApp preview asset handler is not configured.');
        if (isCommandResult(result)) {
            context.sendJson(result.ok ? 200 : previewAssetFailureStatus(result), result);
            return true;
        }
        await writePreviewAssetResponse(context, result);
        return true;
    }
    if (url.pathname === '/api/metaapp/preview') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.metaapp?.preview
            ? await handlers.metaapp.preview(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'MetaApp preview handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/metaapp/publish') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.metaapp?.publish
            ? await handlers.metaapp.publish(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'MetaApp publish handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/metaapp/update') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.metaapp?.update
            ? await handlers.metaapp.update(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'MetaApp update handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/metaapp/share') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.metaapp?.share
            ? await handlers.metaapp.share(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'MetaApp share handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/metaapp/comment') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.metaapp?.comment
            ? await handlers.metaapp.comment(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'MetaApp comment handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/metaapps') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const handler = handlers.metaapp?.list;
        const result = handler
            ? await handler({
                ...(url.searchParams.get('from') ? { from: url.searchParams.get('from') } : {}),
                ...(readBooleanQueryValue(url.searchParams.get('mine')) ? { mine: true } : {}),
                ...(readBooleanQueryValue(url.searchParams.get('refresh')) ? { refresh: true } : {}),
                ...(url.searchParams.get('pinId') ? { pinId: url.searchParams.get('pinId') } : {}),
                ...(url.searchParams.get('firstPinId') ? { firstPinId: url.searchParams.get('firstPinId') } : {}),
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'MetaApp list handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    return false;
};
exports.handleMetaAppRoutes = handleMetaAppRoutes;
