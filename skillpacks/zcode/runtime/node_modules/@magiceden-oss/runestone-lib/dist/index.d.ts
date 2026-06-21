/// <reference types="node" />
import { RuneEtchingSpec } from './src/indexer';
import { RunestoneTx } from './src/runestone';
export { BlockIdentifier, BlockInfo, RuneBalance, RuneBlockIndex, RuneEtching, RuneEtchingSpec, RuneLocation, RuneMintCount, RuneSpentUtxoBalance, RuneUpdater, RuneUtxoBalance, RunestoneIndexer, RunestoneIndexerOptions, RunestoneStorage, } from './src/indexer';
export { Network } from './src/network';
export { BitcoinRpcClient, GetBlockParams, GetBlockReturn, GetBlockhashParams, GetRawTransactionParams, GetRawTransactionReturn, RpcResponse, Tx, } from './src/rpcclient';
export type RunestoneSpec = {
    mint?: {
        block: bigint;
        tx: number;
    };
    pointer?: number;
    etching?: RuneEtchingSpec;
    edicts?: {
        id: {
            block: bigint;
            tx: number;
        };
        amount: bigint;
        output: number;
    }[];
};
export type Flaw = 'edict_output' | 'edict_rune_id' | 'invalid_script' | 'opcode' | 'supply_overflow' | 'trailing_integers' | 'truncated_field' | 'unrecognized_even_tag' | 'unrecognized_flag' | 'varint';
export type Cenotaph = {
    flaws: Flaw[];
    etching?: string;
    mint?: {
        block: bigint;
        tx: number;
    };
};
/**
 * Low level function to allow for encoding runestones without any indexer and transaction checks.
 *
 * @param runestone runestone spec to encode as runestone
 * @returns encoded runestone bytes
 * @throws Error if encoding is detected to be considered a cenotaph
 */
export declare function encodeRunestone(runestone: RunestoneSpec): {
    encodedRunestone: Buffer;
    etchingCommitment?: Buffer;
};
export declare function isRunestone(artifact: RunestoneSpec | Cenotaph): artifact is RunestoneSpec;
export declare function tryDecodeRunestone(tx: RunestoneTx): RunestoneSpec | Cenotaph | null;
//# sourceMappingURL=index.d.ts.map