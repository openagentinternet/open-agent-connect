// Prompt-time scoped-memory ranking and rendering, ported from IDBots
// src/main/memory/memoryPromptBlocks.ts. Pure keyword scoring + recency —
// no embeddings anywhere, by design.
import { isLocalMemoryChannel } from './memoryScope';

export interface MemoryPromptEntryLike {
  text: string;
  usageClass?: string | null;
  visibility?: string | null;
  updatedAt: number;
  lastUsedAt?: number | null;
}

/**
 * Byte budget for the whole rendered memory injection (all scoped blocks
 * combined). Memory earns its context (recall quality beats another tool
 * schema), so the default is generous — 12K chars ≈ 3K tokens, ~5x the
 * typical 20-entry block — but unbounded growth must not crowd out the
 * conversation itself. Over budget, entries are evicted oldest-first (by
 * lastUsedAt ?? updatedAt), never below the single top-ranked entry.
 */
export const DEFAULT_MEMORY_PROMPT_MAX_CHARS = 12000;
const MIN_MEMORY_PROMPT_MAX_CHARS = 2000;
const MAX_MEMORY_PROMPT_MAX_CHARS = 65536;

export function clampMemoryPromptMaxChars(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MEMORY_PROMPT_MAX_CHARS;
  return Math.max(
    MIN_MEMORY_PROMPT_MAX_CHARS,
    Math.min(MAX_MEMORY_PROMPT_MAX_CHARS, Math.floor(value))
  );
}

export interface RankedScopedMemoryEntry extends MemoryPromptEntryLike {
  block: 'owner' | 'contact' | 'conversation' | 'ownerOperationalPreference';
  relevanceScore: number;
}

export interface ScopedMemoryPromptSelection {
  ownerMemories: RankedScopedMemoryEntry[];
  contactMemories: RankedScopedMemoryEntry[];
  conversationMemories: RankedScopedMemoryEntry[];
  ownerOperationalPreferences: RankedScopedMemoryEntry[];
}

export interface RankScopedMemoryEntriesInput {
  requestChannel?: string | null;
  ownerEntries?: MemoryPromptEntryLike[];
  contactEntries?: MemoryPromptEntryLike[];
  conversationEntries?: MemoryPromptEntryLike[];
  currentUserText?: string;
  maxOwnerEntries?: number;
  maxScopedEntries?: number;
  maxOwnerOperationalPreferences?: number;
  /**
   * Combined char budget across all rendered memory blocks. Over budget,
   * entries are evicted oldest-first (lastUsedAt ?? updatedAt), never below
   * the single top-ranked entry. Defaults to DEFAULT_MEMORY_PROMPT_MAX_CHARS.
   */
  maxTotalChars?: number;
}

export interface BuildScopedMemoryPromptBlocksInput extends RankScopedMemoryEntriesInput {
  channel?: string | null;
}

function normalizePromptText(value?: string | null): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tokenizePromptText(value?: string): string[] {
  const normalized = normalizePromptText(value);
  if (!normalized) {
    return [];
  }
  return normalized.split(/[\s,，、|/\\;；:.!?]+/g).filter((token) => token.length >= 2);
}

function scoreEntryForPrompt(entry: MemoryPromptEntryLike, currentUserText?: string): number {
  const normalizedText = normalizePromptText(entry.text);
  if (!normalizedText) {
    return 0;
  }

  const tokens = tokenizePromptText(currentUserText);
  let score = 1;
  for (const token of tokens) {
    if (normalizedText.includes(token)) {
      score += 3;
    }
  }
  if (currentUserText && normalizedText.includes(normalizePromptText(currentUserText))) {
    score += 6;
  }
  return score;
}

function rankEntries(
  entries: MemoryPromptEntryLike[] | undefined,
  block: RankedScopedMemoryEntry['block'],
  currentUserText?: string,
  limit = 12
): RankedScopedMemoryEntry[] {
  return [...(entries ?? [])]
    .filter((entry) => normalizePromptText(entry.text))
    .map((entry) => ({
      ...entry,
      block,
      relevanceScore: scoreEntryForPrompt(entry, currentUserText),
    }))
    .sort((left, right) => {
      if (right.relevanceScore !== left.relevanceScore) {
        return right.relevanceScore - left.relevanceScore;
      }
      return normalizePromptText(left.text).localeCompare(normalizePromptText(right.text));
    })
    .slice(0, limit);
}

function applyPromptCharBudget(
  selection: ScopedMemoryPromptSelection,
  maxTotalChars: number
): ScopedMemoryPromptSelection {
  const budget = clampMemoryPromptMaxChars(maxTotalChars);
  const blocks: RankedScopedMemoryEntry[][] = [
    selection.ownerMemories,
    selection.contactMemories,
    selection.conversationMemories,
    selection.ownerOperationalPreferences,
  ];
  const entryChars = (entry: RankedScopedMemoryEntry): number => entry.text.length + 4; // "- " prefix + newline
  const rankedFlat = blocks.flat();
  let total = rankedFlat.reduce((sum, entry) => sum + entryChars(entry), 0);
  if (total <= budget) {
    return selection;
  }
  // Evict globally oldest-first (recency = lastUsedAt ?? updatedAt), ties
  // broken toward the lower-priority rank — but never evict the top-ranked
  // entry overall: a budget must not zero memory out entirely.
  const evictionOrder = rankedFlat
    .map((entry, rankIndex) => ({ entry, rankIndex }))
    .sort((left, right) => {
      const leftRecency = left.entry.lastUsedAt ?? left.entry.updatedAt ?? 0;
      const rightRecency = right.entry.lastUsedAt ?? right.entry.updatedAt ?? 0;
      if (leftRecency !== rightRecency) {
        return leftRecency - rightRecency;
      }
      return right.rankIndex - left.rankIndex;
    });
  const evicted = new Set<RankedScopedMemoryEntry>();
  for (const { entry, rankIndex } of evictionOrder) {
    if (total <= budget) break;
    if (rankIndex === 0) continue;
    evicted.add(entry);
    total -= entryChars(entry);
  }
  const keep = (entries: RankedScopedMemoryEntry[]): RankedScopedMemoryEntry[] =>
    entries.filter((entry) => !evicted.has(entry));
  return {
    ownerMemories: keep(selection.ownerMemories),
    contactMemories: keep(selection.contactMemories),
    conversationMemories: keep(selection.conversationMemories),
    ownerOperationalPreferences: keep(selection.ownerOperationalPreferences),
  };
}

export function selectScopedMemoryPromptEntries(input: RankScopedMemoryEntriesInput): ScopedMemoryPromptSelection {
  const channel = input.requestChannel ?? input.currentUserText ?? null;
  const scopedLimit = Math.max(1, input.maxScopedEntries ?? 12);
  const ownerLimit = Math.max(1, input.maxOwnerEntries ?? scopedLimit);
  const ownerOperationalLimit = Math.max(1, input.maxOwnerOperationalPreferences ?? 3);
  const maxTotalChars = input.maxTotalChars ?? DEFAULT_MEMORY_PROMPT_MAX_CHARS;

  if (isLocalMemoryChannel(channel)) {
    return applyPromptCharBudget({
      ownerMemories: rankEntries(input.ownerEntries, 'owner', input.currentUserText, ownerLimit),
      contactMemories: [],
      conversationMemories: [],
      ownerOperationalPreferences: [],
    }, maxTotalChars);
  }

  const safeOwnerOperationalEntries = (input.ownerEntries ?? []).filter((entry) =>
    entry.usageClass === 'operational_preference' && entry.visibility === 'external_safe'
  );
  const contactMemories = rankEntries(input.contactEntries, 'contact', input.currentUserText, scopedLimit);
  const conversationMemories = contactMemories.length > 0
    ? []
    : rankEntries(input.conversationEntries, 'conversation', input.currentUserText, scopedLimit);

  return applyPromptCharBudget({
    ownerMemories: [],
    contactMemories,
    conversationMemories,
    ownerOperationalPreferences: rankEntries(
      safeOwnerOperationalEntries,
      'ownerOperationalPreference',
      input.currentUserText,
      ownerOperationalLimit
    ),
  }, maxTotalChars);
}

export function rankScopedMemoryEntries(input: RankScopedMemoryEntriesInput): RankedScopedMemoryEntry[] {
  const selection = selectScopedMemoryPromptEntries(input);
  return [
    ...selection.ownerMemories,
    ...selection.contactMemories,
    ...selection.conversationMemories,
    ...selection.ownerOperationalPreferences,
  ];
}

function renderPromptBlock(tagName: string, entries: RankedScopedMemoryEntry[]): string {
  if (entries.length === 0) {
    return '';
  }
  const lines = entries.map((entry) => `- ${escapeXml(entry.text)}`);
  return `<${tagName}>\n${lines.join('\n')}\n</${tagName}>`;
}

export function buildScopedMemoryPromptBlocks(input: BuildScopedMemoryPromptBlocksInput): string {
  const selection = selectScopedMemoryPromptEntries({
    ...input,
    requestChannel: input.channel ?? input.requestChannel,
  });

  return [
    renderPromptBlock('ownerMemories', selection.ownerMemories),
    renderPromptBlock('contactMemories', selection.contactMemories),
    renderPromptBlock('conversationMemories', selection.conversationMemories),
    renderPromptBlock('ownerOperationalPreferences', selection.ownerOperationalPreferences),
  ]
    .filter(Boolean)
    .join('\n');
}
