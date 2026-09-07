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
export declare const DEFAULT_QA_RECALL_BASE_URL = "https://so.metaid.io";
/** Production wiring override: METABOT_METAWEB_API_BASE_URL (shared with metaweb search/pin read). */
export declare const QA_RECALL_BASE_URL_ENV = "METABOT_METAWEB_API_BASE_URL";
export type QaPublisher = {
    globalMetaId: string;
    metaId: string;
    name: string;
    avatar: string;
};
export type QaTopAnswer = {
    pinId: string;
    summary: string;
    publisher: QaPublisher;
    createdAt: number;
    likeCount: number;
    dislikeCount: number;
    score: number;
};
export type QaQuestionItem = {
    pinId: string;
    currentPinId: string;
    chainName: string;
    title: string;
    /** First ~200 runes of the markdown-stripped question content; "" when absent. */
    summary: string;
    tags: string[];
    contentType: string;
    publisher: QaPublisher;
    /** Unix seconds (block/relay time — the protocol carries no timestamp). */
    createdAt: number;
    isMempool: boolean;
    likeCount: number;
    dislikeCount: number;
    commentCount: number;
    answerCount: number;
    topAnswer: QaTopAnswer | null;
    /** Search surfaces only. */
    score?: number;
    /** Hot-sorted feed items only. */
    hotScore?: number;
};
export type QaAnswerItem = {
    pinId: string;
    currentPinId: string;
    questionPinId: string;
    chainName: string;
    /** First ~200 runes of the answer body — full bodies via read_metaweb_pin. */
    summary: string;
    tags: string[];
    publisher: QaPublisher;
    createdAt: number;
    isMempool: boolean;
    likeCount: number;
    dislikeCount: number;
    commentCount: number;
    score: number;
};
export type QaQuestionPage = {
    items: QaQuestionItem[];
    nextCursor: string | null;
    hasMore: boolean;
};
export type QaAnswerPage = {
    items: QaAnswerItem[];
    nextCursor: string | null;
    hasMore: boolean;
};
export type QaQuestionDetail = {
    question: QaQuestionItem;
    answers: QaAnswerItem[];
    nextCursor: string | null;
    hasMore: boolean;
};
export declare class QaRecallNotFoundError extends Error {
    constructor(message: string);
}
export type QaRecallServiceOptions = {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
};
/** GET /api/qa/search — keyword search over questions (matched-question aggregation). */
export declare function qaSearch(params: {
    q: string;
    tags?: string[];
    publisher?: string;
    answered?: boolean;
    sort?: 'relevance' | 'newest';
    size?: number;
    cursor?: string;
}, options?: QaRecallServiceOptions): Promise<QaQuestionPage>;
/** GET /api/qa/questions — latest-questions feed (maxAnswers=0 = unanswered). */
export declare function qaLatestQuestions(params: {
    tags?: string[];
    minAnswers?: number;
    maxAnswers?: number;
    sort?: 'newest' | 'hot';
    size?: number;
    cursor?: string;
}, options?: QaRecallServiceOptions): Promise<QaQuestionPage>;
/** GET /api/qa/questions/:pinId — question detail with the first ranked answer page. */
export declare function qaQuestionDetail(pinId: string, options?: QaRecallServiceOptions): Promise<QaQuestionDetail>;
/** GET /api/qa/questions/:pinId/answers — ranked answers, optionally by one publisher. */
export declare function qaQuestionAnswers(input: {
    pinId: string;
    publisher?: string;
    size?: number;
    cursor?: string;
}, options?: QaRecallServiceOptions): Promise<QaAnswerPage>;
