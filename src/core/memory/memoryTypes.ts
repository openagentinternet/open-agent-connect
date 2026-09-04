// Scoped-memory entry model, ported from IDBots src/main/memory/memoryBackend.ts.
// Unlike IDBots (one SQLite db keyed by integer metabot_id), one JSON file
// lives inside each MetaBot profile, so entries carry no bot key — the
// profile directory is the boundary.
import type {
  MemoryOrigin,
  MemoryScope,
  MemoryScopeKind,
  MemoryUsageClass,
  MemoryVisibility,
} from './memoryScope';
import type { MemoryGuardLevel } from './memoryExtractor';

export type MemoryEntryStatus = 'created' | 'stale' | 'deleted';

export interface MemoryEntrySource {
  id: string;
  sessionId?: string | null;
  messageId?: string | null;
  role: 'user' | 'assistant' | 'tool' | 'system';
  sourceChannel?: string | null;
  sourceType?: string | null;
  externalConversationId?: string | null;
  sourceId?: string | null;
  /** Dream pipeline: the YYYY-MM-DD this memory was distilled from. */
  dreamDate?: string | null;
  isActive: boolean;
  createdAt: number;
}

export interface MemoryEntry {
  id: string;
  text: string;
  /** sha1 of the normalized match key; primary dedup anchor. */
  fingerprint: string;
  confidence: number;
  isExplicit: boolean;
  status: MemoryEntryStatus;
  scopeKind: MemoryScopeKind;
  scopeKey: string;
  usageClass: MemoryUsageClass;
  visibility: MemoryVisibility;
  origin: MemoryOrigin;
  sources: MemoryEntrySource[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  /** Hygiene soft-archive mark (ISO 8601); archived rows leave hot paths. */
  archivedAt: string | null;
}

export interface MemoryEntrySourceInput {
  sessionId?: string;
  messageId?: string;
  role?: 'user' | 'assistant' | 'tool' | 'system';
  sourceChannel?: string;
  sourceType?: string;
  externalConversationId?: string;
  sourceId?: string;
  dreamDate?: string;
}

export interface MemoryEntryStats {
  total: number;
  created: number;
  stale: number;
  deleted: number;
  explicit: number;
  implicit: number;
}

export interface MemoryScopeSelectorInput {
  // Normalize and validate with `normalizeMemoryScopeSelector` before using these fields.
  scope?: MemoryScope;
  scopeKind?: MemoryScopeKind;
  scopeKey?: string;
}

export interface MemoryClassifyInput {
  usageClass?: MemoryUsageClass;
  visibility?: MemoryVisibility;
}

export interface MemoryListOptions extends MemoryScopeSelectorInput {
  query?: string;
  status?: MemoryEntryStatus | 'all';
  usageClass?: MemoryUsageClass;
  origin?: MemoryOrigin;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
  /** When set, hygiene-archived rows join the listing (default excludes them). */
  includeArchived?: boolean;
  touchLastUsed?: boolean;
}

export interface MemoryCreateInput extends MemoryScopeSelectorInput, MemoryClassifyInput {
  text: string;
  confidence?: number;
  isExplicit?: boolean;
  origin?: MemoryOrigin;
  source?: MemoryEntrySourceInput;
  /**
   * Internal escape hatch for the dream pipeline: skip fingerprint/semantic
   * revive and always insert a new entry. Dream writes are authoritative
   * per-date batches — cross-date dedup would let a re-dreamed day resurrect
   * (and later cascade-delete) another day's entries.
   */
  forceNew?: boolean;
}

export interface MemoryUpdateInput extends MemoryScopeSelectorInput, MemoryClassifyInput {
  id: string;
  text?: string;
  confidence?: number;
  status?: MemoryEntryStatus;
  isExplicit?: boolean;
  /** Internal escape hatch: only the dream service may touch protected entries (self_identity). */
  allowProtected?: boolean;
  /** When set, an additional source record is appended for this memory. */
  source?: MemoryEntrySourceInput;
}

export interface MemoryDeleteInput extends MemoryScopeSelectorInput {
  id: string;
  /** Internal escape hatch: only the dream service may touch protected entries (self_identity). */
  allowProtected?: boolean;
}

export interface MemoryPolicy {
  memoryEnabled: boolean;
  memoryImplicitUpdateEnabled: boolean;
  memoryLlmJudgeEnabled: boolean;
  memoryGuardLevel: MemoryGuardLevel;
  memoryUserMemoriesMaxItems: number;
  dreamEnabled: boolean;
  /** Memory-hygiene master switch; join `dreamEnabled` as a per-Bot policy flag. */
  hygieneEnabled: boolean;
  updatedAt: number;
}

export interface MemoryEffectivePolicy {
  memoryEnabled: boolean;
  memoryImplicitUpdateEnabled: boolean;
  memoryLlmJudgeEnabled: boolean;
  memoryGuardLevel: MemoryGuardLevel;
  memoryUserMemoriesMaxItems: number;
  /** Combined char budget for injected memory blocks (oldest-first eviction). */
  memoryPromptMaxChars: number;
  dreamEnabled: boolean;
  /** Memory-hygiene master switch; join `dreamEnabled` as a per-Bot policy flag. */
  hygieneEnabled: boolean;
  source: 'default' | 'config' | 'profile';
}

export interface MemoryPolicyUpdates extends Partial<Pick<
  MemoryEffectivePolicy,
  | 'memoryEnabled'
  | 'memoryImplicitUpdateEnabled'
  | 'memoryLlmJudgeEnabled'
  | 'memoryGuardLevel'
  | 'memoryUserMemoriesMaxItems'
  | 'memoryPromptMaxChars'
  | 'dreamEnabled'
  | 'hygieneEnabled'
>> {
  /** Hygiene threshold overrides (`.runtime/memory/policy.json` → `hygiene` object). */
  hygiene?: Record<string, unknown>;
}

export interface ApplyTurnMemoryUpdatesOptions {
  sessionId?: string;
  userText: string;
  assistantText: string;
  channel?: string;
  peerGlobalMetaId?: string;
  externalConversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  /** Dependency-injected LLM judge; omit to keep rule-only judging. */
  judgeComplete?: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

export interface ApplyTurnMemoryUpdatesResult {
  totalChanges: number;
  created: number;
  updated: number;
  deleted: number;
  judgeRejected: number;
  llmReviewed: number;
  skipped: number;
}

export interface MemoryScopeSummary {
  kind: MemoryScopeKind;
  key: string;
  /** Number of non-deleted entries in this scope. */
  count: number;
  peerGlobalMetaId?: string | null;
}

export interface MemoryScopesOverview {
  owner: MemoryScopeSummary | null;
  contacts: MemoryScopeSummary[];
  conversations: MemoryScopeSummary[];
}
