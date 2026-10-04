/**
 * Owner profile on-chain publish: the owner-identity mirror of the Bot
 * /info/* publish seam (src/core/bot/metabotProfileManager.ts). Saving the
 * owner's name and/or avatar publishes them under the owner's own MetaID
 * (`/info/name`, `/info/avatar`) before the local record is updated, so the
 * local file never claims a profile the chain does not show.
 */
import type { ChainWriteRequest, ChainWriteResult } from '../chain/writePin';
import type { Signer } from '../signing/signer';
export declare const OWNER_NAME_CHAIN_PATH = "/info/name";
/** The changed profile fields to publish; `avatarDataUrl: ''` clears the on-chain avatar. */
export interface OwnerProfileChainFields {
    name?: string;
    avatarDataUrl?: string;
}
export declare function buildOwnerProfileChainWrites(fields: OwnerProfileChainFields): ChainWriteRequest[];
/**
 * Sequential writes with the same inter-write delay the Bot profile sync uses
 * (each pin spends the previous write's change UTXO).
 */
export declare function writeOwnerProfileChainRequests(signer: Signer, requests: ChainWriteRequest[], options?: {
    delayMs?: number;
}): Promise<ChainWriteResult[]>;
