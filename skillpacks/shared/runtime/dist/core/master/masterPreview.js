"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMasterAskPreview = buildMasterAskPreview;
const masterMessageSchema_1 = require("./masterMessageSchema");
const masterContextTypes_1 = require("./masterContextTypes");
const masterContextSanitizer_1 = require("./masterContextSanitizer");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function resolveTriggerMode(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'suggest' || normalized === 'auto') {
        return normalized;
    }
    return 'manual';
}
function resolveDesiredOutputMode(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return normalizeText(value.mode) || null;
    }
    return normalizeText(value) || null;
}
function readExtensionStrings(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return [];
    }
    const extension = value;
    const strings = [];
    for (const entry of [
        extension.goal,
        extension.errorSummary,
        extension.diffSummary,
        extension.constraints,
    ]) {
        if (typeof entry === 'string') {
            const text = normalizeText(entry);
            if (text) {
                strings.push(text);
            }
            continue;
        }
        if (Array.isArray(entry)) {
            for (const item of entry) {
                const text = normalizeText(item);
                if (text) {
                    strings.push(text);
                }
            }
        }
    }
    return strings;
}
function appendSafetyReason(reasons, reason) {
    if (!reasons.includes(reason)) {
        reasons.push(reason);
    }
}
function stillLooksSensitive(value) {
    return /\b(token|secret|credential|password)\b/i.test(value);
}
function buildMasterPayloadSafetySummary(request) {
    const reasons = [];
    const textFields = [
        request.task.userTask,
        request.task.question,
        request.context.workspaceSummary ?? '',
        ...readExtensionStrings(request.extensions),
    ].filter(Boolean);
    for (const field of textFields) {
        if ((0, masterContextSanitizer_1.hasSensitiveContent)(field)) {
            appendSafetyReason(reasons, 'Request payload still includes secret-like content.');
        }
        if ((0, masterContextSanitizer_1.hasSensitivePathSnippet)(field)) {
            appendSafetyReason(reasons, 'Request payload still references a sensitive file path.');
        }
        if (stillLooksSensitive(field)) {
            appendSafetyReason(reasons, 'Request payload still references potentially sensitive auth material.');
        }
    }
    for (const filePath of request.context.relevantFiles) {
        if ((0, masterContextSanitizer_1.isSensitivePath)(filePath)) {
            appendSafetyReason(reasons, 'Request payload still references a sensitive file path.');
        }
    }
    for (const artifact of request.context.artifacts) {
        if ((0, masterContextSanitizer_1.hasSensitiveContent)(artifact.label) || (0, masterContextSanitizer_1.hasSensitiveContent)(artifact.content)) {
            appendSafetyReason(reasons, 'Request artifact still includes secret-like content.');
        }
        if ((0, masterContextSanitizer_1.hasSensitivePathSnippet)(artifact.label) || (0, masterContextSanitizer_1.hasSensitivePathSnippet)(artifact.content)) {
            appendSafetyReason(reasons, 'Request artifact still references a sensitive file path.');
        }
        if (stillLooksSensitive(artifact.label) || stillLooksSensitive(artifact.content)) {
            appendSafetyReason(reasons, 'Request artifact still references potentially sensitive auth material.');
        }
    }
    return {
        isSensitive: reasons.length > 0,
        reasons,
    };
}
function buildMasterAskPreview(input) {
    const draft = input.draft;
    const rawUserTask = normalizeText(draft.userTask);
    const rawQuestion = normalizeText(draft.question);
    if (!rawUserTask || !rawQuestion) {
        throw new Error('Master ask draft must include userTask and question.');
    }
    const userTask = (0, masterContextSanitizer_1.sanitizeTaskText)(rawUserTask, rawUserTask);
    const question = (0, masterContextSanitizer_1.sanitizeTaskText)(rawQuestion, rawQuestion);
    const contextMode = (0, masterContextTypes_1.resolvePublicMasterAskContextMode)(draft.contextMode);
    const budget = (0, masterContextTypes_1.getMasterContextBudget)(contextMode);
    const relevantFiles = (0, masterContextSanitizer_1.sanitizeRelevantFiles)(draft.relevantFiles, budget.relevantFiles);
    const artifacts = (0, masterContextSanitizer_1.sanitizeArtifacts)(draft.artifacts, budget.artifacts, budget.artifactChars);
    const constraints = (0, masterContextSanitizer_1.sanitizeConstraintList)(draft.constraints);
    const triggerMode = resolveTriggerMode(draft.triggerMode);
    const desiredOutputMode = resolveDesiredOutputMode(draft.desiredOutput) || 'structured_help';
    const goal = (0, masterContextSanitizer_1.sanitizeSummaryText)(draft.goal);
    const workspaceSummary = (0, masterContextSanitizer_1.sanitizeSummaryText)(draft.workspaceSummary);
    const errorSummary = (0, masterContextSanitizer_1.sanitizeSummaryText)(draft.errorSummary);
    const diffSummary = (0, masterContextSanitizer_1.sanitizeSummaryText)(draft.diffSummary);
    const requestJson = (0, masterMessageSchema_1.buildMasterRequestJson)({
        type: 'master_request',
        version: '1.0.0',
        requestId: input.requestId,
        traceId: input.traceId,
        caller: {
            globalMetaId: input.caller.globalMetaId,
            name: input.caller.name ?? null,
            host: input.caller.host,
        },
        target: {
            masterServicePinId: input.resolvedTarget.masterPinId,
            providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
            masterKind: input.resolvedTarget.masterKind,
        },
        task: {
            userTask,
            question,
        },
        context: {
            workspaceSummary,
            relevantFiles,
            artifacts,
        },
        trigger: {
            mode: triggerMode,
            reason: triggerMode === 'manual'
                ? 'Caller explicitly requested Ask Master preview.'
                : 'Caller runtime suggested consulting a Master.',
        },
        desiredOutput: desiredOutputMode,
        extensions: {
            goal,
            errorSummary,
            diffSummary,
            constraints,
            contextMode,
            targetDisplayName: normalizeText(draft.target?.displayName) || input.resolvedTarget.displayName,
        },
    });
    const parsedRequest = (0, masterMessageSchema_1.parseMasterRequest)(requestJson);
    if (!parsedRequest.ok) {
        throw new Error(parsedRequest.message);
    }
    const safetySummary = buildMasterPayloadSafetySummary(parsedRequest.value);
    const requiresConfirmation = input.requiresConfirmationOverride ?? input.confirmationMode !== 'never';
    return {
        request: parsedRequest.value,
        requestJson,
        preview: {
            target: {
                displayName: input.resolvedTarget.displayName,
                masterKind: input.resolvedTarget.masterKind,
                providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
                servicePinId: input.resolvedTarget.masterPinId,
                official: input.resolvedTarget.official,
                trustedTier: input.resolvedTarget.trustedTier,
                pricingMode: input.resolvedTarget.pricingMode,
                hostModes: [...input.resolvedTarget.hostModes],
            },
            intent: {
                userTask,
                question,
                goal,
            },
            context: {
                contextMode,
                workspaceSummary,
                errorSummary,
                diffSummary,
                relevantFiles,
                artifacts,
                constraints,
            },
            safety: {
                noImplicitRepoUpload: true,
                noImplicitSecrets: true,
                transport: 'simplemsg',
                deliveryTarget: input.resolvedTarget.providerGlobalMetaId,
                sensitivity: safetySummary,
            },
            confirmation: {
                requiresConfirmation,
                policyMode: input.confirmationMode,
                frictionMode: requiresConfirmation ? 'preview_confirm' : 'direct_send',
                confirmCommand: `metabot master ask --trace-id ${input.traceId} --confirm`,
            },
            request: parsedRequest.value,
        },
    };
}
