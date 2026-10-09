export interface SurfNoLlmIngestPin {
    pinId: string;
    meta?: {
        title?: string;
    };
    /** LLM-ready normalized body; null when empty/binary/encrypted — skip. */
    text: string | null;
}
export interface SurfNoLlmIngestResult {
    savedToKb: number;
    savedPinIds: string[];
    skippedPinIds: string[];
}
/**
 * Deterministic no-LLM surf fallback (Grok Bot scenario): when no LLM channel
 * is usable at all, the fetch/list/save part of the pipeline still works —
 * read each briefed pin's raw body and file it into the knowledge base
 * untouched. No deep reading, no knowledge points, no chain interactions;
 * the caller reports the run as partial.
 */
export declare function runSurfNoLlmKbIngest(input: {
    items: Array<{
        pinId: string;
        title?: string;
    }>;
    maxSaves: number;
    readPin: (pinId: string) => Promise<SurfNoLlmIngestPin>;
    addDocument: (doc: {
        title: string;
        content: string;
        sourceType: 'metaweb';
        pinId: string;
    }) => Promise<unknown>;
    logWarning?: (message: string) => void;
}): Promise<SurfNoLlmIngestResult>;
