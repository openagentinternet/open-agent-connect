"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createA2ASessionEngine = createA2ASessionEngine;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function truncateTraceSegment(value) {
    return value.replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').slice(0, 16) || 'trace';
}
function buildMutation(session, taskRun, event, runnerResult = null) {
    return {
        session,
        taskRun,
        event,
        runnerResult,
    };
}
function createA2ASessionEngine(options = {}) {
    let fallbackIdSequence = 0;
    const now = options.now ?? (() => Date.now());
    const createSessionId = options.createSessionId
        ?? (() => `session-${now().toString(36)}-${(++fallbackIdSequence).toString(36)}`);
    const createTaskRunId = options.createTaskRunId
        ?? (() => `run-${now().toString(36)}-${(++fallbackIdSequence).toString(36)}`);
    const buildSessionLinkage = (input) => ({
        coworkSessionId: normalizeText(input.sessionId) || null,
        externalConversationId: `a2a-session:${normalizeText(input.providerGlobalMetaId)}:${truncateTraceSegment(normalizeText(input.traceId))}`,
    });
    const startCallerSession = (input) => {
        const timestamp = now();
        const sessionId = createSessionId();
        const taskRunId = createTaskRunId();
        const session = {
            sessionId,
            traceId: normalizeText(input.traceId),
            role: 'caller',
            state: 'requesting_remote',
            createdAt: timestamp,
            updatedAt: timestamp,
            callerGlobalMetaId: normalizeText(input.callerGlobalMetaId),
            providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
            servicePinId: normalizeText(input.servicePinId),
            currentTaskRunId: taskRunId,
            latestTaskRunState: 'queued',
        };
        const taskRun = {
            runId: taskRunId,
            sessionId,
            state: 'queued',
            createdAt: timestamp,
            updatedAt: timestamp,
            startedAt: null,
            completedAt: null,
            failureCode: null,
            failureReason: null,
            clarificationRounds: [],
        };
        return {
            ...buildMutation(session, taskRun, 'request_sent'),
            linkage: buildSessionLinkage({
                providerGlobalMetaId: input.providerGlobalMetaId,
                traceId: input.traceId,
                sessionId,
            }),
        };
    };
    const markForegroundTimeout = (input) => {
        const timestamp = now();
        const session = {
            ...input.session,
            state: 'timeout',
            updatedAt: timestamp,
            latestTaskRunState: 'timeout',
        };
        const taskRun = {
            ...input.taskRun,
            state: 'timeout',
            updatedAt: timestamp,
        };
        return buildMutation(session, taskRun, 'timeout');
    };
    const receiveProviderTask = (input) => {
        const timestamp = now();
        const sessionId = createSessionId();
        const taskRunId = createTaskRunId();
        const session = {
            sessionId,
            traceId: normalizeText(input.traceId),
            role: 'provider',
            state: 'remote_received',
            createdAt: timestamp,
            updatedAt: timestamp,
            callerGlobalMetaId: normalizeText(input.callerGlobalMetaId),
            providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
            servicePinId: normalizeText(input.servicePinId),
            currentTaskRunId: taskRunId,
            latestTaskRunState: 'running',
        };
        const taskRun = {
            runId: taskRunId,
            sessionId,
            state: 'running',
            createdAt: timestamp,
            updatedAt: timestamp,
            startedAt: timestamp,
            completedAt: null,
            failureCode: null,
            failureReason: null,
            clarificationRounds: [],
        };
        return buildMutation(session, taskRun, 'provider_received');
    };
    const applyProviderRunnerResult = (input) => {
        const timestamp = now();
        if (input.result.state === 'completed') {
            const session = {
                ...input.session,
                state: 'completed',
                updatedAt: timestamp,
                latestTaskRunState: 'completed',
            };
            const taskRun = {
                ...input.taskRun,
                state: 'completed',
                updatedAt: timestamp,
                completedAt: timestamp,
                failureCode: null,
                failureReason: null,
            };
            return buildMutation(session, taskRun, 'provider_completed', input.result);
        }
        if (input.result.state === 'failed') {
            const session = {
                ...input.session,
                state: 'remote_failed',
                updatedAt: timestamp,
                latestTaskRunState: 'failed',
            };
            const taskRun = {
                ...input.taskRun,
                state: 'failed',
                updatedAt: timestamp,
                completedAt: timestamp,
                failureCode: normalizeText(input.result.code) || 'provider_runner_failed',
                failureReason: normalizeText(input.result.message) || 'Provider runner failed.',
            };
            return buildMutation(session, taskRun, 'provider_failed', input.result);
        }
        // A needs_clarification outcome has no answer channel: finalize it as a
        // terminal failure instead of leaving the task run stuck.
        const session = {
            ...input.session,
            state: 'remote_failed',
            updatedAt: timestamp,
            latestTaskRunState: 'failed',
        };
        const taskRun = {
            ...input.taskRun,
            state: 'failed',
            updatedAt: timestamp,
            completedAt: timestamp,
            failureCode: 'clarification_not_supported',
            failureReason: normalizeText(input.result.question)
                || 'Provider runner requested clarification, which is not supported.',
        };
        return buildMutation(session, taskRun, 'provider_failed', input.result);
    };
    return {
        buildSessionLinkage,
        startCallerSession,
        markForegroundTimeout,
        receiveProviderTask,
        applyProviderRunnerResult,
    };
}
