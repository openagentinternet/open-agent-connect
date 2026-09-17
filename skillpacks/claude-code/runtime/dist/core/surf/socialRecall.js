"use strict";
/**
 * Thin client for the metaso-p2p Social Recall API: GET /api/social/feed,
 * GET /api/social/post/:pinId and GET /api/social/post/:pinId/comments.
 * OAC port of the IDBots socialRecallService. Same conventions as the
 * MetaWeb aggregation APIs: {code, data, message} envelope, HTTP always 200,
 * business error codes 40000/40400/50000.
 *
 * The feed is a coarse candidate set (newest or hot, unranked by preference);
 * surf sessions pick and rank items for the bot and may verify them with the
 * detail endpoint.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocialRecallNotFoundError = exports.DEFAULT_SOCIAL_RECALL_BASE_URL = void 0;
exports.getSocialFeed = getSocialFeed;
exports.getSocialPost = getSocialPost;
exports.getSocialPostComments = getSocialPostComments;
exports.DEFAULT_SOCIAL_RECALL_BASE_URL = 'https://so.metaid.io';
const DEFAULT_TIMEOUT_MS = 10_000;
class SocialRecallNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SocialRecallNotFoundError';
    }
}
exports.SocialRecallNotFoundError = SocialRecallNotFoundError;
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function textList(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}
function normalizePayload(raw) {
    if (typeof raw === 'string') {
        const content = raw.trim();
        return content ? { content, contentType: 'text/plain;utf-8', attachments: [] } : null;
    }
    if (raw && typeof raw === 'object') {
        const record = raw;
        const content = text(record.content);
        if (!content)
            return null;
        return {
            content,
            contentType: text(record.contentType) || 'text/plain;utf-8',
            attachments: textList(record.attachments),
        };
    }
    return null;
}
function normalizePost(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    const authorRaw = record.author && typeof record.author === 'object'
        ? record.author
        : {};
    return {
        pinId: text(record.pinId),
        sourcePinId: text(record.sourcePinId),
        currentPinId: text(record.currentPinId),
        chainName: text(record.chainName),
        protocolPath: text(record.protocolPath),
        author: {
            globalMetaId: text(authorRaw.globalMetaId),
            metaId: text(authorRaw.metaId),
            address: text(authorRaw.address),
        },
        contentType: text(record.contentType),
        payload: normalizePayload(record.payload),
        createdAt: Number(record.createdAt) || 0,
        updatedAt: Number(record.updatedAt) || 0,
        likeCount: Number(record.likeCount) || 0,
        commentCount: Number(record.commentCount) || 0,
        donateCount: Number(record.donateCount) || 0,
        quoteCount: Number(record.quoteCount) || 0,
        hotScore: typeof record.hotScore === 'number' ? record.hotScore : undefined,
    };
}
function normalizePostPage(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    const items = Array.isArray(record.items) ? record.items.map(normalizePost) : [];
    return {
        items,
        nextCursor: text(record.nextCursor) || null,
        hasMore: record.hasMore === true,
    };
}
function normalizeComment(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        pinId: text(record.pinId),
        chainName: text(record.chainName),
        targetPinId: text(record.targetPinId),
        authorGlobalMetaId: text(record.authorGlobalMetaId),
        authorMetaId: text(record.authorMetaId),
        authorAddress: text(record.authorAddress),
        content: text(record.content),
        contentType: text(record.contentType),
        timestamp: Number(record.timestamp) || 0,
    };
}
function normalizeCommentPage(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    const items = Array.isArray(record.items) ? record.items.map(normalizeComment) : [];
    return {
        items,
        nextCursor: text(record.nextCursor) || null,
        hasMore: record.hasMore === true,
    };
}
async function fetchApiData(url, fetchImpl, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, {
            signal: controller.signal,
            headers: { accept: 'application/json' },
        });
        const body = await response.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            throw new Error(`Social Recall API returned an invalid response (HTTP ${response.status}).`);
        }
        const code = Number(body.code);
        if (code === 0) {
            return (body.data && typeof body.data === 'object' ? body.data : {});
        }
        const message = text(body.message) || 'unknown error';
        if (code === 40400) {
            throw new SocialRecallNotFoundError(message);
        }
        throw new Error(`Social Recall API error ${code}: ${message}`);
    }
    finally {
        clearTimeout(timer);
    }
}
function resolveOptions(options) {
    const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('A fetch implementation is required for Social Recall.');
    }
    return {
        baseUrl: (options?.baseUrl ?? exports.DEFAULT_SOCIAL_RECALL_BASE_URL).replace(/\/+$/, ''),
        fetchImpl,
        timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
}
/** GET /api/social/feed — coarse candidate post retrieval (newest or hot). */
async function getSocialFeed(params, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const query = new URLSearchParams();
    if (params.keywords?.length) {
        query.set('keywords', params.keywords.map((term) => term.trim()).filter(Boolean).join(','));
    }
    else if (params.keyword?.trim()) {
        query.set('keyword', params.keyword.trim());
    }
    if (params.publishers?.length) {
        query.set('publishers', params.publishers.map((id) => id.trim()).filter(Boolean).join(','));
    }
    else if (params.publisher?.trim()) {
        query.set('publisher', params.publisher.trim());
    }
    if (typeof params.since === 'number' && params.since > 0)
        query.set('since', String(Math.floor(params.since)));
    if (typeof params.until === 'number' && params.until > 0)
        query.set('until', String(Math.floor(params.until)));
    if (params.sort === 'hot')
        query.set('sort', 'hot');
    if (params.chainName?.trim())
        query.set('chainName', params.chainName.trim());
    if (params.scope === 'following') {
        query.set('scope', 'following');
        if (params.user?.trim())
            query.set('user', params.user.trim());
    }
    if (typeof params.size === 'number' && params.size > 0)
        query.set('size', String(Math.min(100, Math.floor(params.size))));
    if (params.cursor?.trim())
        query.set('cursor', params.cursor.trim());
    const qs = query.toString();
    const data = await fetchApiData(`${baseUrl}/api/social/feed${qs ? `?${qs}` : ''}`, fetchImpl, timeoutMs);
    return normalizePostPage(data);
}
/** GET /api/social/post/:pinId — aggregated post detail by any version PIN. */
async function getSocialPost(pinId, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const trimmed = pinId.trim();
    if (!trimmed)
        throw new Error('pinId is required to fetch a social post.');
    const data = await fetchApiData(`${baseUrl}/api/social/post/${encodeURIComponent(trimmed)}`, fetchImpl, timeoutMs);
    return normalizePost(data);
}
/** GET /api/social/post/:pinId/comments — comments attached to a post. */
async function getSocialPostComments(input, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const pinId = input.pinId.trim();
    if (!pinId)
        throw new Error('pinId is required to list social post comments.');
    const query = new URLSearchParams();
    if (typeof input.size === 'number' && input.size > 0)
        query.set('size', String(Math.min(100, Math.floor(input.size))));
    if (input.cursor?.trim())
        query.set('cursor', input.cursor.trim());
    const qs = query.toString();
    const data = await fetchApiData(`${baseUrl}/api/social/post/${encodeURIComponent(pinId)}/comments${qs ? `?${qs}` : ''}`, fetchImpl, timeoutMs);
    return normalizeCommentPage(data);
}
