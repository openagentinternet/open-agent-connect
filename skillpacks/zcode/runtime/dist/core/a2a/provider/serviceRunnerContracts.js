"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isProviderServiceRunnerResult = isProviderServiceRunnerResult;
exports.createServiceRunnerFailedResult = createServiceRunnerFailedResult;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function isProviderServiceRunnerResult(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const state = normalizeText(value.state);
    if (state === 'completed') {
        return typeof value.responseText === 'string';
    }
    if (state === 'needs_clarification') {
        return typeof value.question === 'string';
    }
    if (state === 'failed') {
        return typeof value.code === 'string'
            && typeof value.message === 'string';
    }
    return false;
}
function createServiceRunnerFailedResult(code, message, retryable = false) {
    return {
        state: 'failed',
        code: normalizeText(code) || 'service_runner_failed',
        message: normalizeText(message) || 'Provider service runner failed.',
        retryable,
    };
}
