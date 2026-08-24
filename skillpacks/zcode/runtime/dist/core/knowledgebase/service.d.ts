/**
 * Knowledge base service — learn (full/incremental rebuild), query (one KB or
 * merged across a bot's KBs), addDocument (SimpleNote-JSON wrapper with
 * provenance), importFiles. OAC port of the IDBots knowledgeBaseService on
 * the portable index store. Every learn is serialized per-KB and yields the
 * event loop between documents so the daemon never blocks.
 */
import type { MetabotPaths } from '../state/paths';
import { type KnowledgeBaseRecord, type KnowledgeBaseStore } from './store';
import { type KbQueryHit } from './indexStore';
import { extractKbDocTitle } from './text';
export interface KbQueryResult {
    knowledgeBaseId: string;
    knowledgeBaseName: string;
    hits: KbQueryHit[];
}
export interface AddDocumentInput {
    title: string;
    content: string;
    knowledgeBaseId?: string;
    sourceType?: 'web' | 'metaweb' | 'manual';
    url?: string;
    pinId?: string;
    tags?: string[];
}
export declare class KnowledgeBaseServiceError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function slugifyKbFileName(title: string, content: string): string;
export declare function buildKbDocumentJson(input: AddDocumentInput): string;
export interface KnowledgeBaseService {
    store: KnowledgeBaseStore;
    ensureDefaultKnowledgeBase(metabotSlug: string): Promise<KnowledgeBaseRecord>;
    learnKnowledgeBase(metabotSlug: string, knowledgeBaseId?: string, full?: boolean): Promise<KnowledgeBaseRecord>;
    queryKnowledgeBase(metabotSlug: string, query: string, options?: {
        knowledgeBaseId?: string;
        topK?: number;
        minScore?: number;
    }): Promise<KbQueryResult[]>;
    addDocument(metabotSlug: string, input: AddDocumentInput): Promise<{
        knowledgeBase: KnowledgeBaseRecord;
        relPath: string;
    }>;
    importFiles(metabotSlug: string, knowledgeBaseId: string | undefined, filePaths: string[]): Promise<number>;
}
export declare function createKnowledgeBaseService(paths: MetabotPaths): KnowledgeBaseService;
export { extractKbDocTitle };
