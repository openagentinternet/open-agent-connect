"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMasterTraceMetadata = buildMasterTraceMetadata;
exports.isAskMasterTrace = isAskMasterTrace;
exports.buildMasterTraceView = buildMasterTraceView;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeNullableText(value) {
    const normalized = normalizeText(value);
    return normalized || null;
}
function normalizePreview(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const preview = {
        userTask: normalizeNullableText(value.userTask),
        question: normalizeNullableText(value.question),
    };
    return preview.userTask || preview.question ? preview : null;
}
function normalizeResponse(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const response = {
        status: normalizeNullableText(value.status),
        summary: normalizeNullableText(value.summary),
        followUpQuestion: normalizeNullableText(value.followUpQuestion),
        errorCode: normalizeNullableText(value.errorCode),
    };
    return response.status || response.summary || response.followUpQuestion || response.errorCode ? response : null;
}
function normalizeFailure(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const failure = {
        code: normalizeNullableText(value.code),
        message: normalizeNullableText(value.message),
    };
    return failure.code || failure.message ? failure : null;
}
function normalizeAutoMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const frictionMode = normalizeText(value.frictionMode);
    const normalizedFrictionMode = frictionMode === 'preview_confirm' || frictionMode === 'direct_send'
        ? frictionMode
        : null;
    const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
        ? value.confidence
        : Number.isFinite(Number(value.confidence))
            ? Number(value.confidence)
            : null;
    const sensitivityValue = value.sensitivity && typeof value.sensitivity === 'object' && !Array.isArray(value.sensitivity)
        ? value.sensitivity
        : null;
    const reasons = Array.isArray(sensitivityValue?.reasons)
        ? sensitivityValue.reasons
            .map((entry) => normalizeText(entry))
            .filter(Boolean)
        : [];
    const auto = {
        reason: normalizeNullableText(value.reason),
        confidence,
        frictionMode: normalizedFrictionMode,
        detectorVersion: normalizeNullableText(value.detectorVersion),
        selectedMasterTrusted: typeof value.selectedMasterTrusted === 'boolean'
            ? value.selectedMasterTrusted
            : null,
        sensitivity: sensitivityValue
            ? {
                isSensitive: sensitivityValue.isSensitive === true,
                reasons,
            }
            : null,
    };
    return auto.reason
        || auto.confidence !== null
        || auto.frictionMode
        || auto.detectorVersion
        || auto.selectedMasterTrusted !== null
        || auto.sensitivity
        ? auto
        : null;
}
function isCanonicalStatus(value) {
    return value === 'discovered'
        || value === 'suggested'
        || value === 'awaiting_confirmation'
        || value === 'requesting_remote'
        || value === 'remote_received'
        || value === 'master_responded'
        || value === 'completed'
        || value === 'timed_out'
        || value === 'failed'
        || value === 'need_more_context';
}
function mapLatestEventToCanonicalStatus(event) {
    if (event === 'auto_preview_prepared')
        return 'awaiting_confirmation';
    if (event === 'auto_sent_without_confirmation')
        return 'requesting_remote';
    if (event === 'auto_preview_rejected')
        return 'failed';
    if (event === 'master_preview_ready')
        return 'awaiting_confirmation';
    if (event === 'request_sent')
        return 'requesting_remote';
    if (event === 'provider_received')
        return 'remote_received';
    if (event === 'provider_completed')
        return 'completed';
    if (event === 'timeout')
        return 'timed_out';
    if (event === 'provider_failed' || event === 'provider_delivery_failed')
        return 'failed';
    if (event === 'clarification_needed')
        return 'need_more_context';
    return null;
}
function mapPublicStatusToCanonicalStatus(status) {
    if (status === 'discovered')
        return 'discovered';
    if (status === 'awaiting_confirmation')
        return 'awaiting_confirmation';
    if (status === 'requesting_remote' || status === 'remote_executing')
        return 'requesting_remote';
    if (status === 'remote_received')
        return 'remote_received';
    if (status === 'completed')
        return 'completed';
    if (status === 'timeout')
        return 'timed_out';
    if (status === 'remote_failed' || status === 'local_runtime_error' || status === 'network_unavailable') {
        return 'failed';
    }
    if (status === 'manual_action_required')
        return 'need_more_context';
    return null;
}
function resolveCanonicalStatus(input) {
    const explicit = normalizeText(input.canonicalStatus);
    if (explicit && isCanonicalStatus(explicit)) {
        return explicit;
    }
    const latestEvent = normalizeText(input.latestEvent);
    const eventStatus = latestEvent ? mapLatestEventToCanonicalStatus(latestEvent) : null;
    if (eventStatus) {
        return eventStatus;
    }
    const publicStatus = normalizeText(input.publicStatus);
    return publicStatus ? mapPublicStatusToCanonicalStatus(publicStatus) : null;
}
function inferMasterDisplayName(trace) {
    const sessionTitle = normalizeText(trace.session.title);
    if (sessionTitle.endsWith(' Ask')) {
        return sessionTitle.slice(0, -' Ask'.length).trim() || null;
    }
    return normalizeNullableText(trace.askMaster?.displayName)
        || normalizeNullableText(trace.a2a?.providerName)
        || normalizeNullableText(trace.session.peerName);
}
function inferMasterTraceMetadata(trace) {
    const externalConversationId = normalizeText(trace.session.externalConversationId);
    if (normalizeText(trace.askMaster?.flow) === 'master') {
        return buildMasterTraceMetadata({
            role: trace.a2a?.role,
            canonicalStatus: trace.askMaster?.canonicalStatus,
            latestEvent: trace.a2a?.latestEvent,
            publicStatus: trace.a2a?.publicStatus,
            transport: trace.askMaster?.transport,
            triggerMode: trace.askMaster?.triggerMode,
            contextMode: trace.askMaster?.contextMode,
            confirmationMode: trace.askMaster?.confirmationMode,
            requestId: trace.askMaster?.requestId,
            masterKind: trace.askMaster?.masterKind,
            servicePinId: trace.askMaster?.servicePinId ?? trace.a2a?.servicePinId,
            providerGlobalMetaId: trace.askMaster?.providerGlobalMetaId ?? trace.a2a?.providerGlobalMetaId,
            displayName: trace.askMaster?.displayName ?? inferMasterDisplayName(trace),
            preview: trace.askMaster?.preview,
            response: trace.askMaster?.response,
            failure: trace.askMaster?.failure,
            auto: trace.askMaster?.auto,
        });
    }
    if (!externalConversationId.startsWith('master:')) {
        return null;
    }
    return buildMasterTraceMetadata({
        role: trace.a2a?.role,
        latestEvent: trace.a2a?.latestEvent,
        publicStatus: trace.a2a?.publicStatus,
        servicePinId: trace.a2a?.servicePinId,
        providerGlobalMetaId: trace.a2a?.providerGlobalMetaId ?? trace.session.peerGlobalMetaId,
        displayName: inferMasterDisplayName(trace),
    });
}
function buildMasterTraceMetadata(input) {
    return {
        flow: 'master',
        transport: 'simplemsg',
        canonicalStatus: resolveCanonicalStatus(input),
        triggerMode: normalizeNullableText(input.triggerMode),
        contextMode: normalizeNullableText(input.contextMode),
        confirmationMode: normalizeNullableText(input.confirmationMode),
        requestId: normalizeNullableText(input.requestId),
        masterKind: normalizeNullableText(input.masterKind),
        servicePinId: normalizeNullableText(input.servicePinId),
        providerGlobalMetaId: normalizeNullableText(input.providerGlobalMetaId),
        displayName: normalizeNullableText(input.displayName),
        preview: normalizePreview(input.preview),
        response: normalizeResponse(input.response),
        failure: normalizeFailure(input.failure),
        auto: normalizeAutoMetadata(input.auto),
    };
}
function isAskMasterTrace(trace) {
    return Boolean(trace && inferMasterTraceMetadata(trace));
}
function renderStatusText(input) {
    if (input.latestEvent === 'auto_preview_rejected'
        || normalizeNullableText(input.failure?.code) === 'auto_rejected_by_user') {
        return 'Declined';
    }
    const status = input.status;
    if (status === 'awaiting_confirmation')
        return 'Waiting for your confirmation';
    if (status === 'requesting_remote')
        return 'Request sent to Master';
    if (status === 'remote_received')
        return 'Master received the request';
    if (status === 'master_responded')
        return 'Master has responded';
    if (status === 'completed')
        return 'Completed';
    if (status === 'timed_out')
        return 'Stopped waiting locally';
    if (status === 'failed')
        return 'Failed';
    if (status === 'need_more_context')
        return 'Need more context';
    if (status === 'suggested')
        return 'Suggested';
    if (status === 'discovered')
        return 'Discovered';
    return 'Unknown status';
}
function buildMasterTraceView(trace) {
    const askMaster = inferMasterTraceMetadata(trace);
    if (!askMaster) {
        return null;
    }
    const displayName = askMaster.displayName || inferMasterDisplayName(trace);
    const title = normalizeNullableText(trace.session.title)
        || (displayName ? `${displayName} Ask` : `Ask Master ${trace.traceId}`);
    return {
        traceId: trace.traceId,
        flow: 'master',
        transport: 'simplemsg',
        role: normalizeNullableText(trace.a2a?.role),
        displayName,
        masterKind: askMaster.masterKind,
        providerGlobalMetaId: askMaster.providerGlobalMetaId,
        servicePinId: askMaster.servicePinId,
        requestId: askMaster.requestId,
        canonicalStatus: askMaster.canonicalStatus,
        latestEvent: normalizeNullableText(trace.a2a?.latestEvent),
        triggerMode: askMaster.triggerMode,
        contextMode: askMaster.contextMode,
        confirmationMode: askMaster.confirmationMode,
        preview: askMaster.preview,
        response: askMaster.response,
        failure: askMaster.failure,
        auto: askMaster.auto,
        display: {
            title,
            statusText: renderStatusText({
                status: askMaster.canonicalStatus,
                latestEvent: normalizeNullableText(trace.a2a?.latestEvent),
                failure: askMaster.failure,
            }),
        },
        artifacts: trace.artifacts,
        trace: {
            ...trace,
            askMaster,
        },
    };
}
