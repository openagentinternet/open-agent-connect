import type { BootstrapCreateRequest } from './createMetabot';
import type { BootstrapSubsidyResult } from './requestSubsidy';
import type { ChainWriteResult } from '../chain/writePin';

export interface BootstrapSyncResult {
  success: boolean;
  error?: string;
  canSkip?: boolean;
  chainWrites?: ChainWriteResult[];
}

export interface BootstrapSyncContext<TRequest extends BootstrapCreateRequest, TMetabot> {
  request: TRequest;
  metabot: TMetabot;
  subsidy: BootstrapSubsidyResult;
}

export type BootstrapSyncStep<TRequest extends BootstrapCreateRequest, TMetabot> = (
  context: BootstrapSyncContext<TRequest, TMetabot>
) => Promise<BootstrapSyncResult>;

export async function runSyncIdentityToChainStep<TRequest extends BootstrapCreateRequest, TMetabot>(
  step: BootstrapSyncStep<TRequest, TMetabot>,
  context: BootstrapSyncContext<TRequest, TMetabot>
): Promise<BootstrapSyncResult> {
  return step(context);
}
