import type { DerivedIdentity } from '../identity/deriveIdentity';
import type { ChainUtxo } from './adapters/types';
export interface MvcLargeUploadFundingResult {
    mergeTxHex: string;
    mergeTxId: string;
    chunkPreTxHex: string;
    indexPreTxHex: string;
    chunkPreTxOutputAmount: number;
    indexPreTxOutputAmount: number;
    spentUtxos: ChainUtxo[];
    spentOutpoints: string[];
    changeUtxo: ChainUtxo | null;
}
export declare function buildMvcLargeUploadFunding(input: {
    identity: DerivedIdentity;
    address?: string;
    feeRate: number;
    chunkPreTxFee: number;
    indexPreTxFee: number;
    utxos: ChainUtxo[];
    excludedOutpoints?: ReadonlySet<string>;
}): Promise<MvcLargeUploadFundingResult>;
