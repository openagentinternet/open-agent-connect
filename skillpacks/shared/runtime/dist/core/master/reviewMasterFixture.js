"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOfficialReviewMaster = runOfficialReviewMaster;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const normalized = [];
    for (const entry of value) {
        const text = normalizeText(entry);
        if (!text) {
            continue;
        }
        normalized.push(text);
    }
    return normalized;
}
function collectSignals(request) {
    const extensions = request.extensions ?? {};
    const parts = [
        request.task.userTask,
        request.task.question,
        request.context.workspaceSummary,
        normalizeText(extensions.goal),
        normalizeText(extensions.diffSummary),
        normalizeText(extensions.errorSummary),
        ...normalizeStringArray(extensions.constraints),
        ...request.context.relevantFiles,
        ...request.context.artifacts.flatMap((artifact) => [artifact.label, artifact.content]),
    ];
    return parts
        .map((entry) => normalizeText(entry).toLowerCase())
        .filter(Boolean)
        .join('\n');
}
function buildCompleted(input) {
    return {
        state: 'completed',
        summary: input.summary,
        findings: [...input.findings],
        recommendations: [...input.recommendations],
        risks: [...input.risks],
        confidence: input.confidence,
        followUpQuestion: input.followUpQuestion,
    };
}
function buildNeedMoreContext(input) {
    return {
        state: 'need_more_context',
        summary: input.summary,
        missing: [...input.missing],
        followUpQuestion: input.followUpQuestion,
        risks: [...input.risks],
    };
}
function looksTooVague(request) {
    const extensions = request.extensions ?? {};
    const hasDiffSummary = normalizeText(extensions.diffSummary).length > 0;
    const hasWorkspaceSummary = normalizeText(request.context.workspaceSummary).length > 0;
    const hasRelevantFiles = request.context.relevantFiles.length > 0;
    const hasArtifacts = request.context.artifacts.length > 0;
    if (hasDiffSummary || hasWorkspaceSummary || hasRelevantFiles || hasArtifacts) {
        return false;
    }
    return normalizeText(request.task.question).split(/\s+/).length <= 5;
}
function isPatchReviewCase(signals) {
    return signals.includes('review')
        || signals.includes('patch')
        || signals.includes('diff')
        || signals.includes('regression')
        || signals.includes('risk')
        || signals.includes('checkpoint');
}
function runOfficialReviewMaster(input) {
    const request = input.request;
    const signals = collectSignals(request);
    if (looksTooVague(request)) {
        return buildNeedMoreContext({
            summary: 'The current request is too vague for a reliable review pass.',
            missing: [
                'A short diff summary or a few changed file paths.',
                'The main regression risk or review concern you want checked first.',
            ],
            followUpQuestion: 'Can you share the diff summary or the main patch risk you want reviewed first?',
            risks: [
                'Without patch context, any review findings would be speculative.',
            ],
        });
    }
    if (isPatchReviewCase(signals)) {
        return buildCompleted({
            summary: 'This change set is worth a focused review pass before continuing, with the main risks centered on behavior drift and coverage gaps.',
            findings: [
                'Changes that reroute master selection can silently send the caller to the wrong master kind if ranking starts to override kind filtering.',
                'Trusted low-friction paths need regression coverage so non-sensitive review flows do not weaken the fallback behavior for debug or sensitive requests.',
                'Trace and artifact exports should stay aligned with the selected master kind, or review guidance becomes harder to audit after the run completes.',
            ],
            recommendations: [
                'Add one review-targeted auto-flow test that proves the selected outbound request keeps `masterKind=review` all the way to the wire payload.',
                'Keep one provider-runtime fixture test for Official Review Master so the second official fixture remains callable after future refactors.',
                'Review the selector ordering whenever trust or recency scoring changes, and preserve the master-kind filter as the first hard boundary.',
            ],
            risks: [
                'If review routing regresses, users can get a plausible but wrong answer from Debug Master instead of a real review pass.',
                'If trusted auto send widens too far, review requests may skip the safety semantics intended for sensitive or ambiguous payloads.',
            ],
            confidence: 0.86,
            followUpQuestion: 'If you want a narrower pass, can you share the exact diff hunk or assertion you are most worried about?',
        });
    }
    return buildCompleted({
        summary: 'Start with the highest-impact behavior changes, then verify that the supporting tests still cover the intended routing and safety boundaries.',
        findings: [
            'The request looks reviewable, but the current context does not point to one single dominant regression yet.',
            'The most useful next step is to anchor the review around routing, policy, or trace behavior rather than general code style.',
        ],
        recommendations: [
            'Identify the one or two user-visible behaviors this patch changes and confirm tests pin them down directly.',
            'Prefer targeted assertions on routing and exported state over broad snapshot-only checks.',
        ],
        risks: [
            'A broad review request without a focal risk can miss the highest-value behavior change.',
        ],
        confidence: 0.72,
        followUpQuestion: 'Which specific behavior change should the review focus on first?',
    });
}
