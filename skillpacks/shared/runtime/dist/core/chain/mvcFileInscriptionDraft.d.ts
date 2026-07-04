import type { DerivedIdentity } from '../identity/deriveIdentity';
import type { ChainUtxo } from './adapters/types';
import { type NormalizedChainWriteRequest } from './writePin';
export interface MvcFileInscriptionDraft {
    address: string;
    privateKey: unknown;
    userInputs: ChainUtxo[];
    selectedUtxos: ChainUtxo[];
    userInputCount: number;
    unsignedTxHex: string;
}
export declare function buildMvcFileInscriptionDraft(input: {
    identity: DerivedIdentity;
    request: NormalizedChainWriteRequest;
    utxos: ChainUtxo[];
    feeRate?: number;
    deductMinerFeeFromChange?: boolean;
}): Promise<MvcFileInscriptionDraft>;
export declare function signMvcPreparedUserInputs(input: {
    identity: DerivedIdentity;
    preparedTxHex: string;
    userInputs: ChainUtxo[];
    userInputIndexes: number[];
}): Promise<{
    txHex: string;
}>;
export declare function extractOwnedOutputsFromPreparedMvcTx(input: {
    txHex: string;
    txId: string;
    address: string;
}): ChainUtxo[];
