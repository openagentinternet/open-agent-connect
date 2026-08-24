/**
 * Knowledge base registry — per-bot document corpora. OAC port of the IDBots
 * knowledgeBaseStore, adapted to the storage layout v2 file conventions:
 *   registry:  <workspace>/memory/knowledge-bases.json
 *   raw docs:  <workspace>/memory/knowledge-bases/<kbId>/raw/**
 *   derived:   <runtime>/knowledge-bases/<kbId>/index.json
 * Derived data is rebuildable from the raw corpus at any time (learn --full).
 */
import type { MetabotPaths } from '../state/paths';
export interface KnowledgeBaseRecord {
    id: string;
    metabotSlug: string;
    name: string;
    description: string;
    rawDir: string;
    isDefault: boolean;
    autoLearn: boolean;
    docCount: number;
    chunkCount: number;
    lastLearnedAt: number | null;
    lastAutoLearnDate: string | null;
    createdAt: number;
    updatedAt: number;
}
export interface CreateKnowledgeBaseInput {
    metabotSlug: string;
    name: string;
    description?: string;
    isDefault?: boolean;
    autoLearn?: boolean;
    rawDir?: string;
}
export declare class KnowledgeBaseStoreError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export interface KnowledgeBaseStore {
    registryPath: string;
    listKnowledgeBases(): Promise<KnowledgeBaseRecord[]>;
    getKnowledgeBase(id: string): Promise<KnowledgeBaseRecord | null>;
    getDefaultKnowledgeBase(metabotSlug: string): Promise<KnowledgeBaseRecord | null>;
    createKnowledgeBase(input: CreateKnowledgeBaseInput): Promise<KnowledgeBaseRecord>;
    updateKnowledgeBase(id: string, patch: Partial<Pick<KnowledgeBaseRecord, 'name' | 'description' | 'autoLearn'>>): Promise<KnowledgeBaseRecord>;
    removeKnowledgeBase(id: string): Promise<boolean>;
    setCounts(id: string, docCount: number, chunkCount: number, learnedAt: number): Promise<void>;
    markAutoLearned(id: string, dateIso: string): Promise<void>;
    listDueForAutoLearn(now: Date): Promise<KnowledgeBaseRecord[]>;
}
export declare function createKnowledgeBaseStore(paths: MetabotPaths): KnowledgeBaseStore;
/** Resolve the derived index path for one KB (runtime layer, rebuildable). */
export declare function knowledgeBaseIndexPath(paths: MetabotPaths, kbId: string): string;
