import type { ChainWriteResult } from '../chain/writePin';
import type { Signer } from '../signing/signer';
import { type PublishedServiceDraft, type PublishedServiceRecord } from './publishService';
export declare function buildServicePublishChainWrite(input: {
    payload: Record<string, string | null>;
    network?: string;
}): {
    operation: string;
    path: string;
    payload: string;
    contentType: string;
    network: string;
};
export interface PublishServiceToChainResult {
    payload: Record<string, string | null>;
    record: PublishedServiceRecord;
    serviceIconUpload?: ChainWriteResult;
    chainWrite: ChainWriteResult;
}
export declare function publishServiceToChain(input: {
    signer: Pick<Signer, 'writePin'>;
    creatorMetabotId: number;
    providerGlobalMetaId: string;
    paymentAddress: string;
    draft: PublishedServiceDraft;
    skillDocument: string;
    now: number;
    network?: string;
}): Promise<PublishServiceToChainResult>;
