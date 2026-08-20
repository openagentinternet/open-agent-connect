// Pure text/similarity helpers for the memory store, ported from IDBots
// src/main/coworkStore.ts (lines ~80-460). These power fingerprint dedup,
// near-duplicate merging, delete-target matching, and text classification.
import crypto from 'node:crypto';

import {
  normalizeScopeChannel,
  normalizeScopeIdentity,
  type MemoryOrigin,
  type MemoryScope,
  type MemoryUsageClass,
  type MemoryVisibility,
} from './memoryScope';

export const MEMORY_NEAR_DUPLICATE_MIN_SCORE = 0.82;
export const MEMORY_TEXT_MAX_CHARS = 360;
/** self_identity holds the dream pipeline's four-part self-distillation
 * (200+ chars by contract, typically 350–600) — the generic 360-char memory
 * cap used to cut every identity entry mid-sentence. */
export const SELF_IDENTITY_TEXT_MAX_CHARS = 1200;
const MEMORY_OPERATIONAL_PREFERENCE_RE = /(默认语言|回复格式|输出风格|回复风格|尽量简洁|保持简短|reply(?:\s+in)?|respond(?:\s+in)?|language|format|style|tone|markdown|concise|brief)/i;
const MEMORY_PREFERENCE_RE = /(偏好|喜欢|prefer|preference|likes?|dislikes?)/i;

export function normalizeMemoryText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function truncateMemoryText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1)}…`;
}

export function normalizeMemoryUsageClass(value?: string | null): MemoryUsageClass {
  if (
    value === 'preference'
    || value === 'operational_preference'
    || value === 'self_identity'
    || value === 'work_review'
    || value === 'value_boundary'
  ) {
    return value;
  }
  return 'profile_fact';
}

export function normalizeMemoryOrigin(value?: string | null): MemoryOrigin {
  return value === 'dream' ? 'dream' : 'conversation';
}

export function normalizeMemoryVisibility(value?: string | null): MemoryVisibility {
  return value === 'external_safe' ? 'external_safe' : 'local_only';
}

export function maxMemoryTextChars(usageClass?: string | null): number {
  return normalizeMemoryUsageClass(usageClass) === 'self_identity'
    ? SELF_IDENTITY_TEXT_MAX_CHARS
    : MEMORY_TEXT_MAX_CHARS;
}

export function normalizeMemoryMatchKey(value: string): string {
  return normalizeMemoryText(value)
    .toLowerCase()
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMemorySemanticKey(value: string): string {
  const key = normalizeMemoryMatchKey(value);
  if (!key) return '';
  return key
    .replace(/^(?:the user|user|i am|i m|i|my|me)\s+/i, '')
    .replace(/^(?:该用户|这个用户|用户|本人|我的|我们|咱们|咱|我|你的|你)\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTokenFrequencyMap(value: string): Map<string, number> {
  const tokens = value
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean);
  const map = new Map<string, number>();
  for (const token of tokens) {
    map.set(token, (map.get(token) || 0) + 1);
  }
  return map;
}

function scoreTokenOverlap(left: string, right: string): number {
  const leftMap = buildTokenFrequencyMap(left);
  const rightMap = buildTokenFrequencyMap(right);
  if (leftMap.size === 0 || rightMap.size === 0) return 0;

  let leftCount = 0;
  let rightCount = 0;
  let intersection = 0;
  for (const count of leftMap.values()) leftCount += count;
  for (const count of rightMap.values()) rightCount += count;
  for (const [token, leftValue] of leftMap.entries()) {
    intersection += Math.min(leftValue, rightMap.get(token) || 0);
  }

  const denominator = Math.min(leftCount, rightCount);
  if (denominator <= 0) return 0;
  return intersection / denominator;
}

function buildCharacterBigramMap(value: string): Map<string, number> {
  const compact = value.replace(/\s+/g, '').trim();
  if (!compact) return new Map<string, number>();
  if (compact.length <= 1) return new Map<string, number>([[compact, 1]]);

  const map = new Map<string, number>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    const gram = compact.slice(index, index + 2);
    map.set(gram, (map.get(gram) || 0) + 1);
  }
  return map;
}

function scoreCharacterBigramDice(left: string, right: string): number {
  const leftMap = buildCharacterBigramMap(left);
  const rightMap = buildCharacterBigramMap(right);
  if (leftMap.size === 0 || rightMap.size === 0) return 0;

  let leftCount = 0;
  let rightCount = 0;
  let intersection = 0;
  for (const count of leftMap.values()) leftCount += count;
  for (const count of rightMap.values()) rightCount += count;
  for (const [gram, leftValue] of leftMap.entries()) {
    intersection += Math.min(leftValue, rightMap.get(gram) || 0);
  }

  const denominator = leftCount + rightCount;
  if (denominator <= 0) return 0;
  return (2 * intersection) / denominator;
}

export function scoreMemorySimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const compactLeft = left.replace(/\s+/g, '');
  const compactRight = right.replace(/\s+/g, '');
  if (compactLeft && compactLeft === compactRight) {
    return 1;
  }

  let phraseScore = 0;
  if (compactLeft && compactRight && (compactLeft.includes(compactRight) || compactRight.includes(compactLeft))) {
    phraseScore = Math.min(compactLeft.length, compactRight.length) / Math.max(compactLeft.length, compactRight.length);
  }

  return Math.max(
    phraseScore,
    scoreTokenOverlap(left, right),
    scoreCharacterBigramDice(left, right)
  );
}

function scoreMemoryTextQuality(value: string): number {
  const normalized = normalizeMemoryText(value);
  if (!normalized) return 0;
  let score = normalized.length;
  if (/^(?:该用户|这个用户|用户)\s*/u.test(normalized)) {
    score -= 12;
  }
  if (/^(?:the user|user)\b/i.test(normalized)) {
    score -= 12;
  }
  if (/^(?:我|我的|我是|我有|我会|我喜欢|我偏好)/u.test(normalized)) {
    score += 4;
  }
  if (/^(?:i|i am|i'm|my)\b/i.test(normalized)) {
    score += 4;
  }
  return score;
}

export function choosePreferredMemoryText(currentText: string, incomingText: string): string {
  const normalizedCurrent = truncateMemoryText(normalizeMemoryText(currentText), MEMORY_TEXT_MAX_CHARS);
  const normalizedIncoming = truncateMemoryText(normalizeMemoryText(incomingText), MEMORY_TEXT_MAX_CHARS);
  if (!normalizedCurrent) return normalizedIncoming;
  if (!normalizedIncoming) return normalizedCurrent;

  const currentScore = scoreMemoryTextQuality(normalizedCurrent);
  const incomingScore = scoreMemoryTextQuality(normalizedIncoming);
  if (incomingScore > currentScore + 1) return normalizedIncoming;
  if (currentScore > incomingScore + 1) return normalizedCurrent;
  return normalizedIncoming.length >= normalizedCurrent.length ? normalizedIncoming : normalizedCurrent;
}

function isMeaningfulDeleteFragment(value: string): boolean {
  if (!value) return false;
  const tokens = value.split(/\s+/g).filter(Boolean);
  if (tokens.length >= 2) return true;
  if (/[\u3400-\u9fff]/u.test(value)) return value.length >= 4;
  return value.length >= 6;
}

function includesAsBoundedPhrase(target: string, fragment: string): boolean {
  if (!target || !fragment) return false;
  const paddedTarget = ` ${target} `;
  const paddedFragment = ` ${fragment} `;
  if (paddedTarget.includes(paddedFragment)) {
    return true;
  }
  // CJK phrases are often unsegmented, so token boundaries are unreliable.
  if (/[\u3400-\u9fff]/u.test(fragment) && !fragment.includes(' ')) {
    return target.includes(fragment);
  }
  return false;
}

export function scoreDeleteMatch(targetKey: string, queryKey: string): number {
  if (!targetKey || !queryKey) return 0;
  if (targetKey === queryKey) {
    return 1000 + queryKey.length;
  }
  if (!isMeaningfulDeleteFragment(queryKey)) {
    return 0;
  }
  if (!includesAsBoundedPhrase(targetKey, queryKey)) {
    return 0;
  }
  return 100 + Math.min(targetKey.length, queryKey.length);
}

export function buildMemoryFingerprint(text: string): string {
  const key = normalizeMemoryMatchKey(text);
  return crypto.createHash('sha1').update(key).digest('hex');
}

function countCjkCodepoints(value: string): number {
  let count = 0;
  for (const char of value) {
    if (/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u.test(char)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Rough token estimate for mixed Chinese/English text, ported from IDBots
 * coworkContextBudget.estimateCoworkTextTokens: CJK codepoints count as one
 * token each, everything else as ~4 chars per token.
 */
export function estimateTextTokens(value: string): number {
  if (!value) return 0;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return 0;
  const cjkChars = countCjkCodepoints(normalized);
  const nonCjkChars = Math.max(0, [...normalized].length - cjkChars);
  return Math.max(1, cjkChars + Math.ceil(nonCjkChars / 4));
}

export function classifyMemoryText(text: string, scope: MemoryScope): {
  usageClass: MemoryUsageClass;
  visibility: MemoryVisibility;
} {
  const normalized = normalizeMemoryText(text);
  const usageClass = MEMORY_OPERATIONAL_PREFERENCE_RE.test(normalized)
    ? 'operational_preference'
    : MEMORY_PREFERENCE_RE.test(normalized)
      ? 'preference'
      : 'profile_fact';
  const visibility = scope.kind === 'owner' && usageClass === 'operational_preference'
    ? 'external_safe'
    : 'local_only';
  return { usageClass, visibility };
}

export function resolveMemoryClassification(
  text: string,
  scope: MemoryScope,
  overrides: {
    usageClass?: MemoryUsageClass | null;
    visibility?: MemoryVisibility | null;
  } = {}
): {
  usageClass: MemoryUsageClass;
  visibility: MemoryVisibility;
} {
  const inferred = classifyMemoryText(text, scope);
  const usageClass = normalizeMemoryUsageClass(overrides.usageClass ?? inferred.usageClass);
  let visibility = normalizeMemoryVisibility(overrides.visibility ?? inferred.visibility);
  if (scope.kind !== 'owner' || usageClass !== 'operational_preference') {
    visibility = 'local_only';
  }
  return { usageClass, visibility };
}

/** Terms for transcript/conversation search: full phrase plus per-token terms, max 8. */
export function extractConversationSearchTerms(value: string): string[] {
  const normalized = normalizeMemoryText(value).toLowerCase();
  if (!normalized) return [];

  const terms: string[] = [];
  const seen = new Set<string>();
  const addTerm = (term: string): void => {
    const normalizedTerm = normalizeMemoryText(term).toLowerCase();
    if (!normalizedTerm) return;
    if (/^[a-z0-9]$/i.test(normalizedTerm)) return;
    if (seen.has(normalizedTerm)) return;
    seen.add(normalizedTerm);
    terms.push(normalizedTerm);
  };

  // Keep the full phrase and additionally match by per-token terms.
  addTerm(normalized);
  const tokens = normalized
    .split(/[\s,，、|/\\;；]+/g)
    .map((token) => token.replace(/^['"`]+|['"`]+$/g, '').trim())
    .filter(Boolean);

  for (const token of tokens) {
    addTerm(token);
    if (terms.length >= 8) break;
  }

  return terms.slice(0, 8);
}

export function inferPeerGlobalMetaIdFromConversationId(
  sourceChannel?: string | null,
  externalConversationId?: string | null
): string | null {
  if (normalizeScopeChannel(sourceChannel) !== 'metaweb_private') {
    return null;
  }
  const normalizedConversationId = normalizeScopeIdentity(externalConversationId);
  const match = normalizedConversationId.match(/^metaweb-private:(.+)$/);
  return match?.[1] ? normalizeScopeIdentity(match[1]) : null;
}
