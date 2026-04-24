import type { SkillExecutionRecord, SkillExecutionTriggerSource } from '../../types';
export type NetworkDirectoryFailureClass = SkillExecutionTriggerSource;
export interface ClassifyNetworkDirectoryExecutionInput {
    execution: SkillExecutionRecord;
    repairAttemptCount?: number;
}
export interface NetworkDirectoryExecutionClassification {
    completed: boolean;
    failureClass: NetworkDirectoryFailureClass | null;
    isEvolutionCandidate: boolean;
    shouldGenerateCandidate: boolean;
    summary: string;
}
export declare function classifyNetworkDirectoryExecution(input: ClassifyNetworkDirectoryExecutionInput): NetworkDirectoryExecutionClassification;
