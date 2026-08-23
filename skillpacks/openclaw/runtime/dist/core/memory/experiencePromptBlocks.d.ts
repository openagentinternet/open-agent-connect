export declare const RECENT_SUMMARIES_PROMPT_DAYS = 7;
export declare const RECENT_SUMMARIES_MAX_CHARS = 2000;
export declare const RECALL_WARM_DAYS = 30;
export declare const RECALL_MAX_LIMIT = 30;
export interface ExperienceSummarySessionRef {
    sessionId: string;
    title: string;
}
export interface ExperienceSummaryLike {
    summaryDate: string;
    summaryText: string;
    sessionRefs?: ExperienceSummarySessionRef[];
}
/** Local-calendar YYYY-MM-DD (dream dates are local-day anchored). */
export declare function formatLocalDate(date: Date): string;
/**
 * The bot's own dream-written "who am I" entry. Present in every context
 * (local UI and A2A) — it describes the bot itself, not the user, so it does
 * not fall under the external-channel owner-memory privacy block.
 */
export declare function buildSelfIdentityBlock(identityText: string): string;
/**
 * The bot's self-grown code of conduct: abstract value boundaries distilled
 * from its own experiences during nightly dreams. Injected so they actively
 * constrain behavior, not just sit in storage.
 */
export declare function buildValueBoundariesBlock(entries: Array<{
    text: string;
}>, maxItems?: number): string;
/**
 * Past work reviews written by the dream service — including the owner's
 * acceptance ratings and review comments on group tasks — injected so prior
 * feedback actively guides new work instead of sitting in storage.
 */
export declare function buildWorkReviewsBlock(entries: Array<{
    text: string;
}>, maxItems?: number): string;
/**
 * Hot layer: the bot's last few days of dream summaries, newest first,
 * oldest dropped when over the char budget.
 */
export declare function buildRecentDailySummariesBlock(summaries: ExperienceSummaryLike[], maxChars?: number): string;
export declare function buildExperiencePromptBlocksXml(input: {
    identityText?: string | null;
    summaries: ExperienceSummaryLike[];
    valueBoundaries?: Array<{
        text: string;
    }>;
    workReviews?: Array<{
        text: string;
    }>;
    maxChars?: number;
}): string;
export type ExperienceRecallGranularity = 'day' | 'week' | 'month';
export interface ExperienceRecallArgs {
    query?: string;
    date_from?: string;
    date_to?: string;
    /** Group results by day (default), ISO week, or month — compresses long ranges. */
    granularity?: ExperienceRecallGranularity;
    limit?: number;
}
/**
 * Warm/cold defaults for the recall path: a bare call looks back
 * RECALL_WARM_DAYS (warm); a keyword query searches the full history (cold),
 * unless the caller pins explicit dates. Args use the tool schema's
 * snake_case names; the result is normalized to camelCase.
 */
export declare function resolveExperienceRecallQuery(args: ExperienceRecallArgs, today?: Date): {
    query?: string;
    dateFrom?: string;
    dateTo?: string;
    granularity: ExperienceRecallGranularity;
    limit: number;
};
/** Plain-text rendering of recall results for the tool response. */
export declare function formatExperienceRecallResults(summaries: ExperienceSummaryLike[], granularity?: ExperienceRecallGranularity): string;
/**
 * Raw-episode fallback for date ranges that have no dream summary yet (the bot
 * was off, or dreaming was enabled late). Rendered as a compact timeline of
 * episode titles so the time-anchored recall is never blind for un-dreamed
 * days. Episodes are the shared fact source, so this adds no duplication.
 */
export declare function formatExperienceTimelineFallback(input: {
    dateFrom?: string;
    dateTo?: string;
    episodes: Array<{
        startedAt: number;
        sourceChannel: string;
        episodeType: string;
        title?: string | null;
    }>;
}): string;
