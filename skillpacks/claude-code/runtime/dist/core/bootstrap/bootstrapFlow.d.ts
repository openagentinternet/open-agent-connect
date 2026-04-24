import { type BootstrapCreateRequest, type BootstrapCreateStep } from './createMetabot';
import { type BootstrapRequestSubsidyStep, type BootstrapSubsidyResult } from './requestSubsidy';
import { type BootstrapSyncResult, type BootstrapSyncStep } from './syncIdentityToChain';
export type BootstrapPhase = 'identity_created' | 'subsidy_requested' | 'syncing' | 'ready' | 'failed';
export interface BootstrapProgress {
    phase: BootstrapPhase;
    retryable: boolean;
    manualActionRequired: boolean;
}
export interface BootstrapFlowOptions<TRequest extends BootstrapCreateRequest, TMetabot> {
    request: TRequest;
    createMetabot: BootstrapCreateStep<TRequest, TMetabot>;
    requestSubsidy: BootstrapRequestSubsidyStep<TRequest, TMetabot>;
    syncIdentityToChain: BootstrapSyncStep<TRequest, TMetabot>;
    onProgress?: (progress: BootstrapProgress) => void;
    wait?: (ms: number) => Promise<void>;
    syncRetryDelayMs?: number;
}
export interface BootstrapFlowResult<TMetabot> extends BootstrapProgress {
    success: boolean;
    metabot?: TMetabot;
    subsidy: BootstrapSubsidyResult;
    sync?: BootstrapSyncResult;
    canSkip?: boolean;
    error?: string;
}
export declare function runBootstrapFlow<TRequest extends BootstrapCreateRequest, TMetabot>(options: BootstrapFlowOptions<TRequest, TMetabot>): Promise<BootstrapFlowResult<TMetabot>>;
