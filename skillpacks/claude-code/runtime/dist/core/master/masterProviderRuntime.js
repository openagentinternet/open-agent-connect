"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMasterProviderRequest = handleMasterProviderRequest;
const sessionEngine_1 = require("../a2a/sessionEngine");
const masterMessageSchema_1 = require("./masterMessageSchema");
const debugMasterFixture_1 = require("./debugMasterFixture");
const reviewMasterFixture_1 = require("./reviewMasterFixture");
const masterTypes_1 = require("./masterTypes");
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
function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function buildInvalidRunnerResult(message) {
    return {
        state: 'failed',
        code: 'invalid_master_runner_result',
        message,
    };
}
function normalizeRunnerResult(value) {
    if (!isObject(value)) {
        return buildInvalidRunnerResult('Master runner returned a non-object result.');
    }
    const state = normalizeText(value.state);
    if (state === 'completed') {
        const summary = normalizeText(value.summary);
        if (!summary
            || !Array.isArray(value.findings)
            || !Array.isArray(value.recommendations)
            || !Array.isArray(value.risks)) {
            return buildInvalidRunnerResult('Invalid master runner result for completed state.');
        }
        return {
            state: 'completed',
            summary,
            findings: normalizeStringArray(value.findings),
            recommendations: normalizeStringArray(value.recommendations),
            risks: normalizeStringArray(value.risks),
            confidence: typeof value.confidence === 'number' && Number.isFinite(value.confidence)
                ? Number(value.confidence)
                : null,
            followUpQuestion: normalizeText(value.followUpQuestion) || null,
            responseText: normalizeText(value.responseText) || null,
            metadata: isObject(value.metadata) ? value.metadata : null,
        };
    }
    if (state === 'need_more_context') {
        const summary = normalizeText(value.summary);
        const followUpQuestion = normalizeText(value.followUpQuestion);
        if (!summary || !Array.isArray(value.missing) || !followUpQuestion) {
            return buildInvalidRunnerResult('Invalid master runner result for need_more_context state.');
        }
        return {
            state: 'need_more_context',
            summary,
            missing: normalizeStringArray(value.missing),
            followUpQuestion,
            risks: normalizeStringArray(value.risks),
            metadata: isObject(value.metadata) ? value.metadata : null,
        };
    }
    if (state === 'declined') {
        const reason = normalizeText(value.reason);
        if (!reason) {
            return buildInvalidRunnerResult('Invalid master runner result for declined state.');
        }
        return {
            state: 'declined',
            reason,
            risks: normalizeStringArray(value.risks),
            followUpQuestion: normalizeText(value.followUpQuestion) || null,
            metadata: isObject(value.metadata) ? value.metadata : null,
        };
    }
    if (state === 'failed') {
        const code = normalizeText(value.code);
        const message = normalizeText(value.message);
        if (!code || !message) {
            return buildInvalidRunnerResult('Invalid master runner result for failed state.');
        }
        return {
            state: 'failed',
            code,
            message,
            metadata: isObject(value.metadata) ? value.metadata : null,
        };
    }
    return buildInvalidRunnerResult('Master runner returned an unknown state.');
}
function buildTaskContext(request) {
    const extensions = request.extensions ?? {};
    const lines = [
        request.context.workspaceSummary ? `workspace: ${request.context.workspaceSummary}` : '',
        normalizeText(extensions.goal) ? `goal: ${normalizeText(extensions.goal)}` : '',
        normalizeText(extensions.errorSummary) ? `errorSummary: ${normalizeText(extensions.errorSummary)}` : '',
        normalizeText(extensions.diffSummary) ? `diffSummary: ${normalizeText(extensions.diffSummary)}` : '',
        ...normalizeStringArray(extensions.constraints).map((entry) => `constraint: ${entry}`),
        ...request.context.relevantFiles.map((entry) => `file: ${entry}`),
        ...request.context.artifacts.map((artifact) => `artifact ${artifact.label}: ${artifact.content}`),
    ].filter(Boolean);
    return lines.join('\n');
}
function resolvePublishedMaster(publishedMasters, request) {
    const servicePinId = normalizeText(request.target.masterServicePinId);
    const providerGlobalMetaId = normalizeText(request.target.providerGlobalMetaId);
    const masterKind = normalizeText(request.target.masterKind);
    return publishedMasters.find((entry) => (entry.available === 1
        && normalizeText(entry.currentPinId) === servicePinId
        && normalizeText(entry.providerGlobalMetaId) === providerGlobalMetaId
        && normalizeText(entry.masterKind) === masterKind)) ?? null;
}
function resolveDefaultRunner(input) {
    if (normalizeText(input.publishedMaster.masterKind) === masterTypes_1.MASTER_KIND_DEBUG
        && normalizeText(input.publishedMaster.serviceName) === masterTypes_1.OFFICIAL_DEBUG_MASTER_SERVICE_NAME) {
        return ({ request }) => (0, debugMasterFixture_1.runOfficialDebugMaster)({ request });
    }
    if (normalizeText(input.publishedMaster.masterKind) === masterTypes_1.MASTER_KIND_REVIEW
        && normalizeText(input.publishedMaster.serviceName) === masterTypes_1.OFFICIAL_REVIEW_MASTER_SERVICE_NAME) {
        return ({ request }) => (0, reviewMasterFixture_1.runOfficialReviewMaster)({ request });
    }
    return null;
}
function mapRunnerResultToSessionResult(result) {
    if (result.state === 'completed') {
        return {
            state: 'completed',
            responseText: normalizeText(result.responseText) || result.summary,
            metadata: result.metadata ?? null,
        };
    }
    if (result.state === 'need_more_context') {
        return {
            state: 'needs_clarification',
            question: result.followUpQuestion,
            metadata: result.metadata ?? null,
        };
    }
    if (result.state === 'declined') {
        return {
            state: 'failed',
            code: 'master_declined',
            message: result.reason,
            metadata: result.metadata ?? null,
        };
    }
    return {
        state: 'failed',
        code: normalizeText(result.code) || 'master_runner_failed',
        message: normalizeText(result.message) || 'Master runner failed.',
        metadata: result.metadata ?? null,
    };
}
function mapRunnerResultToResponseStatus(result) {
    if (result.state === 'completed')
        return 'completed';
    if (result.state === 'need_more_context')
        return 'need_more_context';
    if (result.state === 'declined')
        return 'declined';
    return 'failed';
}
function buildStructuredData(result) {
    if (result.state === 'completed') {
        return {
            findings: [...result.findings],
            recommendations: [...result.recommendations],
            risks: [...result.risks],
            confidence: result.confidence,
        };
    }
    if (result.state === 'need_more_context') {
        return {
            missing: [...result.missing],
            risks: [...(result.risks ?? [])],
        };
    }
    if (result.state === 'declined') {
        return {
            risks: [...(result.risks ?? [])],
        };
    }
    return {};
}
function buildResponsePayload(input) {
    const runnerResult = input.runnerResult;
    const responseJson = (0, masterMessageSchema_1.buildMasterResponseJson)({
        type: 'master_response',
        version: '1.0.0',
        requestId: input.request.requestId,
        traceId: input.request.traceId,
        responder: {
            providerGlobalMetaId: input.request.target.providerGlobalMetaId,
            masterServicePinId: input.publishedMaster.currentPinId,
            masterKind: input.publishedMaster.masterKind,
        },
        status: mapRunnerResultToResponseStatus(runnerResult),
        summary: runnerResult.state === 'declined'
            ? normalizeText(runnerResult.reason)
            : runnerResult.state === 'failed'
                ? normalizeText(runnerResult.message)
                : normalizeText(runnerResult.summary),
        responseText: runnerResult.state === 'completed'
            ? normalizeText(runnerResult.responseText) || null
            : null,
        structuredData: buildStructuredData(runnerResult),
        followUpQuestion: runnerResult.state === 'completed'
            ? normalizeText(runnerResult.followUpQuestion) || null
            : runnerResult.state === 'need_more_context'
                ? normalizeText(runnerResult.followUpQuestion)
                : runnerResult.state === 'declined'
                    ? normalizeText(runnerResult.followUpQuestion) || null
                    : null,
        errorCode: runnerResult.state === 'failed'
            ? normalizeText(runnerResult.code) || 'master_runner_failed'
            : runnerResult.state === 'declined'
                ? 'master_declined'
                : null,
        extensions: runnerResult.metadata ?? null,
    });
    const parsed = (0, masterMessageSchema_1.parseMasterResponse)(responseJson);
    if (!parsed.ok) {
        throw new Error(parsed.message);
    }
    return parsed.value;
}
async function handleMasterProviderRequest(input) {
    const parsedRequest = (0, masterMessageSchema_1.parseMasterRequest)(input.rawRequest);
    if (!parsedRequest.ok) {
        return {
            ok: false,
            code: parsedRequest.code,
            message: parsedRequest.message,
        };
    }
    const providerGlobalMetaId = normalizeText(input.providerIdentity.globalMetaId);
    if (!providerGlobalMetaId) {
        return {
            ok: false,
            code: 'provider_identity_missing',
            message: 'Local provider identity is required.',
        };
    }
    if (normalizeText(parsedRequest.value.target.providerGlobalMetaId) !== providerGlobalMetaId) {
        return {
            ok: false,
            code: 'provider_identity_mismatch',
            message: 'master_request.target.providerGlobalMetaId does not match the local provider identity.',
        };
    }
    const publishedMaster = resolvePublishedMaster(input.publishedMasters, parsedRequest.value);
    if (!publishedMaster) {
        return {
            ok: false,
            code: 'master_service_not_found',
            message: `Published master-service was not found: ${parsedRequest.value.target.masterServicePinId}`,
        };
    }
    const sessionEngine = input.sessionEngine ?? (0, sessionEngine_1.createA2ASessionEngine)();
    const received = sessionEngine.receiveProviderTask({
        traceId: parsedRequest.value.traceId,
        servicePinId: publishedMaster.currentPinId,
        callerGlobalMetaId: parsedRequest.value.caller.globalMetaId,
        providerGlobalMetaId: providerGlobalMetaId,
        userTask: parsedRequest.value.task.userTask,
        taskContext: buildTaskContext(parsedRequest.value),
    });
    const runnerInput = {
        request: parsedRequest.value,
        publishedMaster,
        providerIdentity: input.providerIdentity,
    };
    const resolvedRunner = input.resolveRunner?.(runnerInput) ?? resolveDefaultRunner(runnerInput);
    let runnerResult;
    if (!resolvedRunner) {
        runnerResult = {
            state: 'failed',
            code: 'master_runner_not_found',
            message: `No master runner is configured for ${publishedMaster.currentPinId}.`,
        };
    }
    else {
        try {
            runnerResult = normalizeRunnerResult(await resolvedRunner(runnerInput));
        }
        catch (error) {
            runnerResult = {
                state: 'failed',
                code: 'master_runner_exception',
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }
    const applied = sessionEngine.applyProviderRunnerResult({
        session: received.session,
        taskRun: received.taskRun,
        result: mapRunnerResultToSessionResult(runnerResult),
    });
    const response = buildResponsePayload({
        request: parsedRequest.value,
        publishedMaster,
        runnerResult,
    });
    return {
        ok: true,
        request: parsedRequest.value,
        publishedMaster,
        received,
        applied,
        runnerResult,
        response,
        responseJson: (0, masterMessageSchema_1.buildMasterResponseJson)(response),
        traceSummary: {
            flow: 'master',
            servicePinId: publishedMaster.currentPinId,
            masterKind: publishedMaster.masterKind,
            requestId: parsedRequest.value.requestId,
            requestStatus: response.status,
        },
    };
}
