"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTriggerObservationFromHostObservationFrame = buildTriggerObservationFromHostObservationFrame;
exports.buildTriggerObservationFromHostContext = buildTriggerObservationFromHostContext;
const masterHostObservation_1 = require("./masterHostObservation");
const masterStuckDetector_1 = require("./masterStuckDetector");
function uniqueStrings(values) {
    const seen = new Set();
    const unique = [];
    for (const value of values) {
        if (!value || seen.has(value)) {
            continue;
        }
        seen.add(value);
        unique.push(value);
    }
    return unique;
}
function buildTriggerObservationFromHostObservationFrame(observation) {
    const assessment = (0, masterStuckDetector_1.assessMasterAskWorthiness)(observation);
    const uncertaintySignals = uniqueStrings([
        ...observation.diagnostics.uncertaintySignals,
        ...(observation.hints.reviewCheckpointRisk || assessment.opportunityType === 'review_checkpoint'
            ? ['review_checkpoint_risk']
            : []),
    ]);
    return {
        now: observation.now,
        traceId: observation.traceId,
        hostMode: observation.hostMode,
        workspaceId: observation.workspaceId,
        userIntent: {
            explicitlyAskedForMaster: observation.userIntent.explicitlyAskedForMaster,
            explicitlyRejectedSuggestion: observation.userIntent.explicitlyRejectedSuggestion,
            explicitlyRejectedAutoAsk: observation.userIntent.explicitlyRejectedAutoAsk,
        },
        activity: {
            recentUserMessages: observation.activity.recentUserMessages,
            recentAssistantMessages: observation.activity.recentAssistantMessages,
            recentToolCalls: observation.activity.recentToolCalls,
            recentFailures: observation.activity.recentFailures,
            repeatedFailureCount: observation.activity.repeatedFailureCount,
            noProgressWindowMs: observation.activity.noProgressWindowMs,
        },
        diagnostics: {
            failingTests: observation.diagnostics.failingTests,
            failingCommands: observation.diagnostics.failingCommands,
            repeatedErrorSignatures: observation.diagnostics.repeatedErrorSignatures,
            uncertaintySignals,
        },
        workState: {
            hasPlan: observation.workState.hasPlan,
            todoBlocked: observation.workState.todoBlocked,
            diffChangedRecently: observation.workState.diffChangedRecently,
            onlyReadingWithoutConverging: observation.workState.onlyReadingWithoutConverging,
        },
        directory: {
            availableMasters: observation.directory.availableMasters,
            trustedMasters: observation.directory.trustedMasters,
            onlineMasters: observation.directory.onlineMasters,
        },
        candidateMasterKindHint: assessment.candidateMasterKind ?? observation.hints.candidateMasterKindHint,
    };
}
function buildTriggerObservationFromHostContext(input) {
    return buildTriggerObservationFromHostObservationFrame((0, masterHostObservation_1.buildMasterHostObservation)(input));
}
