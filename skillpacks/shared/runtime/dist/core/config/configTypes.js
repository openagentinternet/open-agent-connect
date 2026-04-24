"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASK_MASTER_CONTEXT_MODES = exports.ASK_MASTER_CONFIRMATION_MODES = exports.ASK_MASTER_TRIGGER_MODES = void 0;
exports.isAskMasterTriggerMode = isAskMasterTriggerMode;
exports.isAskMasterConfirmationMode = isAskMasterConfirmationMode;
exports.isAskMasterContextMode = isAskMasterContextMode;
exports.createDefaultAskMasterAutoPolicyConfig = createDefaultAskMasterAutoPolicyConfig;
exports.normalizeAskMasterAutoPolicyConfig = normalizeAskMasterAutoPolicyConfig;
exports.createDefaultConfig = createDefaultConfig;
exports.ASK_MASTER_TRIGGER_MODES = ['manual', 'suggest', 'auto'];
exports.ASK_MASTER_CONFIRMATION_MODES = ['always', 'sensitive_only', 'never'];
exports.ASK_MASTER_CONTEXT_MODES = ['compact', 'standard', 'full_task'];
function isAskMasterTriggerMode(value) {
    return typeof value === 'string' && exports.ASK_MASTER_TRIGGER_MODES.includes(value);
}
function isAskMasterConfirmationMode(value) {
    return typeof value === 'string' && exports.ASK_MASTER_CONFIRMATION_MODES.includes(value);
}
function isAskMasterContextMode(value) {
    return typeof value === 'string' && exports.ASK_MASTER_CONTEXT_MODES.includes(value);
}
function normalizeFiniteNumber(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
}
function normalizeNonNegativeInteger(value, fallback) {
    const normalized = normalizeFiniteNumber(value, fallback);
    return Math.max(0, Math.trunc(normalized));
}
function createDefaultAskMasterAutoPolicyConfig() {
    return {
        minConfidence: 0.9,
        minNoProgressWindowMs: 300_000,
        perTraceLimit: 1,
        globalCooldownMs: 1_800_000,
        allowTrustedAutoSend: false,
    };
}
function normalizeAskMasterAutoPolicyConfig(value) {
    const defaults = createDefaultAskMasterAutoPolicyConfig();
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    return {
        minConfidence: Math.max(0, Math.min(0.99, normalizeFiniteNumber(source.minConfidence, defaults.minConfidence))),
        minNoProgressWindowMs: normalizeNonNegativeInteger(source.minNoProgressWindowMs, defaults.minNoProgressWindowMs),
        perTraceLimit: Math.max(1, normalizeNonNegativeInteger(source.perTraceLimit, defaults.perTraceLimit)),
        globalCooldownMs: normalizeNonNegativeInteger(source.globalCooldownMs, defaults.globalCooldownMs),
        allowTrustedAutoSend: typeof source.allowTrustedAutoSend === 'boolean'
            ? source.allowTrustedAutoSend
            : defaults.allowTrustedAutoSend,
    };
}
function createDefaultConfig() {
    return {
        evolution_network: {
            enabled: true,
            autoAdoptSameSkillSameScope: false,
            autoRecordExecutions: true
        },
        askMaster: {
            enabled: true,
            triggerMode: 'suggest',
            confirmationMode: 'always',
            contextMode: 'standard',
            trustedMasters: [],
            autoPolicy: createDefaultAskMasterAutoPolicyConfig(),
        },
    };
}
