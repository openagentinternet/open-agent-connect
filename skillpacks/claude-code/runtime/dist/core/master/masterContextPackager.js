"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.packageMasterContextForAsk = packageMasterContextForAsk;
const masterContextTypes_1 = require("./masterContextTypes");
const masterContextSanitizer_1 = require("./masterContextSanitizer");
function normalizeText(value) {
    return typeof value === 'string'
        ? value.replace(/\s+/g, ' ').trim()
        : '';
}
function normalizeNullableText(value) {
    const normalized = normalizeText(value);
    return normalized || null;
}
function deriveDefaultQuestion(collected) {
    if (collected.questionCandidate) {
        return collected.questionCandidate;
    }
    const safeErrorSignature = (0, masterContextSanitizer_1.sanitizeSummaryText)(collected.diagnostics.repeatedErrorSignatures[0]);
    if (safeErrorSignature) {
        return `What is the most likely root cause of "${safeErrorSignature}", and what should I try next?`;
    }
    if (collected.diagnostics.failingTests[0]) {
        return `Why is "${collected.diagnostics.failingTests[0]}" failing, and what should I try next?`;
    }
    return 'What is the most likely root cause and the next best fix?';
}
function normalizeTriggerMode(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'suggest' || normalized === 'auto') {
        return normalized;
    }
    return 'manual';
}
function packageMasterContextForAsk(input) {
    const contextMode = (0, masterContextTypes_1.resolvePublicMasterAskContextMode)(input.contextMode);
    const budget = (0, masterContextTypes_1.getMasterContextBudget)(contextMode);
    const defaultUserTask = 'Diagnose the current blocked task with Ask Master.';
    const defaultQuestion = 'What is the most likely root cause and the next best fix?';
    const userTask = (0, masterContextSanitizer_1.sanitizeTaskText)(normalizeNullableText(input.explicitUserTask)
        ?? input.collected.taskSummary
        ?? defaultUserTask, defaultUserTask);
    const question = (0, masterContextSanitizer_1.sanitizeTaskText)(normalizeNullableText(input.explicitQuestion)
        ?? deriveDefaultQuestion(input.collected), defaultQuestion);
    const relevantFiles = (0, masterContextSanitizer_1.sanitizeRelevantFiles)(input.collected.workState.relevantFiles, budget.relevantFiles);
    const artifacts = (0, masterContextSanitizer_1.sanitizeArtifacts)(input.collected.artifacts, budget.artifacts, budget.artifactChars)
        .map((artifact) => ({
        kind: 'text',
        label: artifact.label,
        content: artifact.content,
    }));
    return {
        target: input.target ?? undefined,
        triggerMode: normalizeTriggerMode(input.triggerMode),
        contextMode,
        userTask,
        question,
        goal: (0, masterContextSanitizer_1.sanitizeSummaryText)(input.collected.workState.goal),
        workspaceSummary: (0, masterContextSanitizer_1.sanitizeSummaryText)(input.collected.workspaceSummary),
        errorSummary: (0, masterContextSanitizer_1.sanitizeSummaryText)(input.collected.workState.errorSummary),
        diffSummary: (0, masterContextSanitizer_1.sanitizeSummaryText)(input.collected.workState.diffSummary),
        relevantFiles,
        artifacts,
        constraints: (0, masterContextSanitizer_1.sanitizeConstraintList)(input.collected.workState.constraints),
        desiredOutput: {
            mode: normalizeNullableText(input.desiredOutputMode) ?? 'structured_help',
        },
    };
}
