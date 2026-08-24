/**
 * Procedure memory (IDBots M3 parity) — repeatable workflows living between
 * knowledge points (single facts) and skills (code). A procedure is a titled,
 * fingerprint-deduped list of steps + pitfalls with use tracking; recall
 * scores by tokenized term coverage (multi-keyword and colloquial CJK
 * bigram matching). OAC port onto a file-backed store in the workspace
 * memory layer, sibling to the knowledge points store.
 */
import type { MetabotPaths } from '../state/paths';
export interface ProcedureRecord {
    id: string;
    title: string;
    titleFingerprint: string;
    steps: string[];
    pitfalls: string[];
    triggerText: string;
    sourcePinIds: string[];
    category: string | null;
    tags: string[];
    confidence: number;
    status: 'active' | 'archived';
    origin: 'agent' | 'dream' | 'owner';
    useCount: number;
    lastUsedAt: number | null;
    version: number;
    createdAt: number;
    updatedAt: number;
}
export interface UpsertProcedureInput {
    title: string;
    steps: string[];
    pitfalls?: string[];
    triggerText?: string;
    sourcePinIds?: string[];
    category?: string | null;
    tags?: string[];
    confidence?: number;
    origin?: ProcedureRecord['origin'];
}
export declare class ProcedureStoreError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** sha256 of the normalized title — the same-title rewrite key. */
export declare function procedureTitleFingerprint(title: string): string;
/**
 * Tokenized term-coverage matching: a procedure scores when the query terms
 * appear in its title/trigger/tags/steps. CJK bigrams give colloquial
 * multi-keyword matching; isolated single CJK chars match titles only.
 */
export declare function scoreProceduresForQuery(procedures: ProcedureRecord[], query: string): Array<{
    procedure: ProcedureRecord;
    score: number;
}>;
export interface ProcedureStore {
    upsertProcedure(input: UpsertProcedureInput): Promise<{
        procedure: ProcedureRecord;
        created: boolean;
    }>;
    listProcedures(options?: {
        status?: ProcedureRecord['status'];
    }): Promise<ProcedureRecord[]>;
    archiveProcedureByTitle(title: string): Promise<ProcedureRecord | null>;
    touchUsed(id: string): Promise<void>;
}
export declare function createProcedureStore(paths: MetabotPaths): ProcedureStore;
