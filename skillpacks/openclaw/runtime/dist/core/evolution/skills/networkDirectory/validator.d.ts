import type { BaseSkillContract } from '../../../skills/skillContractTypes';
import type { SkillExecutionRecord, SkillVerificationSummary, SkillVariantArtifact } from '../../types';
import { type NetworkDirectoryFailureClass } from './failureClassifier';
export interface ValidateNetworkDirectoryFixCandidateInput {
    baseContract: BaseSkillContract;
    candidate: SkillVariantArtifact;
    triggerFailureClass: NetworkDirectoryFailureClass;
    replayExecution: SkillExecutionRecord;
    replayRepairAttemptCount?: number;
}
export declare function validateNetworkDirectoryFixCandidate(input: ValidateNetworkDirectoryFixCandidateInput): SkillVerificationSummary;
