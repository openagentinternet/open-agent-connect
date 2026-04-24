"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMasterAskContextMode = resolveMasterAskContextMode;
exports.resolvePublicMasterAskContextMode = resolvePublicMasterAskContextMode;
exports.getMasterContextBudget = getMasterContextBudget;
const MASTER_CONTEXT_BUDGETS = {
    compact: {
        relevantFiles: 3,
        artifacts: 3,
        artifactChars: 320,
    },
    standard: {
        relevantFiles: 8,
        artifacts: 8,
        artifactChars: 1200,
    },
};
function normalizeText(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
function resolveMasterAskContextMode(value) {
    const normalized = normalizeText(value);
    if (normalized === 'compact' || normalized === 'full_task') {
        return normalized;
    }
    return 'standard';
}
function resolvePublicMasterAskContextMode(value) {
    const resolved = resolveMasterAskContextMode(value);
    return resolved === 'compact' ? 'compact' : 'standard';
}
function getMasterContextBudget(value) {
    return MASTER_CONTEXT_BUDGETS[resolvePublicMasterAskContextMode(value)];
}
