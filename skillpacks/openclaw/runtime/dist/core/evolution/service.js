"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNetworkDirectoryEvolutionService = createNetworkDirectoryEvolutionService;
const node_crypto_1 = require("node:crypto");
const configStore_1 = require("../config/configStore");
const localEvolutionStore_1 = require("./localEvolutionStore");
const adoptionPolicy_1 = require("./adoptionPolicy");
const failureClassifier_1 = require("./skills/networkDirectory/failureClassifier");
const fixGenerator_1 = require("./skills/networkDirectory/fixGenerator");
const validator_1 = require("./skills/networkDirectory/validator");
const baseSkillRegistry_1 = require("../skills/baseSkillRegistry");
const DEFAULT_SKILL_NAME = 'metabot-network-directory';
const SAFE_ID_PREFIX = 'network-directory';
let globalIdSequence = 0;
function toSafeIdSegment(input) {
    return input.replace(/[^A-Za-z0-9._-]/g, '-');
}
function normalizeObservation(observation, executionId) {
    return {
        executionId,
        skillName: observation.skillName ?? DEFAULT_SKILL_NAME,
        activeVariantId: observation.activeVariantId ?? null,
        commandTemplate: observation.commandTemplate,
        startedAt: observation.startedAt,
        finishedAt: observation.finishedAt,
        envelope: observation.envelope,
        stdout: observation.stdout ?? '',
        stderr: observation.stderr ?? '',
        usedUiFallback: observation.usedUiFallback ?? false,
        manualRecovery: observation.manualRecovery ?? false,
    };
}
function buildReplayExecution(execution) {
    return {
        ...execution,
        executionId: `${execution.executionId}.replay`,
        usedUiFallback: false,
        manualRecovery: false,
    };
}
function nextGlobalIdSequence() {
    globalIdSequence += 1;
    return globalIdSequence;
}
function createServiceId(prefix, now) {
    const sequence = nextGlobalIdSequence();
    const nonce = (0, node_crypto_1.randomUUID)();
    return toSafeIdSegment(`${prefix}.${SAFE_ID_PREFIX}.${process.pid}.${now}.${sequence}.${nonce}`);
}
function createNetworkDirectoryEvolutionService(homeDirOrPathsOrOptions) {
    const options = (typeof homeDirOrPathsOrOptions === 'string'
        || (typeof homeDirOrPathsOrOptions === 'object' && homeDirOrPathsOrOptions !== null && !('homeDirOrPaths' in homeDirOrPathsOrOptions)))
        ? { homeDirOrPaths: homeDirOrPathsOrOptions }
        : homeDirOrPathsOrOptions;
    const configStore = options.configStore ?? (0, configStore_1.createConfigStore)(options.homeDirOrPaths);
    const evolutionStore = options.evolutionStore ?? (0, localEvolutionStore_1.createLocalEvolutionStore)(options.homeDirOrPaths);
    const getNow = options.now ?? (() => Date.now());
    return {
        async observeNetworkDirectoryExecution(observation) {
            const config = await configStore.read();
            if (!config.evolution_network.enabled) {
                return {
                    enabled: false,
                    executionId: null,
                    analysisId: null,
                    artifactId: null,
                    adoptedVariantId: null,
                };
            }
            if (!config.evolution_network.autoRecordExecutions) {
                return {
                    enabled: true,
                    executionId: null,
                    analysisId: null,
                    artifactId: null,
                    adoptedVariantId: null,
                };
            }
            const executionNow = getNow();
            const executionId = createServiceId('execution', executionNow);
            const execution = normalizeObservation(observation, executionId);
            await evolutionStore.writeExecution(execution);
            const classification = (0, failureClassifier_1.classifyNetworkDirectoryExecution)({
                execution,
                repairAttemptCount: observation.repairAttemptCount,
            });
            if (!classification.failureClass) {
                return {
                    enabled: true,
                    executionId,
                    analysisId: null,
                    artifactId: null,
                    adoptedVariantId: null,
                };
            }
            const analysisNow = getNow();
            const analysisId = createServiceId('analysis', analysisNow);
            const analysis = {
                analysisId,
                executionId,
                skillName: execution.skillName,
                triggerSource: classification.failureClass,
                evolutionType: 'FIX',
                shouldGenerateCandidate: classification.shouldGenerateCandidate,
                summary: classification.summary,
                analyzedAt: analysisNow,
            };
            await evolutionStore.writeAnalysis(analysis);
            if (!classification.shouldGenerateCandidate) {
                return {
                    enabled: true,
                    executionId,
                    analysisId,
                    artifactId: null,
                    adoptedVariantId: null,
                };
            }
            const baseContract = (0, baseSkillRegistry_1.getBaseSkillContract)(execution.skillName);
            const candidateNow = getNow();
            const candidate = (0, fixGenerator_1.generateNetworkDirectoryFixCandidate)({
                baseContract,
                execution,
                classification,
                analysisId,
                now: candidateNow,
            });
            const verification = (0, validator_1.validateNetworkDirectoryFixCandidate)({
                baseContract,
                candidate,
                triggerFailureClass: classification.failureClass,
                replayExecution: buildReplayExecution(execution),
                replayRepairAttemptCount: 0,
            });
            candidate.verification = verification;
            candidate.updatedAt = getNow();
            let adoptedVariantId = null;
            if (verification.passed) {
                const decision = (0, adoptionPolicy_1.evaluateSkillAdoption)({
                    activeSkillName: baseContract.skillName,
                    activeScope: baseContract.scope,
                    candidate,
                });
                const shouldAutoAdopt = decision.autoAdopt && config.evolution_network.autoAdoptSameSkillSameScope;
                if (shouldAutoAdopt) {
                    candidate.status = decision.status;
                    candidate.adoption = decision.adoption;
                    adoptedVariantId = candidate.variantId;
                }
                else {
                    candidate.status = 'inactive';
                    candidate.adoption = 'manual';
                }
            }
            else {
                candidate.status = 'inactive';
                candidate.adoption = 'manual';
            }
            await evolutionStore.writeArtifact(candidate);
            if (adoptedVariantId) {
                await evolutionStore.setActiveVariant(candidate.skillName, adoptedVariantId);
            }
            return {
                enabled: true,
                executionId,
                analysisId,
                artifactId: candidate.variantId,
                adoptedVariantId,
            };
        },
    };
}
