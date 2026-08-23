"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SELF_IDENTITY_TEXT_MAX_CHARS = exports.MEMORY_TEXT_MAX_CHARS = exports.MEMORY_NEAR_DUPLICATE_MIN_SCORE = void 0;
exports.normalizeMemoryText = normalizeMemoryText;
exports.truncateMemoryText = truncateMemoryText;
exports.normalizeMemoryUsageClass = normalizeMemoryUsageClass;
exports.normalizeMemoryOrigin = normalizeMemoryOrigin;
exports.normalizeMemoryVisibility = normalizeMemoryVisibility;
exports.maxMemoryTextChars = maxMemoryTextChars;
exports.normalizeMemoryMatchKey = normalizeMemoryMatchKey;
exports.normalizeMemorySemanticKey = normalizeMemorySemanticKey;
exports.scoreMemorySimilarity = scoreMemorySimilarity;
exports.choosePreferredMemoryText = choosePreferredMemoryText;
exports.scoreDeleteMatch = scoreDeleteMatch;
exports.buildMemoryFingerprint = buildMemoryFingerprint;
exports.estimateTextTokens = estimateTextTokens;
exports.classifyMemoryText = classifyMemoryText;
exports.resolveMemoryClassification = resolveMemoryClassification;
exports.extractConversationSearchTerms = extractConversationSearchTerms;
exports.inferPeerGlobalMetaIdFromConversationId = inferPeerGlobalMetaIdFromConversationId;
// Pure text/similarity helpers for the memory store, ported from IDBots
// src/main/coworkStore.ts (lines ~80-460). These power fingerprint dedup,
// near-duplicate merging, delete-target matching, and text classification.
const node_crypto_1 = __importDefault(require("node:crypto"));
const memoryScope_1 = require("./memoryScope");
exports.MEMORY_NEAR_DUPLICATE_MIN_SCORE = 0.82;
exports.MEMORY_TEXT_MAX_CHARS = 360;
/** self_identity holds the dream pipeline's four-part self-distillation
 * (200+ chars by contract, typically 350–600) — the generic 360-char memory
 * cap used to cut every identity entry mid-sentence. */
exports.SELF_IDENTITY_TEXT_MAX_CHARS = 1200;
const MEMORY_OPERATIONAL_PREFERENCE_RE = /(默认语言|回复格式|输出风格|回复风格|尽量简洁|保持简短|reply(?:\s+in)?|respond(?:\s+in)?|language|format|style|tone|markdown|concise|brief)/i;
const MEMORY_PREFERENCE_RE = /(偏好|喜欢|prefer|preference|likes?|dislikes?)/i;
function normalizeMemoryText(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function truncateMemoryText(value, maxChars) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, maxChars - 1)}…`;
}
function normalizeMemoryUsageClass(value) {
    if (value === 'preference'
        || value === 'operational_preference'
        || value === 'self_identity'
        || value === 'work_review'
        || value === 'value_boundary') {
        return value;
    }
    return 'profile_fact';
}
function normalizeMemoryOrigin(value) {
    return value === 'dream' ? 'dream' : 'conversation';
}
function normalizeMemoryVisibility(value) {
    return value === 'external_safe' ? 'external_safe' : 'local_only';
}
function maxMemoryTextChars(usageClass) {
    return normalizeMemoryUsageClass(usageClass) === 'self_identity'
        ? exports.SELF_IDENTITY_TEXT_MAX_CHARS
        : exports.MEMORY_TEXT_MAX_CHARS;
}
function normalizeMemoryMatchKey(value) {
    return normalizeMemoryText(value)
        .toLowerCase()
        .replace(/[\u0000-\u001f]/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function normalizeMemorySemanticKey(value) {
    const key = normalizeMemoryMatchKey(value);
    if (!key)
        return '';
    return key
        .replace(/^(?:the user|user|i am|i m|i|my|me)\s+/i, '')
        .replace(/^(?:该用户|这个用户|用户|本人|我的|我们|咱们|咱|我|你的|你)\s*/u, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function buildTokenFrequencyMap(value) {
    const tokens = value
        .split(/\s+/g)
        .map((token) => token.trim())
        .filter(Boolean);
    const map = new Map();
    for (const token of tokens) {
        map.set(token, (map.get(token) || 0) + 1);
    }
    return map;
}
function scoreTokenOverlap(left, right) {
    const leftMap = buildTokenFrequencyMap(left);
    const rightMap = buildTokenFrequencyMap(right);
    if (leftMap.size === 0 || rightMap.size === 0)
        return 0;
    let leftCount = 0;
    let rightCount = 0;
    let intersection = 0;
    for (const count of leftMap.values())
        leftCount += count;
    for (const count of rightMap.values())
        rightCount += count;
    for (const [token, leftValue] of leftMap.entries()) {
        intersection += Math.min(leftValue, rightMap.get(token) || 0);
    }
    const denominator = Math.min(leftCount, rightCount);
    if (denominator <= 0)
        return 0;
    return intersection / denominator;
}
function buildCharacterBigramMap(value) {
    const compact = value.replace(/\s+/g, '').trim();
    if (!compact)
        return new Map();
    if (compact.length <= 1)
        return new Map([[compact, 1]]);
    const map = new Map();
    for (let index = 0; index < compact.length - 1; index += 1) {
        const gram = compact.slice(index, index + 2);
        map.set(gram, (map.get(gram) || 0) + 1);
    }
    return map;
}
function scoreCharacterBigramDice(left, right) {
    const leftMap = buildCharacterBigramMap(left);
    const rightMap = buildCharacterBigramMap(right);
    if (leftMap.size === 0 || rightMap.size === 0)
        return 0;
    let leftCount = 0;
    let rightCount = 0;
    let intersection = 0;
    for (const count of leftMap.values())
        leftCount += count;
    for (const count of rightMap.values())
        rightCount += count;
    for (const [gram, leftValue] of leftMap.entries()) {
        intersection += Math.min(leftValue, rightMap.get(gram) || 0);
    }
    const denominator = leftCount + rightCount;
    if (denominator <= 0)
        return 0;
    return (2 * intersection) / denominator;
}
function scoreMemorySimilarity(left, right) {
    if (!left || !right)
        return 0;
    if (left === right)
        return 1;
    const compactLeft = left.replace(/\s+/g, '');
    const compactRight = right.replace(/\s+/g, '');
    if (compactLeft && compactLeft === compactRight) {
        return 1;
    }
    let phraseScore = 0;
    if (compactLeft && compactRight && (compactLeft.includes(compactRight) || compactRight.includes(compactLeft))) {
        phraseScore = Math.min(compactLeft.length, compactRight.length) / Math.max(compactLeft.length, compactRight.length);
    }
    return Math.max(phraseScore, scoreTokenOverlap(left, right), scoreCharacterBigramDice(left, right));
}
function scoreMemoryTextQuality(value) {
    const normalized = normalizeMemoryText(value);
    if (!normalized)
        return 0;
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
function choosePreferredMemoryText(currentText, incomingText) {
    const normalizedCurrent = truncateMemoryText(normalizeMemoryText(currentText), exports.MEMORY_TEXT_MAX_CHARS);
    const normalizedIncoming = truncateMemoryText(normalizeMemoryText(incomingText), exports.MEMORY_TEXT_MAX_CHARS);
    if (!normalizedCurrent)
        return normalizedIncoming;
    if (!normalizedIncoming)
        return normalizedCurrent;
    const currentScore = scoreMemoryTextQuality(normalizedCurrent);
    const incomingScore = scoreMemoryTextQuality(normalizedIncoming);
    if (incomingScore > currentScore + 1)
        return normalizedIncoming;
    if (currentScore > incomingScore + 1)
        return normalizedCurrent;
    return normalizedIncoming.length >= normalizedCurrent.length ? normalizedIncoming : normalizedCurrent;
}
function isMeaningfulDeleteFragment(value) {
    if (!value)
        return false;
    const tokens = value.split(/\s+/g).filter(Boolean);
    if (tokens.length >= 2)
        return true;
    if (/[\u3400-\u9fff]/u.test(value))
        return value.length >= 4;
    return value.length >= 6;
}
function includesAsBoundedPhrase(target, fragment) {
    if (!target || !fragment)
        return false;
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
function scoreDeleteMatch(targetKey, queryKey) {
    if (!targetKey || !queryKey)
        return 0;
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
function buildMemoryFingerprint(text) {
    const key = normalizeMemoryMatchKey(text);
    return node_crypto_1.default.createHash('sha1').update(key).digest('hex');
}
function countCjkCodepoints(value) {
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
function estimateTextTokens(value) {
    if (!value)
        return 0;
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized)
        return 0;
    const cjkChars = countCjkCodepoints(normalized);
    const nonCjkChars = Math.max(0, [...normalized].length - cjkChars);
    return Math.max(1, cjkChars + Math.ceil(nonCjkChars / 4));
}
function classifyMemoryText(text, scope) {
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
function resolveMemoryClassification(text, scope, overrides = {}) {
    const inferred = classifyMemoryText(text, scope);
    const usageClass = normalizeMemoryUsageClass(overrides.usageClass ?? inferred.usageClass);
    let visibility = normalizeMemoryVisibility(overrides.visibility ?? inferred.visibility);
    if (scope.kind !== 'owner' || usageClass !== 'operational_preference') {
        visibility = 'local_only';
    }
    return { usageClass, visibility };
}
/** Terms for transcript/conversation search: full phrase plus per-token terms, max 8. */
function extractConversationSearchTerms(value) {
    const normalized = normalizeMemoryText(value).toLowerCase();
    if (!normalized)
        return [];
    const terms = [];
    const seen = new Set();
    const addTerm = (term) => {
        const normalizedTerm = normalizeMemoryText(term).toLowerCase();
        if (!normalizedTerm)
            return;
        if (/^[a-z0-9]$/i.test(normalizedTerm))
            return;
        if (seen.has(normalizedTerm))
            return;
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
        if (terms.length >= 8)
            break;
    }
    return terms.slice(0, 8);
}
function inferPeerGlobalMetaIdFromConversationId(sourceChannel, externalConversationId) {
    if ((0, memoryScope_1.normalizeScopeChannel)(sourceChannel) !== 'metaweb_private') {
        return null;
    }
    const normalizedConversationId = (0, memoryScope_1.normalizeScopeIdentity)(externalConversationId);
    const match = normalizedConversationId.match(/^metaweb-private:(.+)$/);
    return match?.[1] ? (0, memoryScope_1.normalizeScopeIdentity)(match[1]) : null;
}
