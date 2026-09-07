"use strict";
/**
 * Thin client for the MetaWeb Q&A APIs (so.metaid.io /api/qa/*): question
 * search, latest-questions feed, question detail with ranked answers, and the
 * publisher-filtered answer list. OAC port of the IDBots feat/metaweb-qa
 * qaRecallService. Same conventions as the metaweb search family: {code,
 * data, message} envelope, HTTP always 200, business error codes
 * 40000/40400/50000, opaque cursors, no auth.
 *
 * Wire facts worth remembering (mirror of the indexer contract):
 * - Answers are ranked by score = likeCount − dislikeCount, tie newer first.
 * - List/search surfaces return SUMMARIES only; full bodies stay behind the
 *   generic pin read (GET /api/metaweb/pin/:pinId).
 * - Block time is authoritative (createdAt, unix seconds); mempool pins are
 *   indexed with isMempool: true and replaced on confirmation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.QaRecallNotFoundError = exports.QA_RECALL_BASE_URL_ENV = exports.DEFAULT_QA_RECALL_BASE_URL = void 0;
exports.qaSearch = qaSearch;
exports.qaLatestQuestions = qaLatestQuestions;
exports.qaQuestionDetail = qaQuestionDetail;
exports.qaQuestionAnswers = qaQuestionAnswers;
exports.DEFAULT_QA_RECALL_BASE_URL = 'https://so.metaid.io';
/** Production wiring override: METABOT_METAWEB_API_BASE_URL (shared with metaweb search/pin read). */
exports.QA_RECALL_BASE_URL_ENV = 'METABOT_METAWEB_API_BASE_URL';
const DEFAULT_TIMEOUT_MS = 10_000;
class QaRecallNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'QaRecallNotFoundError';
    }
}
exports.QaRecallNotFoundError = QaRecallNotFoundError;
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function textList(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}
function num(value) {
    return Number(value) || 0;
}
function normalizePublisher(raw) {
    const record = raw && typeof raw === 'object' ? raw : {};
    return {
        globalMetaId: text(record.globalMetaId),
        metaId: text(record.metaId),
        name: text(record.name),
        avatar: text(record.avatar),
    };
}
function normalizeTopAnswer(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const record = raw;
    const pinId = text(record.pinId);
    if (!pinId)
        return null;
    return {
        pinId,
        summary: text(record.summary),
        publisher: normalizePublisher(record.publisher),
        createdAt: num(record.createdAt),
        likeCount: num(record.likeCount),
        dislikeCount: num(record.dislikeCount),
        score: num(record.score),
    };
}
function normalizeQuestion(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        pinId: text(record.pinId),
        currentPinId: text(record.currentPinId),
        chainName: text(record.chainName),
        title: text(record.title),
        summary: text(record.summary),
        tags: textList(record.tags),
        contentType: text(record.contentType),
        publisher: normalizePublisher(record.publisher),
        createdAt: num(record.createdAt),
        isMempool: record.isMempool === true,
        likeCount: num(record.likeCount),
        dislikeCount: num(record.dislikeCount),
        commentCount: num(record.commentCount),
        answerCount: num(record.answerCount),
        topAnswer: normalizeTopAnswer(record.topAnswer),
        score: typeof record.score === 'number' ? record.score : undefined,
        hotScore: typeof record.hotScore === 'number' ? record.hotScore : undefined,
    };
}
function normalizeAnswer(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        pinId: text(record.pinId),
        currentPinId: text(record.currentPinId),
        questionPinId: text(record.questionPinId),
        chainName: text(record.chainName),
        summary: text(record.summary),
        tags: textList(record.tags),
        publisher: normalizePublisher(record.publisher),
        createdAt: num(record.createdAt),
        isMempool: record.isMempool === true,
        likeCount: num(record.likeCount),
        dislikeCount: num(record.dislikeCount),
        commentCount: num(record.commentCount),
        score: num(record.score),
    };
}
function normalizeQuestionPage(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        items: Array.isArray(record.items) ? record.items.map(normalizeQuestion) : [],
        nextCursor: text(record.nextCursor) || null,
        hasMore: record.hasMore === true,
    };
}
function normalizeAnswerPage(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        items: Array.isArray(record.items) ? record.items.map(normalizeAnswer) : [],
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
            throw new Error(`Q&A API returned an invalid response (HTTP ${response.status}).`);
        }
        const code = Number(body.code);
        if (code === 0) {
            return (body.data && typeof body.data === 'object' ? body.data : {});
        }
        const message = text(body.message) || 'unknown error';
        if (code === 40400) {
            throw new QaRecallNotFoundError(message);
        }
        throw new Error(`Q&A API error ${code}: ${message}`);
    }
    finally {
        clearTimeout(timer);
    }
}
function resolveOptions(options) {
    const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('A fetch implementation is required for the Q&A API.');
    }
    return {
        baseUrl: (options?.baseUrl ?? exports.DEFAULT_QA_RECALL_BASE_URL).replace(/\/+$/, ''),
        fetchImpl,
        timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
}
function sizeParam(size, max) {
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 1)
        return undefined;
    return String(Math.min(max, Math.floor(size)));
}
/** GET /api/qa/search — keyword search over questions (matched-question aggregation). */
async function qaSearch(params, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const q = params.q.trim();
    if (!q)
        throw new Error('q is required for Q&A search.');
    const query = new URLSearchParams({ q });
    const tags = (params.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
    if (tags.length)
        query.set('tags', tags.join(','));
    if (params.publisher?.trim())
        query.set('publisher', params.publisher.trim());
    if (params.answered === true)
        query.set('answered', 'true');
    if (params.answered === false)
        query.set('answered', 'false');
    if (params.sort === 'newest')
        query.set('sort', 'newest');
    const size = sizeParam(params.size, 50);
    if (size)
        query.set('size', size);
    if (params.cursor?.trim())
        query.set('cursor', params.cursor.trim());
    const data = await fetchApiData(`${baseUrl}/api/qa/search?${query.toString()}`, fetchImpl, timeoutMs);
    return normalizeQuestionPage(data);
}
/** GET /api/qa/questions — latest-questions feed (maxAnswers=0 = unanswered). */
async function qaLatestQuestions(params, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const query = new URLSearchParams();
    const tags = (params.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
    if (tags.length)
        query.set('tags', tags.join(','));
    if (typeof params.minAnswers === 'number' && params.minAnswers >= 0) {
        query.set('minAnswers', String(Math.floor(params.minAnswers)));
    }
    if (typeof params.maxAnswers === 'number' && params.maxAnswers >= 0) {
        query.set('maxAnswers', String(Math.floor(params.maxAnswers)));
    }
    if (params.sort === 'hot')
        query.set('sort', 'hot');
    const size = sizeParam(params.size, 50);
    if (size)
        query.set('size', size);
    if (params.cursor?.trim())
        query.set('cursor', params.cursor.trim());
    const qs = query.toString();
    const data = await fetchApiData(`${baseUrl}/api/qa/questions${qs ? `?${qs}` : ''}`, fetchImpl, timeoutMs);
    return normalizeQuestionPage(data);
}
/** GET /api/qa/questions/:pinId — question detail with the first ranked answer page. */
async function qaQuestionDetail(pinId, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const trimmed = pinId.trim();
    if (!trimmed)
        throw new Error('pinId is required to fetch a Q&A question.');
    const data = await fetchApiData(`${baseUrl}/api/qa/questions/${encodeURIComponent(trimmed)}`, fetchImpl, timeoutMs);
    const record = (data && typeof data === 'object' ? data : {});
    return {
        question: normalizeQuestion(record.question),
        answers: Array.isArray(record.answers) ? record.answers.map(normalizeAnswer) : [],
        nextCursor: text(record.nextCursor) || null,
        hasMore: record.hasMore === true,
    };
}
/** GET /api/qa/questions/:pinId/answers — ranked answers, optionally by one publisher. */
async function qaQuestionAnswers(input, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const pinId = input.pinId.trim();
    if (!pinId)
        throw new Error('pinId is required to list Q&A answers.');
    const query = new URLSearchParams();
    if (input.publisher?.trim())
        query.set('publisher', input.publisher.trim());
    const size = sizeParam(input.size, 50);
    if (size)
        query.set('size', size);
    if (input.cursor?.trim())
        query.set('cursor', input.cursor.trim());
    const qs = query.toString();
    const data = await fetchApiData(`${baseUrl}/api/qa/questions/${encodeURIComponent(pinId)}/answers${qs ? `?${qs}` : ''}`, fetchImpl, timeoutMs);
    return normalizeAnswerPage(data);
}
