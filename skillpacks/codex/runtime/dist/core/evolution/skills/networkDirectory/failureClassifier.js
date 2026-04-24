"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyNetworkDirectoryExecution = classifyNetworkDirectoryExecution;
const MACHINE_FIRST_COMMAND = 'metabot network services --online';
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function hasUsableMachineFirstCommand(commandTemplate) {
    return isNonEmptyString(commandTemplate)
        && commandTemplate.trim().startsWith(MACHINE_FIRST_COMMAND);
}
function getServices(envelope) {
    const data = envelope.data;
    if (!isRecord(data) || !Array.isArray(data.services)) {
        return null;
    }
    return data.services;
}
function isUsableServiceRow(row) {
    if (!isRecord(row)) {
        return false;
    }
    return isNonEmptyString(row.servicePinId) && isNonEmptyString(row.providerGlobalMetaId);
}
function classifyHardFailure(execution) {
    const envelope = execution.envelope;
    if (!hasUsableMachineFirstCommand(execution.commandTemplate)) {
        return 'Command template is not machine-first or unusable.';
    }
    if (!isRecord(envelope)) {
        return 'Execution envelope is invalid.';
    }
    if (envelope.state === 'failed') {
        return 'Envelope state is failed.';
    }
    const services = getServices(envelope);
    if (!services) {
        return 'Envelope data.services is missing or invalid.';
    }
    return null;
}
function classifySoftFailure(envelope) {
    const services = getServices(envelope);
    if (!services) {
        return null;
    }
    if (services.length === 0) {
        return 'Services list is empty and unusable for downstream automation.';
    }
    const usableRows = services.filter((row) => isUsableServiceRow(row));
    if (usableRows.length === 0) {
        return 'Services exist but are structurally unusable for downstream automation.';
    }
    return null;
}
function classifyManualRecovery(execution, repairAttemptCount) {
    if (execution.usedUiFallback) {
        return 'Execution used UI fallback.';
    }
    if (execution.manualRecovery) {
        return 'Execution required manual recovery.';
    }
    if (repairAttemptCount > 1) {
        return 'Execution required repeated command repair attempts.';
    }
    return null;
}
function classifyNetworkDirectoryExecution(input) {
    const repairAttemptCount = Math.max(0, input.repairAttemptCount ?? 0);
    const hardFailure = classifyHardFailure(input.execution);
    if (hardFailure) {
        return {
            completed: false,
            failureClass: 'hard_failure',
            isEvolutionCandidate: true,
            shouldGenerateCandidate: true,
            summary: hardFailure,
        };
    }
    const envelope = input.execution.envelope;
    if (isRecord(envelope)) {
        const softFailure = classifySoftFailure(envelope);
        if (softFailure) {
            return {
                completed: false,
                failureClass: 'soft_failure',
                isEvolutionCandidate: true,
                shouldGenerateCandidate: true,
                summary: softFailure,
            };
        }
    }
    const manualRecovery = classifyManualRecovery(input.execution, repairAttemptCount);
    if (manualRecovery) {
        return {
            completed: true,
            failureClass: 'manual_recovery',
            isEvolutionCandidate: true,
            shouldGenerateCandidate: true,
            summary: manualRecovery,
        };
    }
    return {
        completed: true,
        failureClass: null,
        isEvolutionCandidate: false,
        shouldGenerateCandidate: false,
        summary: 'Execution succeeded with machine-usable service rows.',
    };
}
