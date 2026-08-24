/**
 * Group-task staffing search (OAC port of IDBots groupTaskCandidateSearch +
 * botSearchService): one list per coarse seat. Merges local worker profiles
 * with the metaso-p2p bot staffing search (POST /api/bots/search), then
 * applies the Twin's impression sediment (capability tags + collaboration
 * facts once Phase 1 Round L lands). Match-first: local wins only as a
 * tie-break within LOCAL_TIE_MARGIN; remote rows stay marked remote; remote
 * failure degrades to local-only with a warning.
 */
import type { GroupTaskSeatRole } from './staffing';
export declare function tokenizeOpenTeamQuery(text: string): string[];
export declare function scoreOpenTeamCandidate(item: {
    name?: string;
    bio?: string;
    chatSkills?: string[];
}, tokens: string[]): number;
export declare const DEFAULT_BOT_SEARCH_BASE_URL = "https://so.metaid.io";
export declare const BOT_SEARCH_PATH = "/api/bots/search";
export declare const BOT_SEARCH_CODE_OK = 0;
export declare const BOT_SEARCH_CODE_INVALID = 1001;
export declare const BOT_SEARCH_CODE_PRESENCE_UNAVAILABLE = 1002;
export declare const BOT_SEARCH_CODE_INTERNAL = 1003;
export type BotSearchMatchReason = {
    field: string;
    token: string;
    weight: number;
};
export type BotSearchGroupTask = {
    groupId: string;
    title: string;
    goal: string;
    joinedAs: string;
    joinedAt: number;
    joinPinId: string;
    stillMember: boolean;
    messageCount: number;
    kind: string;
};
export type BotSearchCandidate = {
    globalMetaId: string;
    metaId: string;
    name: string;
    avatarId: string;
    bio: string;
    role: string;
    goal: string;
    chatSkills: string[];
    publishedSkills: string[];
    chainName: string;
    hasChatPubkey: boolean;
    hasHomepage: boolean;
    homepage: string;
    isOnline: boolean;
    lastSeenAgoSeconds: number | null;
    groupTaskCount: number;
    recentGroupTasks: BotSearchGroupTask[];
    score: number;
    matchReasons: BotSearchMatchReason[];
};
export type BotSearchPage = {
    candidates: BotSearchCandidate[];
    nextCursor: string | null;
    queriedAt: number;
};
export type BotSearchParams = {
    query?: string;
    roleHint?: string;
    skills?: string[];
    language?: 'zh' | 'en';
    onlineOnly?: boolean;
    hasChatPubkey?: boolean;
    excludeGlobalMetaIds?: string[];
    limit?: number;
    cursor?: string;
};
export declare class BotSearchError extends Error {
    readonly code: number;
    constructor(code: number, message: string);
}
export type BotSearchServiceOptions = {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
};
/** POST /api/bots/search — ranked, online-aware staffing page. */
export declare function searchBots(params: BotSearchParams, options?: BotSearchServiceOptions): Promise<BotSearchPage>;
export declare const GROUP_TASK_SEARCH_DEFAULT_LIMIT = 10;
export declare const GROUP_TASK_SEARCH_MAX_LIMIT = 20;
/** When |local − remote| is within this margin, local sorts first. */
export declare const LOCAL_TIE_MARGIN = 4;
export type CandidateImpressionVerdict = 'unknown' | 'boost' | 'demote' | 'block';
export type GroupTaskSearchMatchField = 'name' | 'chatSkills' | 'bio' | 'role' | 'goal' | 'groupTaskTitle' | 'groupTaskNote' | 'roleHint';
export interface GroupTaskSearchMatchReason {
    field: GroupTaskSearchMatchField;
    token: string;
    weight: number;
}
export interface GroupTaskSearchHistoryItem {
    groupId: string;
    title: string;
    goal: string;
    joinedAs: string;
    joinedAt: number;
    joinPinId: string;
    stillMember: boolean;
    kind: string;
}
/**
 * Minimal structural view over an impression snapshot. OAC snapshots carry
 * neither capabilityTags nor collaborationFacts until Round L sediments
 * them; absent fields degrade to verdict 'unknown'.
 */
export interface SeatImpressionSnapshot {
    capabilityTags?: string[];
    collaborationFacts?: Array<{
        title: string;
        outcome: string;
        seatRole?: string;
    }>;
}
export interface GroupTaskSearchImpression {
    priorCollaboration: boolean;
    capabilityTags: string[];
    lastFact: {
        title: string;
        outcome: string;
        seatRole?: string;
    } | null;
    verdict: CandidateImpressionVerdict;
    note: string;
}
export interface GroupTaskSeatCandidate {
    name: string;
    source: 'local' | 'remote';
    slug?: string;
    globalMetaId?: string;
    bio: string;
    role: string;
    goal: string;
    chatSkills: string[];
    publishedSkills?: string[];
    enabled?: boolean;
    isOnline?: boolean;
    lastSeenAgoSeconds?: number | null;
    groupTaskCount?: number;
    recentGroupTasks?: GroupTaskSearchHistoryItem[];
    score: number;
    rawScore: number;
    matchReasons: GroupTaskSearchMatchReason[];
    impression: GroupTaskSearchImpression;
}
export interface SearchGroupTaskSeatInput {
    query?: string;
    roleHint?: string;
    domainLabel?: string;
    skills?: string[];
    limit?: number;
}
export interface SearchGroupTaskSeatResult {
    query: string;
    roleHint: GroupTaskSeatRole | null;
    primary: GroupTaskSeatCandidate | null;
    backup: GroupTaskSeatCandidate | null;
    candidates: GroupTaskSeatCandidate[];
    blocked: GroupTaskSeatCandidate[];
    warnings: string[];
}
export interface GroupTaskCandidateSearchLocalWorker {
    slug: string;
    name: string;
    enabled: boolean;
    botType: string | null;
    globalMetaId: string | null;
    bio: string | null;
    role: string | null;
    goal: string | null;
    chatSkills: string[];
}
export interface SearchGroupTaskRemoteInput {
    query?: string;
    roleHint?: string;
    skills?: string[];
    excludeGlobalMetaIds?: string[];
    limit?: number;
}
export interface GroupTaskRemoteHit {
    globalMetaId: string;
    name: string;
    bio: string;
    role?: string;
    goal?: string;
    chatSkills: string[];
    publishedSkills?: string[];
    chainName?: string;
    isOnline?: boolean;
    lastSeenAgoSeconds?: number | null;
    score?: number;
    matchReasons?: GroupTaskSearchMatchReason[];
    groupTaskCount?: number;
    recentGroupTasks?: GroupTaskSearchHistoryItem[];
}
export interface GroupTaskCandidateSearchDeps {
    listLocalWorkers(): Promise<GroupTaskCandidateSearchLocalWorker[]>;
    getObserverGlobalMetaId(): Promise<string | null>;
    getImpressionSnapshot?(observerGlobalMetaId: string, subjectGlobalMetaId: string): Promise<SeatImpressionSnapshot | null>;
    searchRemote?(input: SearchGroupTaskRemoteInput): Promise<GroupTaskRemoteHit[]>;
    botSearch?: BotSearchServiceOptions;
}
export declare function fromBotSearchCandidate(remote: BotSearchCandidate): GroupTaskRemoteHit;
export declare function searchRemoteBotsForSeat(input: SearchGroupTaskRemoteInput, options?: BotSearchServiceOptions): Promise<GroupTaskRemoteHit[]>;
export declare function resolveSeatSearchQuery(input: SearchGroupTaskSeatInput): string;
export declare function collectMatchReasons(item: {
    name?: string;
    bio?: string;
    chatSkills?: string[];
    role?: string;
    goal?: string;
}, tokens: string[]): GroupTaskSearchMatchReason[];
export declare function scoreSeatResume(item: {
    name?: string;
    bio?: string;
    chatSkills?: string[];
    role?: string;
    goal?: string;
}, tokens: string[]): {
    score: number;
    reasons: GroupTaskSearchMatchReason[];
};
export declare function evaluateImpressionForSeat(snapshot: SeatImpressionSnapshot | null, roleHint: GroupTaskSeatRole | null): GroupTaskSearchImpression;
export declare function searchGroupTaskSeatCandidates(deps: GroupTaskCandidateSearchDeps, input?: SearchGroupTaskSeatInput): Promise<SearchGroupTaskSeatResult>;
