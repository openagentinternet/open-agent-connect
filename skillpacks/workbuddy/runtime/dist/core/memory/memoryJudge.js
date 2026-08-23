"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEMORY_JUDGE_SYSTEM_PROMPT = void 0;
exports.parseLlmJudgePayload = parseLlmJudgePayload;
exports.judgeMemoryCandidate = judgeMemoryCandidate;
// Memory candidate judge, ported from IDBots src/main/libs/coworkMemoryJudge.ts.
// Rule scoring is identical to the source; the optional LLM second opinion
// for borderline candidates is transport-agnostic here — callers inject a
// `judgeComplete(systemPrompt, userPrompt)` instead of this module fetching
// an Anthropic endpoint directly.
const memoryExtractor_1 = require("./memoryExtractor");
const FACTUAL_PROFILE_RE = /(我叫|我是|我的名字|我名字|我来自|我住在|我的职业|我有(?!\s*(?:一个|个)?问题)|我养了|我喜欢|我偏好|我习惯|\bmy\s+name\s+is\b|\bi\s+am\b|\bi['’]?m\b|\bi\s+live\s+in\b|\bi['’]?m\s+from\b|\bi\s+work\s+as\b|\bi\s+have\b|\bi\s+prefer\b|\bi\s+like\b|\bi\s+usually\b)/i;
const TRANSIENT_RE = /(今天|昨日|昨天|刚刚|刚才|本周|本月|临时|暂时|这次|当前|today|yesterday|this\s+week|this\s+month|temporary|for\s+now)/i;
const PROCEDURAL_RE = /(执行以下命令|run\s+(?:the\s+)?following\s+command|\b(?:cd|npm|pnpm|yarn|node|python|bash|sh|git|curl|wget)\b|\$[A-Z_][A-Z0-9_]*|&&|--[a-z0-9-]+|\/tmp\/|\.sh\b|\.bat\b|\.ps1\b)/i;
const REQUEST_STYLE_RE = /^(?:请|麻烦|帮我|请你|帮忙|请帮我|use|please|can you|could you|would you)/i;
const ASSISTANT_STYLE_RE = /((请|以后|后续|默认|请始终|不要再|请不要|优先|务必).*(回复|回答|语言|中文|英文|格式|风格|语气|简洁|详细|代码|命名|markdown|respond|reply|language|format|style|tone))/i;
const LLM_BORDERLINE_MARGIN = 0.08;
const LLM_MIN_CONFIDENCE = 0.55;
const LLM_CACHE_MAX_SIZE = 256;
const LLM_CACHE_TTL_MS = 10 * 60 * 1000;
const LLM_INPUT_MAX_CHARS = 280;
exports.MEMORY_JUDGE_SYSTEM_PROMPT = [
    'You classify whether a sentence is durable long-term user memory.',
    'Accept only stable personal facts or stable assistant preferences.',
    'Reject questions, temporary context, one-off tasks, and procedural command text.',
    'Return JSON only: {"accepted":boolean,"confidence":number,"reason":string}',
].join(' ');
const llmJudgeCache = new Map();
function thresholdByGuardLevel(isExplicit, guardLevel) {
    if (isExplicit) {
        if (guardLevel === 'strict')
            return 0.7;
        if (guardLevel === 'relaxed')
            return 0.52;
        return 0.6;
    }
    if (guardLevel === 'strict')
        return 0.8;
    if (guardLevel === 'relaxed')
        return 0.62;
    return 0.72;
}
function normalizeText(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function clamp01(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.min(1, value));
}
function shouldCallLlmForBoundaryCase(score, threshold, reason) {
    if (reason === 'empty' || reason === 'question-like' || reason === 'procedural-like') {
        return false;
    }
    return Math.abs(score - threshold) <= LLM_BORDERLINE_MARGIN;
}
function buildLlmCacheKey(input) {
    return `${input.guardLevel}|${input.isExplicit ? 1 : 0}|${normalizeText(input.text)}`;
}
function getCachedLlmResult(key) {
    const cached = llmJudgeCache.get(key);
    if (!cached)
        return null;
    if (Date.now() - cached.createdAt > LLM_CACHE_TTL_MS) {
        llmJudgeCache.delete(key);
        return null;
    }
    return cached.value;
}
function setCachedLlmResult(key, value) {
    llmJudgeCache.set(key, { value, createdAt: Date.now() });
    while (llmJudgeCache.size > LLM_CACHE_MAX_SIZE) {
        const oldestKey = llmJudgeCache.keys().next().value;
        if (!oldestKey || typeof oldestKey !== 'string')
            break;
        llmJudgeCache.delete(oldestKey);
    }
}
function scoreMemoryText(text) {
    const normalized = normalizeText(text);
    if (!normalized)
        return { score: 0, reason: 'empty' };
    if ((0, memoryExtractor_1.isQuestionLikeMemoryText)(normalized)) {
        return { score: 0.05, reason: 'question-like' };
    }
    let score = 0.5;
    let strongestReason = 'neutral';
    if (FACTUAL_PROFILE_RE.test(normalized)) {
        score += 0.28;
        strongestReason = 'factual-personal';
    }
    if (ASSISTANT_STYLE_RE.test(normalized)) {
        score += 0.1;
        strongestReason = strongestReason === 'neutral' ? 'assistant-preference' : strongestReason;
    }
    if (REQUEST_STYLE_RE.test(normalized)) {
        score -= 0.14;
        if (strongestReason === 'neutral')
            strongestReason = 'request-like';
    }
    if (TRANSIENT_RE.test(normalized)) {
        score -= 0.18;
        if (strongestReason === 'neutral')
            strongestReason = 'transient-like';
    }
    if (PROCEDURAL_RE.test(normalized)) {
        score -= 0.4;
        strongestReason = 'procedural-like';
    }
    if (normalized.length < 6) {
        score -= 0.2;
    }
    else if (normalized.length <= 120) {
        score += 0.06;
    }
    else if (normalized.length > 240) {
        score -= 0.08;
    }
    return { score: clamp01(score), reason: strongestReason };
}
function parseLlmJudgePayload(text) {
    if (!text.trim())
        return null;
    const trimmed = text.trim();
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    const candidate = fenced?.[1]?.trim() || trimmed;
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace)
        return null;
    try {
        const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
        const acceptedRaw = parsed.accepted;
        const decisionRaw = parsed.decision;
        const confidenceRaw = parsed.confidence;
        const reasonRaw = parsed.reason;
        const accepted = typeof acceptedRaw === 'boolean'
            ? acceptedRaw
            : typeof decisionRaw === 'string'
                ? /(accept|allow|yes|true|pass)/i.test(decisionRaw)
                : false;
        const confidence = clamp01(typeof confidenceRaw === 'number'
            ? confidenceRaw
            : typeof confidenceRaw === 'string'
                ? Number(confidenceRaw)
                : 0);
        const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : 'llm';
        return { accepted, confidence, reason };
    }
    catch {
        return null;
    }
}
async function judgeWithLlm(input, ruleScore, threshold, ruleReason) {
    if (!input.judgeComplete)
        return null;
    const normalizedText = normalizeText(input.text).slice(0, LLM_INPUT_MAX_CHARS);
    if (!normalizedText)
        return null;
    const userPrompt = JSON.stringify({
        text: normalizedText,
        is_explicit: input.isExplicit,
        guard_level: input.guardLevel,
        rule_score: Number(ruleScore.toFixed(3)),
        threshold: Number(threshold.toFixed(3)),
        rule_reason: ruleReason,
    });
    try {
        const text = await input.judgeComplete(exports.MEMORY_JUDGE_SYSTEM_PROMPT, userPrompt);
        const parsed = parseLlmJudgePayload(text);
        if (!parsed || parsed.confidence < LLM_MIN_CONFIDENCE) {
            return null;
        }
        return {
            accepted: parsed.accepted,
            score: parsed.confidence,
            reason: `llm:${parsed.reason || 'boundary'}`,
            source: 'llm',
        };
    }
    catch {
        return null;
    }
}
async function judgeMemoryCandidate(input) {
    const { score, reason } = scoreMemoryText(input.text);
    const threshold = thresholdByGuardLevel(input.isExplicit, input.guardLevel);
    const ruleResult = {
        accepted: score >= threshold,
        score,
        reason,
        source: 'rule',
    };
    if (!shouldCallLlmForBoundaryCase(score, threshold, reason)) {
        return ruleResult;
    }
    if (!input.judgeComplete) {
        return ruleResult;
    }
    const cacheKey = buildLlmCacheKey(input);
    const cached = getCachedLlmResult(cacheKey);
    if (cached) {
        return cached;
    }
    const llmResult = await judgeWithLlm(input, score, threshold, reason);
    if (!llmResult) {
        return ruleResult;
    }
    setCachedLlmResult(cacheKey, llmResult);
    return llmResult;
}
