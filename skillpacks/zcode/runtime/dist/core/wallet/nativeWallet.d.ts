import { type MetabotCommandResult } from '../contracts/commandResult';
import type { ChainAdapter, ChainAdapterRegistry } from '../chain/adapters/types';
import type { DerivedIdentity } from '../identity/deriveIdentity';
import type { SecretStore } from '../secrets/secretStore';
export declare const NATIVE_WALLET_CHAINS: readonly ["mvc", "btc", "doge", "opcat"];
export declare const NATIVE_TRANSFER_UNITS: {
    readonly mvc: "SPACE";
    readonly btc: "BTC";
    readonly doge: "DOGE";
    readonly opcat: "OPCAT";
};
export type NativeWalletChain = typeof NATIVE_WALLET_CHAINS[number];
export type NativeTransferUnit = typeof NATIVE_TRANSFER_UNITS[NativeWalletChain];
export interface ParsedWalletTransferAmount {
    chain: NativeWalletChain;
    currency: NativeTransferUnit;
    satoshis: number;
    adapter: ChainAdapter;
}
export interface QueryWalletBalancesInput {
    identity: Pick<DerivedIdentity, 'globalMetaId' | 'mvcAddress' | 'addresses'>;
    adapters: ChainAdapterRegistry;
    chain: string;
}
export interface WalletTransferOperationInput {
    identity: Pick<DerivedIdentity, 'globalMetaId' | 'mvcAddress' | 'addresses' | 'path'>;
    adapters: ChainAdapterRegistry;
    toAddress: string;
    amountRaw: string;
}
export interface WalletConfirmTransferInput extends WalletTransferOperationInput {
    secretStore: Pick<SecretStore, 'readIdentitySecrets'>;
}
export declare function decimalAmountToSatoshis(value: string): number;
export declare function parseWalletTransferAmount(raw: string, adapters: ChainAdapterRegistry): ParsedWalletTransferAmount;
export declare function resolveIdentityChainAddress(identity: Pick<DerivedIdentity, 'addresses' | 'mvcAddress'>, chain: string): string | null;
export declare function queryWalletBalances(input: QueryWalletBalancesInput): Promise<MetabotCommandResult<unknown>>;
export declare function previewWalletTransfer(input: WalletTransferOperationInput): Promise<MetabotCommandResult<unknown>>;
export declare function confirmWalletTransfer(input: WalletConfirmTransferInput): Promise<MetabotCommandResult<unknown>>;
