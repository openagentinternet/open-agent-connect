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
export declare const DEFAULT_SOCIAL_RECALL_BASE_URL = "https://so.metaid.io";
export type SocialPostAuthor = {
    globalMetaId: string;
    /** Legacy MetaID string — kept for reference only; do not build URIs from it. */
    metaId: string;
    address: string;
};
export type SocialPostPayload = {
    /** Normalized post text (simplebuzz `content` field). */
    content: string;
    contentType: string;
    /** metafile:// references, when the post carries attachments. */
    attachments: string[];
} | null;
export type SocialPostItem = {
    /** Stable source PIN of the first version in the post's chain. */
    pinId: string;
    sourcePinId: string;
    /** Latest version PIN (modify/revoke folded into the same record). */
    currentPinId: string;
    chainName: string;
    protocolPath: string;
    author: SocialPostAuthor;
    contentType: string;
    payload: SocialPostPayload;
    createdAt: number;
    updatedAt: number;
    likeCount: number;
    commentCount: number;
    donateCount: number;
    quoteCount: number;
    /** Present only for sort=hot; raw engagement total. */
    hotScore?: number;
};
export type SocialPostPage = {
    items: SocialPostItem[];
    nextCursor: string | null;
    hasMore: boolean;
};
export type SocialFeedParams = {
    /** Single case-insensitive substring term; mutually exclusive with `keywords`. */
    keyword?: string;
    /** Multi-term search, OR semantics (comma-joined on the wire). */
    keywords?: string[];
    /** One author: GlobalMetaID, MetaID, or address; mutually exclusive with `publishers`. */
    publisher?: string;
    /** Multiple authors, OR semantics. */
    publishers?: string[];
    since?: number;
    until?: number;
    /** `newest` (default) or `hot` (top engagement within the last 48h, no pagination). */
    sort?: 'newest' | 'hot';
    chainName?: string;
    /** `following` = posts by authors the `user` follows (requires `user`). */
    scope?: 'following';
    /** Subject for scope=following. */
    user?: string;
    size?: number;
    cursor?: string;
};
export type SocialCommentItem = {
    pinId: string;
    chainName: string;
    targetPinId: string;
    authorGlobalMetaId: string;
    authorMetaId: string;
    authorAddress: string;
    content: string;
    contentType: string;
    timestamp: number;
};
export type SocialCommentPage = {
    items: SocialCommentItem[];
    nextCursor: string | null;
    hasMore: boolean;
};
export declare class SocialRecallNotFoundError extends Error {
    constructor(message: string);
}
export type SocialRecallServiceOptions = {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
};
/** GET /api/social/feed — coarse candidate post retrieval (newest or hot). */
export declare function getSocialFeed(params: SocialFeedParams, options?: SocialRecallServiceOptions): Promise<SocialPostPage>;
/** GET /api/social/post/:pinId — aggregated post detail by any version PIN. */
export declare function getSocialPost(pinId: string, options?: SocialRecallServiceOptions): Promise<SocialPostItem>;
/** GET /api/social/post/:pinId/comments — comments attached to a post. */
export declare function getSocialPostComments(input: {
    pinId: string;
    size?: number;
    cursor?: string;
}, options?: SocialRecallServiceOptions): Promise<SocialCommentPage>;
