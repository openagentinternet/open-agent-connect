import { type ConfigStore } from '../config/configStore';
import { type LocalEvolutionStore } from './localEvolutionStore';
import type { MetabotPaths } from '../state/paths';
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
    observeNetworkDirectoryExecution(observation: NetworkDirectoryExecutionObservation): Promise<ObserveNetworkDirectoryExecutionResult>;
}
export interface CreateNetworkDirectoryEvolutionServiceOptions {
    homeDirOrPaths: string | MetabotPaths;
    configStore?: Pick<ConfigStore, 'read'>;
    evolutionStore?: LocalEvolutionStore;
    now?: () => number;
}
export declare function createNetworkDirectoryEvolutionService(homeDirOrPathsOrOptions: string | MetabotPaths | CreateNetworkDirectoryEvolutionServiceOptions): NetworkDirectoryEvolutionService;
