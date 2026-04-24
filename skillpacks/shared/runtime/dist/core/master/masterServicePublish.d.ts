import type { ChainWriteResult } from '../chain/writePin';
import type { Signer } from '../signing/signer';
import { type PublishedMasterDraft, type PublishedMasterRecord } from './masterTypes';
export declare function buildPublishedMaster(input: {
    sourceMasterPinId: string;
    currentPinId: string;
    creatorMetabotId: number;
    providerGlobalMetaId: string;
    providerAddress: string;
    draft: PublishedMasterDraft;
    now: number;
}): {
    payload: Record<string, unknown>;
    record: PublishedMasterRecord;
};
export declare function buildMasterPublishChainWrite(input: {
    payload: Record<string, unknown>;
    network?: string;
}): {
    operation: string;
    path: string;
    payload: string;
    contentType: string;
    network: string;
};
export interface PublishMasterToChainResult {
    payload: Record<string, unknown>;
    record: PublishedMasterRecord;
    chainWrite: ChainWriteResult;
}
export declare function publishMasterToChain(input: {
    signer: Pick<Signer, 'writePin'>;
    creatorMetabotId: number;
    providerGlobalMetaId: string;
    providerAddress: string;
    draft: PublishedMasterDraft;
    now: number;
    network?: string;
}): Promise<PublishMasterToChainResult>;
