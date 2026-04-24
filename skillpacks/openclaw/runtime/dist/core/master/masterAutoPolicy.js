"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateMasterAutoPolicy = evaluateMasterAutoPolicy;
const configTypes_1 = require("../config/configTypes");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const normalized = [];
    for (const entry of value) {
        const text = normalizeText(entry);
        if (!text || seen.has(text)) {
            continue;
        }
        seen.add(text);
        normalized.push(text);
    }
    return normalized;
}
function normalizeNonNegativeInteger(value, fallback) {
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
function normalizeConfidence(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.min(0.99, value));
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.min(0.99, parsed));
        }
    }
    return null;
}
function normalizeSensitivity(value) {
    if (!value || typeof value !== 'object') {
        return {
            isSensitive: true,
            reasons: ['Payload safety summary is not available yet.'],
        };
    }
    return {
        isSensitive: value?.isSensitive === true,
        reasons: normalizeStringArray(value?.reasons),
    };
}
function normalizeConfig(config) {
    const defaults = (0, configTypes_1.createDefaultConfig)().askMaster;
    return {
        enabled: config?.enabled !== false,
        triggerMode: config?.triggerMode === 'suggest' || config?.triggerMode === 'auto'
            ? config.triggerMode
            : defaults.triggerMode,
        confirmationMode: config?.confirmationMode === 'sensitive_only' || config?.confirmationMode === 'never'
            ? config.confirmationMode
            : defaults.confirmationMode,
        contextMode: config?.contextMode === 'compact' || config?.contextMode === 'full_task'
            ? config.contextMode
            : defaults.contextMode,
        trustedMasters: Array.isArray(config?.trustedMasters)
            ? normalizeStringArray(config?.trustedMasters)
            : [...defaults.trustedMasters],
        autoPolicy: {
            minConfidence: normalizeConfidence(config?.autoPolicy?.minConfidence) ?? defaults.autoPolicy.minConfidence,
            minNoProgressWindowMs: normalizeNonNegativeInteger(config?.autoPolicy?.minNoProgressWindowMs, defaults.autoPolicy.minNoProgressWindowMs),
            perTraceLimit: Math.max(1, normalizeNonNegativeInteger(config?.autoPolicy?.perTraceLimit, defaults.autoPolicy.perTraceLimit)),
            globalCooldownMs: normalizeNonNegativeInteger(config?.autoPolicy?.globalCooldownMs, defaults.autoPolicy.globalCooldownMs),
            allowTrustedAutoSend: config?.autoPolicy?.allowTrustedAutoSend === true,
        },
    };
}
function buildDecision(input) {
    return {
        allowed: input.allowed,
        code: input.code ?? null,
        blockedReason: input.blockedReason ?? null,
        selectedFrictionMode: input.selectedFrictionMode,
        requiresConfirmation: input.requiresConfirmation,
        contextMode: input.contextMode,
        sensitivity: input.sensitivity,
        trustedTarget: input.trustedTarget,
        confidence: input.confidence,
        policyReason: input.policyReason ?? null,
    };
}
function isTrustedMaster(selectedMaster, trustedMasters) {
    if (!selectedMaster) {
        return false;
    }
    if (selectedMaster.official || normalizeText(selectedMaster.trustedTier)) {
        return true;
    }
    const candidateIds = normalizeStringArray([
        selectedMaster.masterPinId,
        selectedMaster.sourceMasterPinId,
        ...(Array.isArray(selectedMaster.chainPinIds) ? selectedMaster.chainPinIds : []),
    ]);
    return candidateIds.some((entry) => trustedMasters.includes(entry));
}
function evaluateMasterAutoPolicy(input) {
    const config = normalizeConfig(input.config);
    const sensitivity = normalizeSensitivity(input.sensitivity);
    const confidence = normalizeConfidence(input.confidence);
    const traceAutoPrepareCount = normalizeNonNegativeInteger(input.traceAutoPrepareCount, 0);
    const now = normalizeNonNegativeInteger(input.now, Date.now());
    const lastAutoAt = normalizeNonNegativeInteger(input.lastAutoAt, -1);
    const trustedTarget = isTrustedMaster(input.selectedMaster, config.trustedMasters);
    if (!config.enabled) {
        return buildDecision({
            allowed: false,
            code: 'ask_master_disabled',
            blockedReason: 'Ask Master is disabled by local config.',
            selectedFrictionMode: 'preview_confirm',
            requiresConfirmation: true,
            contextMode: config.contextMode,
            sensitivity,
            trustedTarget,
            confidence,
            policyReason: 'Ask Master is globally disabled.',
        });
    }
    if (config.triggerMode !== 'auto') {
        return buildDecision({
            allowed: false,
            code: 'trigger_mode_disallows_auto',
            blockedReason: 'Ask Master trigger mode does not allow auto candidate.',
            selectedFrictionMode: 'preview_confirm',
            requiresConfirmation: true,
            contextMode: config.contextMode,
            sensitivity,
            trustedTarget,
            confidence,
            policyReason: 'Automatic Ask Master is disabled in the local trigger mode.',
        });
    }
    if (confidence !== null && confidence < config.autoPolicy.minConfidence) {
        return buildDecision({
            allowed: false,
            code: 'auto_confidence_too_low',
            blockedReason: `Auto Ask confidence ${confidence} is below the configured threshold ${config.autoPolicy.minConfidence}.`,
            selectedFrictionMode: 'preview_confirm',
            requiresConfirmation: true,
            contextMode: config.contextMode,
            sensitivity,
            trustedTarget,
            confidence,
            policyReason: 'The current signals are not strong enough for automatic Ask Master preparation.',
        });
    }
    if (traceAutoPrepareCount >= config.autoPolicy.perTraceLimit) {
        return buildDecision({
            allowed: false,
            code: 'auto_per_trace_limited',
            blockedReason: 'Auto Ask Master hit the configured per-trace limit.',
            selectedFrictionMode: 'preview_confirm',
            requiresConfirmation: true,
            contextMode: config.contextMode,
            sensitivity,
            trustedTarget,
            confidence,
            policyReason: 'This trace already consumed the configured auto-prepare budget.',
        });
    }
    if (lastAutoAt >= 0
        && config.autoPolicy.globalCooldownMs > 0
        && now - lastAutoAt < config.autoPolicy.globalCooldownMs) {
        return buildDecision({
            allowed: false,
            code: 'auto_global_cooldown',
            blockedReason: 'Auto Ask Master is still inside the configured global cooldown window.',
            selectedFrictionMode: 'preview_confirm',
            requiresConfirmation: true,
            contextMode: config.contextMode,
            sensitivity,
            trustedTarget,
            confidence,
            policyReason: 'Recent automatic Ask Master activity is being throttled.',
        });
    }
    if (config.confirmationMode === 'always') {
        return buildDecision({
            allowed: true,
            selectedFrictionMode: 'preview_confirm',
            requiresConfirmation: true,
            contextMode: config.contextMode,
            sensitivity,
            trustedTarget,
            confidence,
            policyReason: 'Confirmation mode always requires a preview confirmation step.',
        });
    }
    if (sensitivity.isSensitive) {
        return buildDecision({
            allowed: true,
            selectedFrictionMode: 'preview_confirm',
            requiresConfirmation: true,
            contextMode: config.contextMode,
            sensitivity,
            trustedTarget,
            confidence,
            policyReason: 'Sensitive payloads must fall back to preview confirmation.',
        });
    }
    if (!trustedTarget) {
        return buildDecision({
            allowed: true,
            selectedFrictionMode: 'preview_confirm',
            requiresConfirmation: true,
            contextMode: config.contextMode,
            sensitivity,
            trustedTarget,
            confidence,
            policyReason: 'Low-friction auto send requires a trusted Master target.',
        });
    }
    if (config.confirmationMode === 'sensitive_only') {
        return buildDecision({
            allowed: true,
            selectedFrictionMode: 'direct_send',
            requiresConfirmation: false,
            contextMode: config.contextMode,
            sensitivity,
            trustedTarget,
            confidence,
            policyReason: 'Trusted non-sensitive payload may skip confirmation under sensitive_only mode.',
        });
    }
    if (config.confirmationMode === 'never' && config.autoPolicy.allowTrustedAutoSend) {
        return buildDecision({
            allowed: true,
            selectedFrictionMode: 'direct_send',
            requiresConfirmation: false,
            contextMode: config.contextMode,
            sensitivity,
            trustedTarget,
            confidence,
            policyReason: 'Trusted non-sensitive payload is allowed to send directly under never mode.',
        });
    }
    return buildDecision({
        allowed: true,
        selectedFrictionMode: 'preview_confirm',
        requiresConfirmation: true,
        contextMode: config.contextMode,
        sensitivity,
        trustedTarget,
        confidence,
        policyReason: 'Direct send is still disabled because trusted auto send is not explicitly enabled.',
    });
}
