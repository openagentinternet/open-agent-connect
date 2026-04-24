import type { BaseSkillContract } from '../../../skills/skillContractTypes';
import type { SkillExecutionRecord, SkillVariantArtifact } from '../../types';
import type { NetworkDirectoryExecutionClassification } from './failureClassifier';
export interface GenerateNetworkDirectoryFixCandidateInput {
    baseContract: BaseSkillContract;
    execution: SkillExecutionRecord;
    classification: NetworkDirectoryExecutionClassification;
    analysisId: string;
    now: number;
}
export declare function generateNetworkDirectoryFixCandidate(input: GenerateNetworkDirectoryFixCandidateInput): SkillVariantArtifact;
