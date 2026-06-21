"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELEGATION_POLICY_REASON = void 0;
exports.resolveDelegationPolicyMode = resolveDelegationPolicyMode;
exports.evaluateDelegationPolicy = evaluateDelegationPolicy;
const DEFAULT_POLICY_MODE = 'confirm_all';
const PUBLIC_ENABLED_POLICY_MODES = new Set([
    'confirm_all',
    'confirm_paid_only',
    'auto_when_safe',
]);
exports.DELEGATION_POLICY_REASON = {
    confirmAllRequiresConfirmation: 'confirm_all_requires_confirmation',
    paidServiceRequiresConfirmation: 'paid_service_requires_confirmation',
    freeServiceAutoApproved: 'free_service_auto_approved',
    policyModeNotPubliclyEnabled: 'policy_mode_not_publicly_enabled',
};
function isDelegationPolicyMode(value) {
    return value === 'confirm_all'
        || value === 'confirm_paid_only'
        || value === 'auto_when_safe';
}
function resolveDelegationPolicyMode(rawPolicyMode, fallback = DEFAULT_POLICY_MODE) {
    if (typeof rawPolicyMode !== 'string') {
        return fallback;
    }
    const normalized = rawPolicyMode.trim().toLowerCase();
    if (isDelegationPolicyMode(normalized)) {
        return normalized;
    }
    return fallback;
}
function isExplicitZeroCostAmount(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
        return false;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed === 0;
}
function evaluateDelegationPolicy(input = {}) {
    const requestedPolicyMode = resolveDelegationPolicyMode(input.policyMode);
    const isPubliclyEnabled = PUBLIC_ENABLED_POLICY_MODES.has(requestedPolicyMode);
    if (!isPubliclyEnabled) {
        return {
            requiresConfirmation: true,
            policyMode: DEFAULT_POLICY_MODE,
            policyReason: exports.DELEGATION_POLICY_REASON.policyModeNotPubliclyEnabled,
            requestedPolicyMode,
            confirmationBypassed: false,
            bypassReason: null,
        };
    }
    if (requestedPolicyMode === 'confirm_paid_only' || requestedPolicyMode === 'auto_when_safe') {
        if (isExplicitZeroCostAmount(input.estimatedCostAmount)) {
            return {
                requiresConfirmation: false,
                policyMode: requestedPolicyMode,
                policyReason: exports.DELEGATION_POLICY_REASON.freeServiceAutoApproved,
                requestedPolicyMode,
                confirmationBypassed: true,
                bypassReason: 'free_service',
            };
        }
        return {
            requiresConfirmation: true,
            policyMode: requestedPolicyMode,
            policyReason: exports.DELEGATION_POLICY_REASON.paidServiceRequiresConfirmation,
            requestedPolicyMode,
            confirmationBypassed: false,
            bypassReason: null,
        };
    }
    return {
        requiresConfirmation: true,
        policyMode: requestedPolicyMode,
        policyReason: exports.DELEGATION_POLICY_REASON.confirmAllRequiresConfirmation,
        requestedPolicyMode,
        confirmationBypassed: false,
        bypassReason: null,
    };
}
