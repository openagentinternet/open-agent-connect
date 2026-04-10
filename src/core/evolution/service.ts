import { randomUUID } from 'node:crypto';

import { createConfigStore, type ConfigStore } from '../config/configStore';
import { createLocalEvolutionStore, type LocalEvolutionStore } from './localEvolutionStore';
import { evaluateSkillAdoption } from './adoptionPolicy';
import { classifyNetworkDirectoryExecution } from './skills/networkDirectory/failureClassifier';
import { generateNetworkDirectoryFixCandidate } from './skills/networkDirectory/fixGenerator';
import { validateNetworkDirectoryFixCandidate } from './skills/networkDirectory/validator';
import { getBaseSkillContract } from '../skills/baseSkillRegistry';
import type { MetabotPaths } from '../state/paths';
import type { SkillExecutionAnalysis, SkillExecutionRecord } from './types';

const DEFAULT_SKILL_NAME = 'metabot-network-directory';
const SAFE_ID_PREFIX = 'network-directory';
let globalIdSequence = 0;

function toSafeIdSegment(input: string): string {
  return input.replace(/[^A-Za-z0-9._-]/g, '-');
}

export interface NetworkDirectoryExecutionObservation {
  skillName?: string;
  activeVariantId?: string | null;
  commandTemplate: string;
  startedAt: number;
  finishedAt: number;
  envelope: Record<string, unknown>;
  stdout?: string;
  stderr?: string;
  usedUiFallback?: boolean;
  manualRecovery?: boolean;
  repairAttemptCount?: number;
}

export interface ObserveNetworkDirectoryExecutionResult {
  enabled: boolean;
  executionId: string | null;
  analysisId: string | null;
  artifactId: string | null;
  adoptedVariantId: string | null;
}

export interface NetworkDirectoryEvolutionService {
  observeNetworkDirectoryExecution(
    observation: NetworkDirectoryExecutionObservation
  ): Promise<ObserveNetworkDirectoryExecutionResult>;
}

export interface CreateNetworkDirectoryEvolutionServiceOptions {
  homeDirOrPaths: string | MetabotPaths;
  configStore?: Pick<ConfigStore, 'read'>;
  evolutionStore?: LocalEvolutionStore;
  now?: () => number;
}

function normalizeObservation(
  observation: NetworkDirectoryExecutionObservation,
  executionId: string
): SkillExecutionRecord {
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

function buildReplayExecution(execution: SkillExecutionRecord): SkillExecutionRecord {
  return {
    ...execution,
    executionId: `${execution.executionId}.replay`,
    usedUiFallback: false,
    manualRecovery: false,
  };
}

function nextGlobalIdSequence(): number {
  globalIdSequence += 1;
  return globalIdSequence;
}

function createServiceId(prefix: string, now: number): string {
  const sequence = nextGlobalIdSequence();
  const nonce = randomUUID();
  return toSafeIdSegment(`${prefix}.${SAFE_ID_PREFIX}.${process.pid}.${now}.${sequence}.${nonce}`);
}

export function createNetworkDirectoryEvolutionService(
  homeDirOrPathsOrOptions: string | MetabotPaths | CreateNetworkDirectoryEvolutionServiceOptions
): NetworkDirectoryEvolutionService {
  const options: CreateNetworkDirectoryEvolutionServiceOptions = (
    typeof homeDirOrPathsOrOptions === 'string'
    || (typeof homeDirOrPathsOrOptions === 'object' && homeDirOrPathsOrOptions !== null && !('homeDirOrPaths' in homeDirOrPathsOrOptions))
  )
    ? { homeDirOrPaths: homeDirOrPathsOrOptions as string | MetabotPaths }
    : homeDirOrPathsOrOptions;

  const configStore = options.configStore ?? createConfigStore(options.homeDirOrPaths);
  const evolutionStore = options.evolutionStore ?? createLocalEvolutionStore(options.homeDirOrPaths);
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

      const classification = classifyNetworkDirectoryExecution({
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
      const analysis: SkillExecutionAnalysis = {
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

      const baseContract = getBaseSkillContract(execution.skillName);
      const candidateNow = getNow();
      const candidate = generateNetworkDirectoryFixCandidate({
        baseContract,
        execution,
        classification,
        analysisId,
        now: candidateNow,
      });
      const verification = validateNetworkDirectoryFixCandidate({
        baseContract,
        candidate,
        triggerFailureClass: classification.failureClass,
        replayExecution: buildReplayExecution(execution),
        replayRepairAttemptCount: 0,
      });
      candidate.verification = verification;
      candidate.updatedAt = getNow();

      let adoptedVariantId: string | null = null;
      if (verification.passed) {
        const decision = evaluateSkillAdoption({
          activeSkillName: baseContract.skillName,
          activeScope: baseContract.scope,
          candidate,
        });
        const shouldAutoAdopt = decision.autoAdopt && config.evolution_network.autoAdoptSameSkillSameScope;
        if (shouldAutoAdopt) {
          candidate.status = decision.status;
          candidate.adoption = decision.adoption;
          adoptedVariantId = candidate.variantId;
        } else {
          candidate.status = 'inactive';
          candidate.adoption = 'manual';
        }
      } else {
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
