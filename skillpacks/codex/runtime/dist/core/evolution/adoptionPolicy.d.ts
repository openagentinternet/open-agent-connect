import type { SkillPermissionScope, SkillVariantStatus } from '../skills/skillContractTypes';
import type { SkillAdoptionState, SkillVariantArtifact } from './types';
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
export declare function evaluateSkillAdoption(input: EvaluateSkillAdoptionInput): SkillAdoptionDecision;
