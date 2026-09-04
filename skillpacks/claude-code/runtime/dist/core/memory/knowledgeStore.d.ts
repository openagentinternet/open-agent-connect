import type { MetabotPaths } from '../state/paths';
export declare const KNOWLEDGE_KINDS: readonly ["know_how", "pitfall", "principle"];
export type KnowledgeKind = typeof KNOWLEDGE_KINDS[number];
export declare const KNOWLEDGE_ORIGINS: readonly ["agent", "dream", "user"];
export type KnowledgeOrigin = typeof KNOWLEDGE_ORIGINS[number];
export type KnowledgeStatus = 'active' | 'superseded' | 'archived';
export interface KnowledgeSource {
    id: string;
    episodeId: string | null;
    evidenceId: string | null;
    sessionId: string | null;
    sourceChannel: string | null;
    relevance: string | null;
    createdAt: number;
}
export interface KnowledgeRevision {
    id: string;
    version: number;
    summary: string;
    kind: KnowledgeKind;
    origin: KnowledgeOrigin;
    sourceDreamDate: string | null;
    createdAt: number;
}
export interface KnowledgeEntry {
    id: string;
    topic: string;
    topicFingerprint: string;
    summary: string;
    kind: KnowledgeKind;
    category: string | null;
    tags: string[];
    confidence: number;
    status: KnowledgeStatus;
    origin: KnowledgeOrigin;
    sourceDreamDate: string | null;
    version: number;
    sources: KnowledgeSource[];
    revisions: KnowledgeRevision[];
    createdAt: number;
    updatedAt: number;
    lastUsedAt: number | null;
}
export interface KnowledgeSourceInput {
    episodeId?: string | null;
    evidenceId?: string | null;
    sessionId?: string | null;
    sourceChannel?: string | null;
    relevance?: string | null;
}
export interface UpsertKnowledgeInput {
    id?: string;
    topic: string;
    summary: string;
    kind?: KnowledgeKind;
    category?: string | null;
    tags?: string[];
    confidence?: number;
    origin?: KnowledgeOrigin;
    sourceDreamDate?: string | null;
    /** Matching key override; derived from the topic when omitted. */
    topicFingerprint?: string;
    /** Pointers back into the shared fact source (no raw text duplicated). */
    sources?: KnowledgeSourceInput[];
}
export interface UpsertKnowledgeResult {
    entry: KnowledgeEntry;
    /** True when a brand-new entry was inserted. */
    created: boolean;
    /** True when an existing topic was revised (version bumped). */
    revised: boolean;
}
export interface ListKnowledgeOptions {
    kind?: KnowledgeKind;
    category?: string;
    status?: KnowledgeStatus | 'all';
    query?: string;
    limit?: number;
    offset?: number;
    /** Bump lastUsedAt on returned entries (recall reuse signal). */
    touchLastUsed?: boolean;
}
/** Compact active-set view handed to the dream prompt for create-vs-revise. */
export interface DreamKnowledgeView {
    id: string;
    topic: string;
    summary: string;
    kind: KnowledgeKind;
    category: string | null;
    version: number;
}
export declare function topicFingerprintOf(topic: string): string;
export interface KnowledgeStore {
    getKnowledge(id: string): Promise<KnowledgeEntry | null>;
    upsertKnowledge(input: UpsertKnowledgeInput): Promise<UpsertKnowledgeResult>;
    /** Human edit by id: rewrites in place, archiving the prior text. */
    updateKnowledge(input: {
        id: string;
        topic?: string;
        summary?: string;
        kind?: KnowledgeKind;
    }): Promise<KnowledgeEntry | null>;
    archiveKnowledge(id: string): Promise<KnowledgeEntry | null>;
    deleteKnowledge(id: string): Promise<boolean>;
    listKnowledge(options?: ListKnowledgeOptions): Promise<KnowledgeEntry[]>;
    searchKnowledge(input: {
        query?: string;
        kind?: KnowledgeKind;
        limit?: number;
        touchLastUsed?: boolean;
    }): Promise<KnowledgeEntry[]>;
    /** Compact active set handed to the dream prompt for create-vs-revise. */
    listKnowledgeForDream(limit?: number): Promise<DreamKnowledgeView[]>;
    countActive(): Promise<number>;
    /** Hygiene: per entry keep the newest `keepPerEntry` revisions, physically
     * drop the rest (live entry and recent undo trail stay). */
    pruneKnowledgeRevisions(input: {
        keepPerEntry: number;
    }): Promise<{
        entriesPruned: number;
        revisionsDeleted: number;
    }>;
}
export declare function createKnowledgeStore(paths: MetabotPaths): KnowledgeStore;
