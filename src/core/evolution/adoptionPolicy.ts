import type { SkillPermissionScope, SkillVariantStatus } from '../skills/skillContractTypes';
import type { SkillAdoptionState, SkillVariantArtifact } from './types';

function normalizeAllowedCommands(commands: string[]): string[] {
  return [...new Set(commands)].sort();
}

function scopesEquivalent(left: SkillPermissionScope, right: SkillPermissionScope): boolean {
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

export interface EvaluateSkillAdoptionInput {
  activeSkillName: string;
  activeScope: SkillPermissionScope;
  candidate: Pick<SkillVariantArtifact, 'skillName' | 'scope'>;
}

export interface SkillAdoptionDecision {
  autoAdopt: boolean;
  status: SkillVariantStatus;
  adoption: SkillAdoptionState;
}

export function evaluateSkillAdoption(input: EvaluateSkillAdoptionInput): SkillAdoptionDecision {
  if (input.candidate.skillName !== input.activeSkillName) {
    return {
      autoAdopt: false,
      status: 'inactive',
      adoption: 'manual',
    };
  }

  if (!scopesEquivalent(input.activeScope, input.candidate.scope)) {
    return {
      autoAdopt: false,
      status: 'inactive',
      adoption: 'manual',
    };
  }

  return {
    autoAdopt: true,
    status: 'active',
    adoption: 'active',
  };
}
