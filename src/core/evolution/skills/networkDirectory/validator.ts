import type { BaseSkillContract, SkillContractPatch, SkillPermissionScope } from '../../../skills/skillContractTypes';
import type { SkillExecutionRecord, SkillExecutionTriggerSource, SkillVerificationSummary, SkillVariantArtifact } from '../../types';
import { classifyNetworkDirectoryExecution, type NetworkDirectoryFailureClass } from './failureClassifier';

const MACHINE_FIRST_COMMAND = 'metabot network services --online';
const ALLOWED_PATCH_KEYS = new Set([
  'instructionsPatch',
  'commandTemplatePatch',
  'outputExpectationPatch',
  'fallbackPolicyPatch',
]);

export interface ValidateNetworkDirectoryFixCandidateInput {
  baseContract: BaseSkillContract;
  candidate: SkillVariantArtifact;
  triggerFailureClass: NetworkDirectoryFailureClass;
  replayExecution: SkillExecutionRecord;
  replayRepairAttemptCount?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeAllowedCommands(commands: string[]): string[] {
  return [...new Set(commands)].sort();
}

function areScopesEquivalent(left: SkillPermissionScope, right: SkillPermissionScope): boolean {
  const leftCommands = normalizeAllowedCommands(left.allowedCommands);
  const rightCommands = normalizeAllowedCommands(right.allowedCommands);
  if (leftCommands.length !== rightCommands.length) {
    return false;
  }
  for (let index = 0; index < leftCommands.length; index += 1) {
    if (leftCommands[index] !== rightCommands[index]) {
      return false;
    }
  }
  return left.chainRead === right.chainRead
    && left.chainWrite === right.chainWrite
    && left.localUiOpen === right.localUiOpen
    && left.remoteDelegation === right.remoteDelegation;
}

function hasAllowedPatchSurfaceOnly(patch: unknown): patch is SkillContractPatch {
  if (!isRecord(patch)) {
    return false;
  }
  const keys = Object.keys(patch);
  for (const key of keys) {
    if (!ALLOWED_PATCH_KEYS.has(key)) {
      return false;
    }
    const value = patch[key];
    if (typeof value !== 'string') {
      return false;
    }
  }
  return true;
}

function isMachineFirstCommand(commandTemplate: string): boolean {
  return commandTemplate.trim() === MACHINE_FIRST_COMMAND;
}

function validateProtocolCompatibility(
  baseContract: BaseSkillContract,
  candidate: SkillVariantArtifact
): boolean {
  if (candidate.skillName !== baseContract.skillName) {
    return false;
  }
  if (!candidate.metadata.sameSkill || !candidate.metadata.sameScope) {
    return false;
  }
  if (!areScopesEquivalent(baseContract.scope, candidate.scope)) {
    return false;
  }
  if (!hasAllowedPatchSurfaceOnly(candidate.patch)) {
    return false;
  }
  const commandTemplate = candidate.patch.commandTemplatePatch ?? baseContract.commandTemplate;
  if (!isMachineFirstCommand(commandTemplate)) {
    return false;
  }
  return true;
}

function failureSeverity(failureClass: SkillExecutionTriggerSource | null): number {
  if (failureClass === 'hard_failure') {
    return 3;
  }
  if (failureClass === 'soft_failure') {
    return 2;
  }
  if (failureClass === 'manual_recovery') {
    return 1;
  }
  return 0;
}

function isReplayValid(
  triggerFailureClass: SkillExecutionTriggerSource,
  replayClassification: ReturnType<typeof classifyNetworkDirectoryExecution>
): boolean {
  if (replayClassification.failureClass === triggerFailureClass) {
    return false;
  }
  if (triggerFailureClass === 'hard_failure' || triggerFailureClass === 'soft_failure') {
    return replayClassification.failureClass === null;
  }
  return replayClassification.failureClass !== 'manual_recovery';
}

export function validateNetworkDirectoryFixCandidate(
  input: ValidateNetworkDirectoryFixCandidateInput
): SkillVerificationSummary {
  const protocolCompatible = validateProtocolCompatibility(input.baseContract, input.candidate);
  const replayClassification = classifyNetworkDirectoryExecution({
    execution: input.replayExecution,
    repairAttemptCount: input.replayRepairAttemptCount,
  });
  const replayValid = protocolCompatible && isReplayValid(input.triggerFailureClass, replayClassification);
  const notWorseThanBase = failureSeverity(replayClassification.failureClass)
    <= failureSeverity(input.triggerFailureClass);
  const passed = protocolCompatible && replayValid && notWorseThanBase;

  return {
    passed,
    checkedAt: Date.now(),
    protocolCompatible,
    replayValid,
    notWorseThanBase,
    notes: replayClassification.summary,
  };
}
