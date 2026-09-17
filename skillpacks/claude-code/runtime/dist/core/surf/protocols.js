"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SURF_PROTOCOLS = exports.applyFreshWindowFilter = exports.sinceFiltered = void 0;
exports.createSurfProtocols = createSurfProtocols;
/**
 * MetaWeb surf protocol registry. OAC port of the IDBots surfProtocols.
 *
 * One descriptor per surfable chain protocol: how to fetch fresh items since
 * the bot's watermark (or continue a registered backlog page), how to search
 * old items, which interactions the bot may perform, and a relevance hint
 * rendered into the surf prompt. Adding support for a future protocol means
 * adding one descriptor here — the surf loop itself never hard-codes
 * protocol behavior.
 *
 * Stage-0 fresh fetches are backed by the metaso-p2p "surf reads" API
 * (surf/surfReads.ts, R1): deterministic total order, inclusive `since`,
 * gap-free cursor paging, byte-identical dedupe and per-author throttling.
 * agentpedia is NOT indexed server-side and stays on the MANAPI path-list
 * client.
 */
const recall_js_1 = require("../qanda/recall.js");
const search_js_1 = require("../metaweb/search.js");
const manapiPins_js_1 = require("./manapiPins.js");
const surfReads_js_1 = require("./surfReads.js");
const socialRecall_js_1 = require("./socialRecall.js");
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/** contentSummary is truncated server-side and may not parse; best-effort. */
function extractJsonField(raw, field) {
    if (!raw)
        return '';
    try {
        const parsed = JSON.parse(raw);
        return text(parsed?.[field]);
    }
    catch {
        const match = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(raw);
        if (!match)
            return '';
        try {
            return JSON.parse(`"${match[1]}"`);
        }
        catch {
            return match[1];
        }
    }
}
const fromSocialPost = (item) => ({
    pinId: item.currentPinId || item.pinId,
    protocolKey: 'simplebuzz',
    chainName: item.chainName || 'mvc',
    title: '',
    summary: (item.payload?.content ?? '').slice(0, 280),
    authorName: '',
    authorGlobalMetaId: item.author.globalMetaId,
    createdAt: item.createdAt,
    likeCount: item.likeCount,
    commentCount: item.commentCount,
    extra: item.quoteCount > 0 ? `${item.quoteCount} quotes` : null,
});
const fromSearchItem = (item, protocolKey) => ({
    pinId: item.currentPinId || item.pinId,
    protocolKey,
    chainName: item.chainName || 'mvc',
    title: item.title,
    summary: item.summary,
    authorName: item.publisher.name,
    authorGlobalMetaId: item.publisher.globalMetaId,
    createdAt: item.createdAt,
    likeCount: null,
    commentCount: null,
    extra: null,
});
const fromQaQuestion = (item) => ({
    pinId: item.currentPinId || item.pinId,
    protocolKey: 'simplequestion',
    chainName: item.chainName || 'mvc',
    title: item.title,
    summary: item.summary,
    authorName: item.publisher.name,
    authorGlobalMetaId: item.publisher.globalMetaId,
    createdAt: item.createdAt,
    likeCount: item.likeCount,
    commentCount: item.commentCount,
    extra: item.answerCount > 0
        ? `${item.answerCount} answers`
        : 'unanswered',
});
const fromManapiItem = (item, protocolKey) => {
    const title = extractJsonField(item.contentSummary, 'title');
    const content = extractJsonField(item.contentSummary, 'content');
    const slug = extractJsonField(item.contentSummary, 'slug');
    return {
        pinId: item.pinId,
        protocolKey,
        chainName: 'mvc',
        title,
        summary: (content || item.contentSummary).slice(0, 280),
        authorName: '',
        authorGlobalMetaId: item.globalMetaId,
        createdAt: item.timestamp || item.seenTime,
        likeCount: null,
        commentCount: null,
        extra: slug ? `entry: ${slug}` : null,
    };
};
/** R1 fresh-feed item → SurfItem. `protocolKey` buckets the item (answers map onto their question section). */
const fromFreshItem = (item, protocolKey) => {
    const base = {
        pinId: item.currentPinId || item.pinId,
        protocolKey,
        chainName: item.chainName || 'mvc',
        title: item.title,
        summary: item.summary,
        authorName: item.author.name,
        authorGlobalMetaId: item.author.globalMetaId,
        createdAt: item.createdAt,
        likeCount: item.likeCount,
        commentCount: item.commentCount,
        extra: null,
    };
    return withDuplicatesExtra(base, item.duplicates ?? null);
};
/**
 * R1 dedupe=identical collapses byte-identical copies onto the newest one;
 * surface the collapse count so the bot knows the chain echoed this content.
 */
const withDuplicatesExtra = (item, duplicates) => {
    if (!duplicates || duplicates <= 1)
        return item;
    const copies = `×${duplicates} copies`;
    return {
        ...item,
        duplicates,
        extra: item.extra ? `${item.extra}, ${copies}` : copies,
    };
};
/**
 * Freshness filter for fetchFresh implementations. `>=` (not `>`): a pin
 * created in the SAME second as the previous watermark must come back on the
 * next run — the seen ledger dedupes anything already presented, so the
 * boundary second costs one re-fetch at most, while a strict `>` skipped
 * same-second stragglers forever (IDBots review 2, item 2). R1's server-side
 * `since` is already inclusive; this is the belt-and-braces client-side layer.
 */
const sinceFiltered = (items, sinceTs, limit) => items
    .filter((item) => item.pinId && (sinceTs === null || item.createdAt >= sinceTs))
    .slice(0, limit);
exports.sinceFiltered = sinceFiltered;
/**
 * Backlog-window split for the client-side freshness filter. A BACKLOG page
 * is resumed by the server cursor ALONE: its items are OLDER than the
 * watermark by construction, so the sinceTs filter must NOT run on them —
 * it would drop every backlog item while the cursor still advances, paging
 * past unseen content forever (the exact silent-loss class the backlog
 * mechanism exists to fix). Window pages keep the >= belt-and-braces filter.
 */
const applyFreshWindowFilter = (items, sinceTs, limit, isBacklog) => isBacklog
    ? items.filter((item) => item.pinId).slice(0, limit)
    : (0, exports.sinceFiltered)(items, sinceTs, limit);
exports.applyFreshWindowFilter = applyFreshWindowFilter;
/**
 * Backlog-window split for the R1-backed descriptors: a backlog page is
 * resumed by cursor ALONE — sending `since` alongside would filter out every
 * backlog item (they are older than the watermark server-side).
 */
const freshWindowArgs = (sinceTs, backlogCursor) => backlogCursor
    ? { cursor: backlogCursor }
    : { since: sinceTs ?? undefined };
/** Build the default registry; `options.baseUrl` overrides the aggregation base. */
function createSurfProtocols(options = {}) {
    const readsOptions = options.baseUrl ? { baseUrl: options.baseUrl } : undefined;
    const simplebuzz = {
        key: 'simplebuzz',
        displayName: 'Buzz (on-chain microblog)',
        paths: ['/protocols/simplebuzz'],
        interactions: ['like', 'comment'],
        relevanceHint: 'Short posts. Save the ones that teach something about your role or goals; ' +
            'like genuinely good content; comment only when you have something real to add.',
        fetchFresh: async ({ sinceTs, limit, backlogCursor }) => {
            // maxPerAuthor throttles feed-flooding repost chains; dedupe collapses
            // byte-identical echoes (both reported back in `suppressed`).
            const page = await (0, surfReads_js_1.metawebFresh)({
                protocols: ['simplebuzz'],
                size: limit,
                dedupe: 'identical',
                maxPerAuthor: 3,
                ...freshWindowArgs(sinceTs, backlogCursor),
            }, readsOptions);
            return {
                items: (0, exports.applyFreshWindowFilter)(page.items.map((item) => fromFreshItem(item, 'simplebuzz')), sinceTs, limit, backlogCursor != null),
                hasMore: page.hasMore,
                nextCursor: page.nextCursor,
            };
        },
        search: async ({ query, limit }) => {
            const page = await (0, socialRecall_js_1.getSocialFeed)({ keyword: query, size: limit, sort: 'newest' }, readsOptions);
            return page.items.map(fromSocialPost).slice(0, limit);
        },
    };
    const simplenote = {
        key: 'simplenote',
        displayName: 'SimpleNote (on-chain blog)',
        paths: ['/protocols/simplenote'],
        interactions: ['like', 'comment'],
        relevanceHint: 'Long-form articles. Your main learning source: save articles that deepen ' +
            'your professional knowledge, distill key points into your knowledge store.',
        fetchFresh: async ({ sinceTs, limit, backlogCursor }) => {
            // NO maxPerAuthor here: throttling could hide legit long-form authors
            // who published several articles inside one window.
            const page = await (0, surfReads_js_1.metawebFresh)({
                protocols: ['simplenote'],
                size: limit,
                dedupe: 'identical',
                ...freshWindowArgs(sinceTs, backlogCursor),
            }, readsOptions);
            return {
                items: (0, exports.applyFreshWindowFilter)(page.items.map((item) => fromFreshItem(item, 'simplenote')), sinceTs, limit, backlogCursor != null),
                hasMore: page.hasMore,
                nextCursor: page.nextCursor,
            };
        },
        search: async ({ query, limit }) => {
            const page = await (0, search_js_1.searchMetaweb)({ q: query, protocols: ['simplenote'], size: limit }, readsOptions);
            return page.items.map((item) => fromSearchItem(item, 'simplenote')).slice(0, limit);
        },
    };
    const simplequestion = {
        key: 'simplequestion',
        displayName: 'Q&A (on-chain Quora)',
        paths: ['/protocols/simplequestion', '/protocols/simpleanswer'],
        interactions: ['like', 'answer', 'ask', 'comment'],
        relevanceHint: 'Community questions. Answer only questions squarely inside your role and ' +
            'expertise, with genuinely helpful answers; like good answers from others; ' +
            'ask a question yourself only when you truly need help.',
        fetchFresh: async ({ sinceTs, limit, backlogCursor }) => {
            // R1 serves fresh QUESTIONS and ANSWERS in one feed — answers to old
            // questions now surface in this section the night they land (the old
            // qaLatestQuestions feed only carried questions, so every answer was
            // invisible until the inbox workaround polled for it).
            const page = await (0, surfReads_js_1.metawebFresh)({
                protocols: ['simplequestion', 'simpleanswer'],
                size: limit,
                ...freshWindowArgs(sinceTs, backlogCursor),
            }, readsOptions);
            const items = page.items.map((item) => {
                if (item.protocol === 'simpleanswer') {
                    const answer = fromFreshItem(item, 'simplequestion');
                    return { ...answer, extra: 'new answer' };
                }
                // R1 carries no answerCount — question items get no extra.
                return fromFreshItem(item, 'simplequestion');
            });
            return {
                items: (0, exports.applyFreshWindowFilter)(items, sinceTs, limit, backlogCursor != null),
                hasMore: page.hasMore,
                nextCursor: page.nextCursor,
            };
        },
        search: async ({ query, limit }) => {
            const page = await (0, recall_js_1.qaSearch)({ q: query, size: limit }, readsOptions);
            return page.items.map(fromQaQuestion).slice(0, limit);
        },
    };
    const agentpedia = {
        key: 'agentpedia',
        displayName: 'Agentpedia (on-chain encyclopedia)',
        paths: ['/protocols/agentpedia/rev'],
        interactions: ['challenge'],
        relevanceHint: 'The shared encyclopedia bots reach consensus from. Learn entries related ' +
            'to your role. Conservative mode: only challenge an entry when you are ' +
            'confident it is factually wrong — never for style or wording.',
        // agentpedia is NOT indexed by the surf-reads backend; this stays on the
        // MANAPI path list, which has no paging cursor — the window is what it is.
        fetchFresh: async ({ sinceTs, limit }) => {
            const page = await (0, manapiPins_js_1.listPinsByPath)({ path: '/protocols/agentpedia/rev', size: limit });
            return {
                items: (0, exports.sinceFiltered)(page.items.map((item) => fromManapiItem(item, 'agentpedia')), sinceTs, limit),
                hasMore: false,
                nextCursor: null,
            };
        },
    };
    return [simplebuzz, simplenote, simplequestion, agentpedia];
}
/** Default registry with production base URLs. */
exports.DEFAULT_SURF_PROTOCOLS = createSurfProtocols();
