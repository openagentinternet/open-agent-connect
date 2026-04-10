import type { BaseSkillContract, SkillPermissionScope } from '../../../skills/skillContractTypes';
import type { SkillExecutionRecord, SkillVariantArtifact } from '../../types';
import type { NetworkDirectoryExecutionClassification } from './failureClassifier';

export interface GenerateNetworkDirectoryFixCandidateInput {
  baseContract: BaseSkillContract;
  execution: SkillExecutionRecord;
  classification: NetworkDirectoryExecutionClassification;
  analysisId: string;
  now: number;
}

function cloneScope(scope: SkillPermissionScope): SkillPermissionScope {
  return {
    allowedCommands: [...scope.allowedCommands],
    chainRead: scope.chainRead,
    chainWrite: scope.chainWrite,
    localUiOpen: scope.localUiOpen,
    remoteDelegation: scope.remoteDelegation,
  };
}

function buildFixPatch(classification: NetworkDirectoryExecutionClassification): SkillVariantArtifact['patch'] {
  if (classification.failureClass === 'manual_recovery') {
    return {
      instructionsPatch: 'Prefer machine-first service discovery and only use UI fallback when a human explicitly asks.',
      fallbackPolicyPatch: 'Do not open UI by default; only use UI fallback after explicit human intent.',
    };
  }
  if (classification.failureClass === 'soft_failure') {
    return {
      instructionsPatch: 'Return only machine-usable service rows with servicePinId and providerGlobalMetaId.',
      outputExpectationPatch: 'Return structured JSON where each service row includes servicePinId and providerGlobalMetaId.',
      fallbackPolicyPatch: 'If machine output is unusable, report a structured terminal status before any UI fallback.',
    };
  }
  return {
    instructionsPatch: 'Run machine-first service discovery and keep command/output contract deterministic.',
    commandTemplatePatch: 'metabot network services --online',
    outputExpectationPatch: 'Return structured JSON with data.services[] rows usable for downstream automation.',
    fallbackPolicyPatch: 'Use UI fallback only for explicit human browsing requests.',
  };
}

export function generateNetworkDirectoryFixCandidate(
  input: GenerateNetworkDirectoryFixCandidateInput
): SkillVariantArtifact {
  const variantId = `variant-network-directory-fix-${input.analysisId}-${input.execution.executionId}`;
  const parentVariantId = input.execution.activeVariantId;
  const rootVariantId = parentVariantId ?? variantId;
  const patch = buildFixPatch(input.classification);
  const scope = cloneScope(input.baseContract.scope);

  return {
    variantId,
    skillName: input.baseContract.skillName,
    status: 'inactive',
    scope,
    metadata: {
      sameSkill: true,
      sameScope: true,
      scopeHash: JSON.stringify(scope),
    },
    patch,
    lineage: {
      lineageId: `lineage-${variantId}`,
      parentVariantId,
      rootVariantId,
      executionId: input.execution.executionId,
      analysisId: input.analysisId,
      createdAt: input.now,
    },
    verification: {
      passed: false,
      checkedAt: input.now,
      protocolCompatible: false,
      replayValid: false,
      notWorseThanBase: false,
      notes: 'Pending validation.',
    },
    adoption: 'manual',
    createdAt: input.now,
    updatedAt: input.now,
  };
}
