"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOfficialDebugMaster = runOfficialDebugMaster;
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
function collectSignals(request) {
    const extensions = request.extensions ?? {};
    const parts = [
        request.task.userTask,
        request.task.question,
        request.context.workspaceSummary,
        normalizeText(extensions.goal),
        normalizeText(extensions.errorSummary),
        normalizeText(extensions.diffSummary),
        ...normalizeStringArray(extensions.constraints),
        ...request.context.relevantFiles,
        ...request.context.artifacts.flatMap((artifact) => [artifact.label, artifact.content]),
    ];
    return parts
        .map((entry) => normalizeText(entry).toLowerCase())
        .filter(Boolean)
        .join('\n');
}
function buildCompleted(input) {
    return {
        state: 'completed',
        summary: input.summary,
        findings: [...input.findings],
        recommendations: [...input.recommendations],
        risks: [...input.risks],
        confidence: input.confidence,
        followUpQuestion: input.followUpQuestion,
    };
}
function buildNeedMoreContext(input) {
    return {
        state: 'need_more_context',
        summary: input.summary,
        missing: [...input.missing],
        followUpQuestion: input.followUpQuestion,
        risks: [...input.risks],
    };
}
function looksTooVague(request) {
    const question = normalizeText(request.task.question).toLowerCase();
    const userTask = normalizeText(request.task.userTask).toLowerCase();
    const workspaceSummary = normalizeText(request.context.workspaceSummary);
    const extensions = request.extensions ?? {};
    const errorSummary = normalizeText(extensions.errorSummary);
    const hasArtifacts = request.context.artifacts.length > 0;
    if (workspaceSummary || errorSummary || hasArtifacts) {
        return false;
    }
    const genericQuestions = new Set([
        'what should i do?',
        'help',
        'help me',
        'how do i fix it?',
    ]);
    return genericQuestions.has(question)
        || genericQuestions.has(userTask)
        || (question.split(/\s+/).length <= 4 && userTask.split(/\s+/).length <= 4);
}
function isDiscoveryEmptyCase(signals) {
    return (((signals.includes('master list') || signals.includes('advisor list'))
        && (signals.includes('empty') || signals.includes('"masters":[]') || signals.includes('"advisors":[]')))
        || signals.includes('no advisors')
        || signals.includes('no masters'));
}
function isTimeoutCase(signals) {
    return signals.includes('timeout') || signals.includes('timed out');
}
function isNotFoundCase(signals) {
    return signals.includes('master not found')
        || signals.includes('service not found')
        || signals.includes('advisor_service_not_found');
}
function isSimplemsgCase(signals) {
    return signals.includes('simplemsg')
        || signals.includes('decrypt')
        || signals.includes('chat public key')
        || signals.includes('public key');
}
function isSchemaCase(signals) {
    return signals.includes('schema')
        || signals.includes('validation')
        || signals.includes('invalid json')
        || signals.includes('invalid_master');
}
function runOfficialDebugMaster(input) {
    const request = input.request;
    const signals = collectSignals(request);
    if (looksTooVague(request)) {
        return buildNeedMoreContext({
            summary: 'The current request is too vague to support a reliable debugging diagnosis.',
            missing: [
                'The concrete error output, failing behavior, or exact unexpected result.',
                'What the caller expected to happen instead.',
            ],
            followUpQuestion: 'Can you send the observed error output or the exact unexpected behavior?',
            risks: [
                'Without concrete failure details, any recommendation would be guesswork.',
            ],
        });
    }
    if (isDiscoveryEmptyCase(signals)) {
        return buildCompleted({
            summary: 'The empty master list most likely means the caller has no visible online master source, or the target master is filtered out for the current host.',
            findings: [
                'A successful empty list is usually a discovery/configuration state, not a runtime crash.',
                'The first checks should be network sources, provider online status, and host-mode visibility for the published master-service.',
                'If the target provider daemon URL is already known, direct Ask Master delivery can still work even before local discovery is populated.',
            ],
            recommendations: [
                'Run `metabot network sources list` on the caller side and confirm the expected provider base URL is present.',
                'If the provider source is missing, add it with `metabot network sources add --base-url <provider-url>` and re-run `metabot master list`.',
                'If the source exists but the list is still empty, verify the provider is online and the master-service includes the current host mode.',
            ],
            risks: [
                'This diagnosis is based only on the structured request and does not prove the current provider is online right now.',
                'Do not assume an empty list means the feature is broken before checking local source configuration.',
            ],
            confidence: 0.84,
            followUpQuestion: 'Can you share the current output of `metabot network sources list` from the caller side?',
        });
    }
    if (isTimeoutCase(signals)) {
        return buildCompleted({
            summary: 'A timeout usually means the caller stopped waiting before the provider result was observed, not that the provider definitely stopped running.',
            findings: [
                'Caller-side timeout semantics describe the local wait boundary first.',
                'The next step is to inspect trace state and any late-arriving provider result before changing runtime semantics.',
                'Treat timeout as an observability/debugging problem unless provider failure evidence is explicit.',
            ],
            recommendations: [
                'Check the trace state for the request and look for a later provider completion event.',
                'Verify whether the caller foreground wait ended while a background continuation was still allowed to watch for delivery.',
                'Only change timeout values after confirming the provider is actually slow rather than merely observed late.',
            ],
            risks: [
                'If you treat timeout as provider failure too early, you can misdiagnose a still-running request.',
                'This answer is based on the request text and not on a live trace inspection.',
            ],
            confidence: 0.79,
            followUpQuestion: 'Do you already have the traceId for the timed-out Ask Master request?',
        });
    }
    if (isNotFoundCase(signals)) {
        return buildCompleted({
            summary: 'The target master most likely could not be resolved from the caller-visible directory or direct target tuple.',
            findings: [
                'This usually points to a stale service pin, provider mismatch, or missing local source entry.',
                'A not-found result is more often a discovery/targeting problem than a transport failure.',
            ],
            recommendations: [
                'Verify the service pin, providerGlobalMetaId, and provider base URL as one matching tuple.',
                'Refresh local discovery and confirm the provider still publishes the expected master-service.',
            ],
            risks: [
                'Retrying the same request without re-validating the target tuple may repeat the same failure.',
            ],
            confidence: 0.75,
            followUpQuestion: 'Can you share the exact service pin and providerGlobalMetaId you targeted?',
        });
    }
    if (isSimplemsgCase(signals)) {
        return buildCompleted({
            summary: 'The failure pattern points first to the private simplemsg key-exchange or decrypt path.',
            findings: [
                'simplemsg delivery depends on the correct chat public key and matching local private key material.',
                'A decrypt failure can look like transport success followed by unusable payload content.',
            ],
            recommendations: [
                'Verify the target chat public key on chain and confirm the local identity has the matching private chat key.',
                'Reproduce with the smallest possible structured payload so you can isolate encryption from higher-level request issues.',
            ],
            risks: [
                'Do not assume the remote provider is at fault before verifying local key material.',
            ],
            confidence: 0.73,
            followUpQuestion: 'What exact decrypt or public-key error did the caller observe?',
        });
    }
    if (isSchemaCase(signals)) {
        return buildCompleted({
            summary: 'The request most likely failed schema validation before the provider could act on it.',
            findings: [
                'Structured Ask Master payloads are strict about required envelope fields and response shape.',
                'A validation error should be debugged from the concrete field-level message first.',
            ],
            recommendations: [
                'Validate the request or response JSON against the current master message schema and compare the exact failing field.',
                'Keep the payload minimal until the envelope parses cleanly, then add optional fields back one by one.',
            ],
            risks: [
                'Trying to debug transport before the schema is valid can waste time.',
            ],
            confidence: 0.77,
            followUpQuestion: 'Can you share the exact validation error message or the malformed JSON snippet?',
        });
    }
    return buildCompleted({
        summary: 'Start by tightening the repro and capturing the exact observed failure before changing implementation details.',
        findings: [
            'The current request is actionable, but it does not yet point strongly to one specific failure family.',
            'The best next step is to gather the smallest concrete signal that separates config, transport, and runtime causes.',
        ],
        recommendations: [
            'Capture the exact command, observed output, and expected result for the failing step.',
            'Reduce the repro to one request/response path and preserve the resulting traceId.',
            'Once the minimal repro is stable, inspect whether the failure is discovery, transport, validation, or provider execution.',
        ],
        risks: [
            'Changing multiple layers at once will make the root cause harder to isolate.',
        ],
        confidence: 0.61,
        followUpQuestion: 'What is the smallest exact repro step that currently fails?',
    });
}
