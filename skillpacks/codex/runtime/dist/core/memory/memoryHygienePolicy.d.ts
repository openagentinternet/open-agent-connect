export interface MemoryHygieneConfig {
    /** Master switch for the scheduled hygiene pass (policy flag `hygieneEnabled`). */
    enabled: boolean;
    /** Impression observations older than this are superseded; the snapshot keeps the compressed state. */
    observationRetentionDays: number;
    /** Recent observations kept per (observer, subject) pair as episodic anchors. */
    observationAnchorsPerPair: number;
    /** Terminal episodes older than this are soft-archived out of hot paths. */
    episodeArchiveDays: number;
    /** Dream-origin memories untouched for this long are soft-archived. */
    memoryDecayDays: number;
    /** Soft-deleted memory tombstones are physically purged after this grace period. */
    tombstonePurgeDays: number;
    /** Knowledge entries keep at most this many historical revisions. */
    knowledgeRevisionKeep: number;
    /** Completed dream runs and fragment caches older than this are purged. */
    dreamRunRetentionDays: number;
    /** LLM deep-consolidation pass: merge/retire the belief layer on a low-frequency cadence. */
    deepConsolidationEnabled: boolean;
    /** Minimum days between deep-consolidation runs. */
    deepConsolidationIntervalDays: number;
}
export declare const DEFAULT_MEMORY_HYGIENE_CONFIG: MemoryHygieneConfig;
/** Result record persisted after each pass; drives the status verb. */
export interface HygieneRunStats {
    /** Local date key the pass ran for (one scheduled pass per key). */
    dateKey: string;
    ranAt: number;
    trigger: 'scheduled' | 'manual';
    /** Per-step counters, e.g. { observationsSuperseded: 12 }. */
    counts: Record<string, number>;
    errors: string[];
}
/** Threshold keys persisted under `policy.json` → `hygiene` (the switch lives
 * in the `hygieneEnabled` flag, not in this object). */
export declare const MEMORY_HYGIENE_THRESHOLD_KEYS: readonly ["observationRetentionDays", "observationAnchorsPerPair", "episodeArchiveDays", "memoryDecayDays", "tombstonePurgeDays", "knowledgeRevisionKeep", "dreamRunRetentionDays", "deepConsolidationEnabled", "deepConsolidationIntervalDays"];
/** Sanitize a partial/persisted config into a complete, safely bounded one. */
export declare function normalizeMemoryHygieneConfig(input: unknown): MemoryHygieneConfig;
export declare function isMemoryHygieneRunTimeDue(date: Date): boolean;
/** Local YYYY-MM-DD for a date — the once-per-local-date dedupe key. */
export declare function formatHygieneDateKey(date: Date): string;
