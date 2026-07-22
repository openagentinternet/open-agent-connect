"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_METASO_P2P_BASE_URL = void 0;
exports.resolveMetasoInfrastructureEndpoints = resolveMetasoInfrastructureEndpoints;
exports.DEFAULT_METASO_P2P_BASE_URL = 'https://so.metaid.io';
function normalizeBaseUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    const parsed = new URL(raw || exports.DEFAULT_METASO_P2P_BASE_URL);
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed;
}
function appendPath(base, suffix) {
    const url = new URL(base.toString());
    const prefix = url.pathname === '/' ? '' : url.pathname;
    url.pathname = `${prefix}/${suffix.replace(/^\/+/, '')}`;
    return url.toString().replace(/\/$/, '');
}
function resolveMetasoInfrastructureEndpoints(metasoP2PBaseUrl) {
    const base = normalizeBaseUrl(metasoP2PBaseUrl);
    const socketUrl = new URL(base.origin);
    if (socketUrl.protocol === 'https:') {
        socketUrl.protocol = 'wss:';
    }
    else if (socketUrl.protocol === 'http:') {
        socketUrl.protocol = 'ws:';
    }
    const pathPrefix = base.pathname === '/' ? '' : base.pathname;
    return {
        metasoP2PBaseUrl: base.toString().replace(/\/$/, ''),
        chatApiBaseUrl: appendPath(base, 'chat-api/group-chat'),
        socketPresenceApiBaseUrl: appendPath(base, 'chat-api'),
        socket: {
            url: socketUrl.toString().replace(/\/$/, ''),
            path: `${pathPrefix}/socket/socket.io`,
        },
    };
}
