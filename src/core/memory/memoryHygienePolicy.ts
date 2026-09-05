// Memory hygiene policy — the deterministic "compression stroke" that pairs
// with the nightly dream pass. Dreams abstract raw experience upward into
// summaries, memories, impressions and knowledge; hygiene then retires the
// raw layers that nothing will read again.
//
// Ported from IDBots src/main/libs/memoryHygienePolicy.ts. IDBots keeps one
// global config row with a per-bot enable override; OAC runs one bot per
// profile, so the thresholds live in the profile's `policy.json` under the
// `hygiene` object and the master switch is the `hygieneEnabled` policy flag
// (which joins `dreamEnabled`). `normalizeMemoryHygieneConfig` stays shared so
// the policy store and the service agree on defaults and clamps.

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

export const DEFAULT_MEMORY_HYGIENE_CONFIG: MemoryHygieneConfig = {
  enabled: true,
  observationRetentionDays: 90,
  observationAnchorsPerPair: 8,
  episodeArchiveDays: 180,
  memoryDecayDays: 180,
  tombstonePurgeDays: 365,
  knowledgeRevisionKeep: 5,
  dreamRunRetentionDays: 90,
  deepConsolidationEnabled: true,
  // Weekly by default: dream writes add belief-layer rows per bot per night,
  // so a 30-day cadence let the layer grow ~300 rows between passes while one
  // pass can retire at most 25% of the inventory — the recycle valve
  // mathematically could not keep up with the inflow.
  deepConsolidationIntervalDays: 7,
};

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
export const MEMORY_HYGIENE_THRESHOLD_KEYS = [
  'observationRetentionDays',
  'observationAnchorsPerPair',
  'episodeArchiveDays',
  'memoryDecayDays',
  'tombstonePurgeDays',
  'knowledgeRevisionKeep',
  'dreamRunRetentionDays',
  'deepConsolidationEnabled',
  'deepConsolidationIntervalDays',
] as const;

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
};

/** Sanitize a partial/persisted config into a complete, safely bounded one. */
export function normalizeMemoryHygieneConfig(input: unknown): MemoryHygieneConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof MemoryHygieneConfig, unknown>>;
  const defaults = DEFAULT_MEMORY_HYGIENE_CONFIG;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    observationRetentionDays: clampInt(raw.observationRetentionDays, defaults.observationRetentionDays, 14, 3650),
    observationAnchorsPerPair: clampInt(raw.observationAnchorsPerPair, defaults.observationAnchorsPerPair, 0, 50),
    episodeArchiveDays: clampInt(raw.episodeArchiveDays, defaults.episodeArchiveDays, 14, 3650),
    memoryDecayDays: clampInt(raw.memoryDecayDays, defaults.memoryDecayDays, 14, 3650),
    tombstonePurgeDays: clampInt(raw.tombstonePurgeDays, defaults.tombstonePurgeDays, 30, 3650),
    knowledgeRevisionKeep: clampInt(raw.knowledgeRevisionKeep, defaults.knowledgeRevisionKeep, 1, 50),
    dreamRunRetentionDays: clampInt(raw.dreamRunRetentionDays, defaults.dreamRunRetentionDays, 30, 3650),
    deepConsolidationEnabled:
      typeof raw.deepConsolidationEnabled === 'boolean' ? raw.deepConsolidationEnabled : defaults.deepConsolidationEnabled,
    deepConsolidationIntervalDays: clampInt(
      raw.deepConsolidationIntervalDays,
      defaults.deepConsolidationIntervalDays,
      7,
      365,
    ),
  };
}

/**
 * Scheduled passes wait until 04:00 (late in the 00:00–06:00 dream window so
 * nightly dreams finish first), then stay eligible all day as same-night
 * catch-up for hosts that were off during the window.
 */
const HYGIENE_RUN_MINUTES_FROM_MIDNIGHT = 4 * 60;

export function isMemoryHygieneRunTimeDue(date: Date): boolean {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= HYGIENE_RUN_MINUTES_FROM_MIDNIGHT;
}

/** Local YYYY-MM-DD for a date — the once-per-local-date dedupe key. */
export function formatHygieneDateKey(date: Date): string {
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
