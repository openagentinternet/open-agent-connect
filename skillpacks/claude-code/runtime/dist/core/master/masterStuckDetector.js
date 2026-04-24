"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assessMasterAskWorthiness = assessMasterAskWorthiness;
const DEFAULT_MIN_NO_PROGRESS_WINDOW_MS = 300_000;
function normalizeInteger(value, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.trunc(value));
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.trunc(parsed));
        }
    }
    return fallback;
}
function normalizeStuckLevel(score) {
    if (score >= 8) {
        return 'critical';
    }
    if (score >= 5) {
        return 'strong';
    }
    if (score >= 2) {
        return 'weak';
    }
    return 'none';
}
function roundConfidence(value) {
    return Math.round(Math.max(0, Math.min(0.99, value)) * 100) / 100;
}
function assessMasterAskWorthiness(observation, options = {}) {
    const minNoProgressWindowMs = normalizeInteger(options.minNoProgressWindowMs, DEFAULT_MIN_NO_PROGRESS_WINDOW_MS);
    const reasons = [];
    const uncertaintySignals = Array.isArray(observation.diagnostics.uncertaintySignals)
        ? observation.diagnostics.uncertaintySignals
        : [];
    const noProgressWindowMs = observation.activity.noProgressWindowMs ?? 0;
    let stuckScore = 0;
    const hasRepeatedFailures = observation.activity.repeatedFailureCount >= 2;
    const hasRecentFailureBurst = observation.activity.recentFailures >= 2;
    const hasNoProgress = noProgressWindowMs >= minNoProgressWindowMs;
    const hasFailureDiagnostics = observation.diagnostics.failingTests > 0 || observation.diagnostics.failingCommands > 0;
    const hasRepeatedSignatures = observation.diagnostics.repeatedErrorSignatures.length > 0;
    const reviewCheckpointRisk = observation.hints.reviewCheckpointRisk
        || uncertaintySignals.includes('review_checkpoint_risk')
        || uncertaintySignals.includes('patch_risk');
    if (hasRepeatedFailures) {
        stuckScore += 4;
        reasons.push('Repeated failures are accumulating without convergence.');
    }
    if (hasRecentFailureBurst) {
        stuckScore += 2;
    }
    if (observation.diagnostics.failingTests > 0) {
        stuckScore += 2;
    }
    if (observation.diagnostics.failingCommands > 0) {
        stuckScore += 1;
    }
    if (hasRepeatedSignatures) {
        stuckScore += 1;
    }
    if (hasNoProgress) {
        stuckScore += 3;
        reasons.push('No progress has been recorded for the configured observation window.');
    }
    if (observation.workState.todoBlocked) {
        stuckScore += 1;
    }
    if (observation.workState.onlyReadingWithoutConverging && hasNoProgress) {
        stuckScore += 1;
    }
    if (uncertaintySignals.some((signal) => /stuck|uncertain|loop|blocked/i.test(signal))) {
        stuckScore += 1;
    }
    const stuckLevel = normalizeStuckLevel(stuckScore);
    if (reviewCheckpointRisk) {
        reasons.push('Current work looks like a review checkpoint or patch-risk moment.');
    }
    let opportunityType = 'none';
    if (stuckLevel !== 'none') {
        opportunityType = 'stuck';
    }
    else if (reviewCheckpointRisk) {
        opportunityType = 'review_checkpoint';
    }
    let candidateMasterKind = observation.hints.candidateMasterKindHint;
    if (!candidateMasterKind) {
        if (opportunityType === 'review_checkpoint') {
            candidateMasterKind = 'review';
        }
        else if (hasFailureDiagnostics || hasRepeatedSignatures || hasRecentFailureBurst) {
            candidateMasterKind = 'debug';
        }
    }
    const hasAvailableMaster = observation.directory.availableMasters > 0 && observation.directory.onlineMasters > 0;
    const autoEligible = !observation.userIntent.explicitlyRejectedAutoAsk
        && hasAvailableMaster
        && (opportunityType === 'review_checkpoint'
            || stuckLevel === 'strong'
            || stuckLevel === 'critical');
    const confidenceBase = opportunityType === 'review_checkpoint'
        ? 0.68
        : stuckLevel === 'critical'
            ? 0.93
            : stuckLevel === 'strong'
                ? 0.82
                : stuckLevel === 'weak'
                    ? 0.55
                    : 0.1;
    return {
        opportunityType,
        stuckLevel,
        confidence: roundConfidence(confidenceBase),
        score: stuckScore,
        reasons,
        candidateMasterKind,
        autoEligible,
    };
}
