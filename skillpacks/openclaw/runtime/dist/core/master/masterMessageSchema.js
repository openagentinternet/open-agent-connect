"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MASTER_RESPONSE_TYPE = exports.MASTER_REQUEST_TYPE = exports.MASTER_MESSAGE_VERSION = void 0;
exports.parseMasterRequest = parseMasterRequest;
exports.parseMasterResponse = parseMasterResponse;
exports.buildMasterRequestJson = buildMasterRequestJson;
exports.buildMasterResponseJson = buildMasterResponseJson;
exports.MASTER_MESSAGE_VERSION = '1.0.0';
exports.MASTER_REQUEST_TYPE = 'master_request';
exports.MASTER_RESPONSE_TYPE = 'master_response';
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function parseJsonEnvelope(value) {
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (!normalized) {
            return {
                ok: false,
                code: 'invalid_master_message_json',
                message: 'Master message JSON must not be empty.',
            };
        }
        try {
            const parsed = JSON.parse(normalized);
            const objectValue = readObject(parsed);
            if (!objectValue) {
                return {
                    ok: false,
                    code: 'invalid_master_message_json',
                    message: 'Master message JSON must decode to an object.',
                };
            }
            return {
                ok: true,
                value: objectValue,
            };
        }
        catch (error) {
            return {
                ok: false,
                code: 'invalid_master_message_json',
                message: `Malformed master message JSON: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
    const objectValue = readObject(value);
    if (!objectValue) {
        return {
            ok: false,
            code: 'invalid_master_message_json',
            message: 'Master message must be a JSON object.',
        };
    }
    return {
        ok: true,
        value: objectValue,
    };
}
function parseStringArray(value) {
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
function parseArtifacts(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const artifacts = [];
    for (const entry of value) {
        const item = readObject(entry);
        if (!item) {
            continue;
        }
        const kind = normalizeText(item.kind);
        const label = normalizeText(item.label);
        const content = normalizeText(item.content);
        if (!kind || !label || !content) {
            continue;
        }
        artifacts.push({
            kind,
            label,
            content,
            mimeType: normalizeText(item.mimeType) || null,
        });
    }
    return artifacts;
}
function parseOptionalNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function parseTriggerMode(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'manual' || normalized === 'suggest' || normalized === 'auto') {
        return normalized;
    }
    return null;
}
function parseResponseStatus(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'completed'
        || normalized === 'failed'
        || normalized === 'declined'
        || normalized === 'unavailable') {
        return normalized;
    }
    if (normalized === 'need_more_context' || normalized === 'needs_clarification') {
        return 'need_more_context';
    }
    return null;
}
function parseDesiredOutputMode(value) {
    const direct = normalizeText(value);
    if (direct) {
        return direct;
    }
    return normalizeText(readObject(value)?.mode) || null;
}
function mergeRequestExtensions(input) {
    const merged = {
        ...(input.original ?? {}),
    };
    if (normalizeText(input.goal))
        merged.goal = normalizeText(input.goal);
    if (normalizeText(input.errorSummary))
        merged.errorSummary = normalizeText(input.errorSummary);
    if (normalizeText(input.diffSummary))
        merged.diffSummary = normalizeText(input.diffSummary);
    const constraints = Array.isArray(input.constraints) ? input.constraints.filter(Boolean) : [];
    if (constraints.length)
        merged.constraints = constraints;
    if (normalizeText(input.hostClient))
        merged.hostClient = normalizeText(input.hostClient);
    if (normalizeText(input.hostClientVersion))
        merged.hostClientVersion = normalizeText(input.hostClientVersion);
    if (Number.isFinite(input.sentAt))
        merged.sentAt = Number(input.sentAt);
    return Object.keys(merged).length > 0 ? merged : null;
}
function mergeResponseExtensions(input) {
    const merged = {
        ...(input.original ?? {}),
    };
    if (Number.isFinite(input.respondedAt)) {
        merged.respondedAt = Number(input.respondedAt);
    }
    return Object.keys(merged).length > 0 ? merged : null;
}
function buildCanonicalRequestEnvelope(value) {
    const extensions = readObject(value.extensions) ?? {};
    return {
        type: exports.MASTER_REQUEST_TYPE,
        version: exports.MASTER_MESSAGE_VERSION,
        requestId: value.requestId,
        traceId: value.traceId,
        callerGlobalMetaId: value.caller.globalMetaId,
        target: {
            providerGlobalMetaId: value.target.providerGlobalMetaId,
            servicePinId: value.target.masterServicePinId,
            masterKind: value.target.masterKind,
        },
        host: {
            mode: value.caller.host,
            client: normalizeText(extensions.hostClient) || 'metabot',
            clientVersion: normalizeText(extensions.hostClientVersion) || null,
        },
        trigger: {
            mode: value.trigger.mode,
            reason: value.trigger.reason,
        },
        task: {
            userTask: value.task.userTask,
            question: value.task.question,
            goal: normalizeText(extensions.goal) || null,
        },
        context: {
            workspaceSummary: value.context.workspaceSummary,
            errorSummary: normalizeText(extensions.errorSummary) || null,
            diffSummary: normalizeText(extensions.diffSummary) || null,
            relevantFiles: [...value.context.relevantFiles],
            artifacts: [...value.context.artifacts],
        },
        constraints: parseStringArray(extensions.constraints),
        desiredOutput: value.desiredOutput ? { mode: value.desiredOutput } : null,
        sentAt: parseOptionalNumber(extensions.sentAt),
    };
}
function buildCanonicalResponseEnvelope(value) {
    const structuredData = readObject(value.structuredData) ?? {};
    const extensions = readObject(value.extensions);
    const findings = parseStringArray(structuredData.findings
        ?? structuredData.reviewFindings
        ?? structuredData.diagnosis);
    const recommendations = parseStringArray(structuredData.recommendations
        ?? structuredData.reviewRecommendations
        ?? structuredData.actionItems
        ?? structuredData.nextSteps);
    return {
        type: exports.MASTER_RESPONSE_TYPE,
        version: exports.MASTER_MESSAGE_VERSION,
        requestId: value.requestId,
        traceId: value.traceId,
        providerGlobalMetaId: value.responder.providerGlobalMetaId,
        servicePinId: value.responder.masterServicePinId,
        masterKind: value.responder.masterKind,
        status: value.status,
        summary: value.summary,
        findings,
        recommendations,
        missing: parseStringArray(structuredData.missing),
        risks: parseStringArray(structuredData.risks),
        confidence: parseOptionalNumber(structuredData.confidence ?? extensions?.confidence),
        followUpQuestion: value.followUpQuestion,
        respondedAt: parseOptionalNumber(extensions?.respondedAt),
        responseText: value.responseText,
        errorCode: value.errorCode,
    };
}
function validateTypeAndVersion(envelope, expectedType) {
    const type = normalizeText(envelope.type);
    if (type !== expectedType) {
        return {
            ok: false,
            code: 'invalid_master_message_type',
            message: `Expected ${expectedType} but received ${type || 'empty type'}.`,
        };
    }
    const version = normalizeText(envelope.version);
    if (version !== exports.MASTER_MESSAGE_VERSION) {
        return {
            ok: false,
            code: 'invalid_master_message_version',
            message: `Unsupported master message version: ${version || 'empty version'}.`,
        };
    }
    return null;
}
function failRequest(message) {
    return {
        ok: false,
        code: 'invalid_master_request',
        message,
    };
}
function failResponse(message) {
    return {
        ok: false,
        code: 'invalid_master_response',
        message,
    };
}
function parseMasterRequest(value) {
    const envelope = parseJsonEnvelope(value);
    if (!envelope.ok) {
        return envelope;
    }
    const typeFailure = validateTypeAndVersion(envelope.value, exports.MASTER_REQUEST_TYPE);
    if (typeFailure) {
        return typeFailure;
    }
    const caller = readObject(envelope.value.caller);
    const host = readObject(envelope.value.host);
    const target = readObject(envelope.value.target);
    const task = readObject(envelope.value.task);
    const context = readObject(envelope.value.context) ?? {};
    const trigger = readObject(envelope.value.trigger);
    const extensions = readObject(envelope.value.extensions);
    const requestId = normalizeText(envelope.value.requestId);
    if (!requestId) {
        return failRequest('master_request.requestId is required.');
    }
    const traceId = normalizeText(envelope.value.traceId);
    if (!traceId) {
        return failRequest('master_request.traceId is required.');
    }
    const callerGlobalMetaId = normalizeText(caller?.globalMetaId || envelope.value.callerGlobalMetaId);
    const callerHost = normalizeText(caller?.host || host?.mode || envelope.value.host);
    if (!callerGlobalMetaId || !callerHost) {
        return failRequest('master_request.caller.globalMetaId and master_request.caller.host are required.');
    }
    const masterServicePinId = normalizeText(target?.masterServicePinId || target?.servicePinId);
    const providerGlobalMetaId = normalizeText(target?.providerGlobalMetaId);
    const masterKind = normalizeText(target?.masterKind);
    if (!masterServicePinId || !providerGlobalMetaId || !masterKind) {
        return failRequest('master_request.target.masterServicePinId, providerGlobalMetaId, and masterKind are required.');
    }
    const userTask = normalizeText(task?.userTask);
    const question = normalizeText(task?.question);
    if (!userTask || !question) {
        return failRequest('master_request.task.userTask and master_request.task.question are required.');
    }
    const triggerMode = parseTriggerMode(trigger?.mode);
    if (!triggerMode) {
        return failRequest('master_request.trigger.mode must be one of manual, suggest, auto.');
    }
    return {
        ok: true,
        value: {
            type: exports.MASTER_REQUEST_TYPE,
            version: exports.MASTER_MESSAGE_VERSION,
            requestId,
            traceId,
            caller: {
                globalMetaId: callerGlobalMetaId,
                name: normalizeText(caller?.name) || null,
                host: callerHost,
            },
            target: {
                masterServicePinId,
                providerGlobalMetaId,
                masterKind,
            },
            task: {
                userTask,
                question,
            },
            context: {
                workspaceSummary: normalizeText(context.workspaceSummary) || null,
                relevantFiles: parseStringArray(context.relevantFiles),
                artifacts: parseArtifacts(context.artifacts),
            },
            trigger: {
                mode: triggerMode,
                reason: normalizeText(trigger?.reason) || null,
            },
            desiredOutput: parseDesiredOutputMode(envelope.value.desiredOutput),
            extensions: mergeRequestExtensions({
                original: extensions,
                goal: normalizeText(task?.goal) || null,
                errorSummary: normalizeText(context.errorSummary) || null,
                diffSummary: normalizeText(context.diffSummary) || null,
                constraints: parseStringArray(envelope.value.constraints),
                hostClient: normalizeText(host?.client) || null,
                hostClientVersion: normalizeText(host?.clientVersion) || null,
                sentAt: parseOptionalNumber(envelope.value.sentAt),
            }),
        },
    };
}
function parseMasterResponse(value) {
    const envelope = parseJsonEnvelope(value);
    if (!envelope.ok) {
        return envelope;
    }
    const typeFailure = validateTypeAndVersion(envelope.value, exports.MASTER_RESPONSE_TYPE);
    if (typeFailure) {
        return typeFailure;
    }
    const responder = readObject(envelope.value.responder);
    const structuredData = readObject(envelope.value.structuredData) ?? {};
    const extensions = readObject(envelope.value.extensions);
    const requestId = normalizeText(envelope.value.requestId);
    if (!requestId) {
        return failResponse('master_response.requestId is required.');
    }
    const traceId = normalizeText(envelope.value.traceId);
    if (!traceId) {
        return failResponse('master_response.traceId is required.');
    }
    const providerGlobalMetaId = normalizeText(responder?.providerGlobalMetaId || envelope.value.providerGlobalMetaId);
    const masterServicePinId = normalizeText(responder?.masterServicePinId
        || envelope.value.servicePinId
        || envelope.value.masterServicePinId);
    const masterKind = normalizeText(responder?.masterKind || envelope.value.masterKind);
    if (!providerGlobalMetaId || !masterServicePinId || !masterKind) {
        return failResponse('master_response.responder.providerGlobalMetaId, masterServicePinId, and masterKind are required.');
    }
    const status = parseResponseStatus(envelope.value.status);
    if (!status) {
        return failResponse('master_response.status must be one of completed, need_more_context, declined, unavailable, failed.');
    }
    const summary = normalizeText(envelope.value.summary);
    if (!summary) {
        return failResponse('master_response.summary is required.');
    }
    const mergedStructuredData = {
        ...structuredData,
    };
    const findings = parseStringArray(envelope.value.findings
        ?? envelope.value.reviewFindings
        ?? mergedStructuredData.findings
        ?? mergedStructuredData.reviewFindings
        ?? mergedStructuredData.diagnosis);
    const recommendations = parseStringArray(envelope.value.recommendations
        ?? envelope.value.reviewRecommendations
        ?? envelope.value.actionItems
        ?? mergedStructuredData.recommendations
        ?? mergedStructuredData.reviewRecommendations
        ?? mergedStructuredData.actionItems
        ?? mergedStructuredData.nextSteps);
    const missing = parseStringArray(envelope.value.missing);
    const risks = parseStringArray(envelope.value.risks);
    const confidence = parseOptionalNumber(envelope.value.confidence);
    if (findings.length)
        mergedStructuredData.findings = findings;
    if (recommendations.length)
        mergedStructuredData.recommendations = recommendations;
    if (missing.length)
        mergedStructuredData.missing = missing;
    if (risks.length)
        mergedStructuredData.risks = risks;
    if (confidence !== null)
        mergedStructuredData.confidence = confidence;
    return {
        ok: true,
        value: {
            type: exports.MASTER_RESPONSE_TYPE,
            version: exports.MASTER_MESSAGE_VERSION,
            requestId,
            traceId,
            responder: {
                providerGlobalMetaId,
                masterServicePinId,
                masterKind,
            },
            status,
            summary,
            responseText: normalizeText(envelope.value.responseText) || null,
            structuredData: mergedStructuredData,
            followUpQuestion: normalizeText(envelope.value.followUpQuestion) || null,
            errorCode: normalizeText(envelope.value.errorCode) || null,
            extensions: mergeResponseExtensions({
                original: extensions,
                respondedAt: parseOptionalNumber(envelope.value.respondedAt),
            }),
        },
    };
}
function buildMasterRequestJson(value) {
    const parsed = parseMasterRequest(value);
    if (!parsed.ok) {
        throw new Error(parsed.message);
    }
    return JSON.stringify(buildCanonicalRequestEnvelope(parsed.value));
}
function buildMasterResponseJson(value) {
    const parsed = parseMasterResponse(value);
    if (!parsed.ok) {
        throw new Error(parsed.message);
    }
    return JSON.stringify(buildCanonicalResponseEnvelope(parsed.value));
}
