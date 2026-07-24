import type { ChainUtxo } from './adapters/types';
export declare const MVC_PENDING_UTXO_TTL_MS: number;
export declare function getMvcUtxoOutpointKey(input: {
    txId: string;
    outputIndex: number;
    address?: string;
}): string;
export declare function rememberPendingMvcTransaction(input: {
    address: string;
    spentUtxos: ChainUtxo[];
    createdUtxos: ChainUtxo[];
    now?: number;
}): void;
export declare function resolveSpendableMvcUtxos(input: {
    address: string;
    utxos: ChainUtxo[];
    now?: number;
}): ChainUtxo[];
export declare function __clearPendingMvcUtxosForTests(): void;
