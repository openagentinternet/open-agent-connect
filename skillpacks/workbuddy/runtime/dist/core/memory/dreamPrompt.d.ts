import type { DreamDayActivity } from './dreamStore';
import type { DreamActivityChunk } from './dreamFragments';
export declare const DREAM_LOOKBACK_DAYS = 7;
/** Retry failed dream runs with bounded exponential backoff instead of
 * abandoning a date after a short burst of transient failures. */
export declare const DREAM_RETRY_BASE_DELAY_MS: number;
export declare const DREAM_RETRY_MAX_DELAY_MS: number;
/** Nightly dream window: [00:00, 06:00) local time. */
export declare const DREAM_WINDOW_END_MINUTES: number;
/** Default activity input budget for a day-level prompt, measured in tokens. */
export declare const DREAM_ACTIVITY_DEFAULT_TOKEN_BUDGET = 48000;
export declare const SELF_IDENTITY_MIN_CHARS = 200;
export declare const MAX_WORK_REVIEWS = 5;
export declare const MAX_IMPORTANT_MEMORIES = 5;
export declare const MAX_VALUE_LESSONS = 3;
export declare const MAX_IMPRESSION_UPDATES = 20;
export declare const MAX_KNOWLEDGE_UPDATES = 6;
/** Dream algorithm version, recorded on every run. Bump it on any change to the
 * prompt, budgeting, stats or write semantics — completed in-window dates with
 * an older version are then re-dreamed automatically (limited per night).
 * The file-backed port restarts versioning at 1; 2 adds the chain-history
 * sections (own writes + full reads) to the prompt, stats and token estimate. */
export declare const DREAM_VERSION = 2;
declare const DREAM_SECTION_KEYS: readonly ["human", "a2a", "orders", "tasks", "group_tasks"];
export type DreamSectionKey = (typeof DREAM_SECTION_KEYS)[number];
/**
 * Relationship-temperature trajectory of a conversation, judged from tone,
 * reply length and initiative shifts across the whole exchange — never from
 * literal "满意/不满意" keywords. warming = the exchange got more genuine,
 * useful and trusting; cooling = the counterparty grew colder, so the bot's
 * behavior pattern needs adjustment.
 */
export type DreamWorkReviewEvaluation = 'warming' | 'stable' | 'cooling';
export interface DreamWorkReview {
    subject: string;
    counterparty: string;
    evaluation: DreamWorkReviewEvaluation;
    note: string;
}
/**
 * An abstract, paradigm-level rule distilled from the day's experiences
 * ("在涉及个人痛苦的话题上要更谨慎", not "我不该说那句话"). `source` names
 * the concrete experience the rule was distilled from.
 */
export interface DreamValueLesson {
    rule: string;
    source: string;
}
export interface DreamImpressionPromptEvidence {
    id: string;
    evidenceType: string;
    pinId: string | null;
    publisherGlobalMetaID: string | null;
    occurredAt: number;
}
export interface DreamImpressionPromptSubject {
    subjectGlobalMetaID: string;
    episodeIds: string[];
    evidenceIds: string[];
    interactionCount: number;
    directInteractionCount: number;
    evidence: DreamImpressionPromptEvidence[];
    previousSnapshot?: {
        summaryText: string;
        styleDescriptors: string[];
        cooperationContext: string | null;
        relationshipTemperature: string | null;
        communicationGuidance: string | null;
        uncertaintyText: string | null;
    } | null;
}
export interface DreamImpressionUpdate {
    subjectGlobalMetaId: string;
    episodeIds: string[];
    evidenceIds: string[];
    observation: string;
    interpretation: string;
    dimensions: Record<string, unknown>;
    communicationGuidance: string | null;
    confidence: Record<string, unknown>;
}
/**
 * A reusable knowledge point distilled from the day — forward-looking, the
 * kind of know-how or pitfall the bot believes will help (or warn) a future
 * task. `topic` drives create-vs-revise: reusing an existing topic's exact
 * wording rewrites it; a fresh topic creates a new entry. `kind` keeps
 * pitfalls/anti-patterns first-class alongside positive know-how.
 */
export interface DreamKnowledgeUpdate {
    topic: string;
    summary: string;
    kind: 'know_how' | 'pitfall' | 'principle';
    category?: string | null;
    episodeIds?: string[];
    evidenceIds?: string[];
}
/** Compact view of an existing knowledge entry handed to the dream prompt. */
export interface DreamKnowledgeExisting {
    topic: string;
    summary: string;
    kind: 'know_how' | 'pitfall' | 'principle';
    category?: string | null;
    version: number;
}
export interface DreamOutput {
    dailySummary: string;
    sections: Partial<Record<DreamSectionKey, string>>;
    workReviews: DreamWorkReview[];
    importantMemories: string[];
    valueLessons: DreamValueLesson[];
    selfIdentity: string | null;
    impressionUpdates: DreamImpressionUpdate[];
    knowledgeUpdates: DreamKnowledgeUpdate[];
}
export type DreamParseResult = {
    ok: true;
    output: DreamOutput;
} | {
    ok: false;
    error: string;
};
export interface DreamRunStateLike {
    status: 'running' | 'completed' | 'failed';
    attemptCount: number;
    /** Run start (epoch ms). A completed run is final only when it started after
     * the dream date ended — i.e. it reviewed the whole day. */
    startedAt: number;
    /** Algorithm version the run was made with (0 = legacy, pre-versioning). */
    dreamVersion: number;
}
export interface DreamDueResult {
    /** Dates needing a dream run, chronological-ascending (oldest first). */
    dueDates: string[];
    /** Completed full-day dates whose algorithm version is stale, newest first
     * (recent days are recalled most, so they are repaired first). */
    repairDates: string[];
}
/** Deterministic per-bot offset inside the dream window, 00:00 + [0, 240) minutes. */
export declare function computeDreamStaggerMinute(seed: number): number;
/** Stable stagger seed for a profile slug (replaces the integer metabot id). */
export declare function dreamStaggerSeedForSlug(slug: string): number;
export declare function countNonWhitespaceChars(text: string): number;
export declare function validateSelfIdentity(text?: string | null): {
    valid: boolean;
    charCount: number;
};
export declare function computeDreamRetryDelayMs(attemptCount: number): number;
/**
 * Which past dates still need dream attention for this bot.
 * - Candidates: the last `lookbackDays` calendar days, today excluded.
 * - Yesterday's first attempt runs inside the nightly window after the bot's
 *   staggered minute; when the window was missed (app off or asleep
 *   overnight) it is caught up at any time of day instead of waiting for the
 *   next night. Older missed dates and failed retries are due any time once
 *   their backoff expires.
 * - Running dates are skipped; failed dates retry after bounded exponential
 *   backoff, so a transient provider failure does not exhaust the date after
 *   a few tightly grouped attempts.
 * - A completed run is *final* only when it started after the dream date
 *   ended (it covered the whole day). A non-final run — e.g. triggered
 *   manually mid-day — is due again in the next eligible window.
 * - Final completed runs on a stale algorithm version become repair dates
 *   (window-gated; the caller limits how many run per night).
 */
export declare function computeDueDreamDates(input: {
    now: Date;
    staggerSeed: number;
    runStates: Map<string, DreamRunStateLike>;
    lookbackDays?: number;
    dreamVersion?: number;
}): DreamDueResult;
/** Local day [startMs, endMs) bounds for a YYYY-MM-DD string. */
export declare function getDayBoundsMs(dateStr: string): {
    startMs: number;
    endMs: number;
};
export declare function buildDreamPrompt(input: {
    botName: string;
    role?: string | null;
    soul?: string | null;
    date: string;
    activity: DreamDayActivity;
    activityTokenBudget?: number;
    sourceMode?: 'raw_activity' | 'fragment_summaries' | 'fragment';
    impressionSubjects?: DreamImpressionPromptSubject[];
    existingKnowledge?: DreamKnowledgeExisting[];
}): {
    system: string;
    user: string;
};
export declare function buildDreamFragmentPrompt(input: {
    botName: string;
    role?: string | null;
    soul?: string | null;
    date: string;
    chunk: DreamActivityChunk;
}): {
    system: string;
    user: string;
};
/**
 * Tolerant parse of the dream LLM output: strips code fences, takes the
 * outermost brace span, and normalizes into DreamOutput. Fails when there is
 * no usable JSON object or daily_summary is missing.
 */
export declare function parseDreamOutput(raw: string): DreamParseResult;
export {};
