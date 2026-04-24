"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareAutoMasterAskPlan = prepareAutoMasterAskPlan;
const masterPolicyGate_1 = require("./masterPolicyGate");
const masterPreview_1 = require("./masterPreview");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeConfidence(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number.parseFloat(normalizeText(value));
    return Number.isFinite(parsed) ? parsed : null;
}
function prepareAutoMasterAskPlan(input) {
    const prepared = (0, masterPreview_1.buildMasterAskPreview)({
        draft: input.draft,
        resolvedTarget: input.resolvedTarget,
        caller: input.caller,
        traceId: 'trace-master-auto-plan',
        requestId: 'request-master-auto-plan',
        confirmationMode: input.config.confirmationMode,
    });
    const confidence = normalizeConfidence(input.auto.confidence);
    const policy = (0, masterPolicyGate_1.evaluateMasterPolicy)({
        config: input.config,
        action: 'auto_candidate',
        selectedMaster: input.resolvedTarget,
        auto: {
            sensitivity: prepared.preview.safety.sensitivity,
            confidence,
            traceAutoPrepareCount: input.auto.traceAutoPrepareCount,
            lastAutoAt: input.auto.lastAutoAt,
            now: input.auto.now,
        },
    });
    return {
        draft: input.draft,
        preparedSafety: prepared.preview.safety.sensitivity,
        policy,
        autoReason: normalizeText(input.auto.reason) || null,
        confidence,
    };
}
