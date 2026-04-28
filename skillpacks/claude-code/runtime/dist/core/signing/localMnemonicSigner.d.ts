import { type DerivedIdentity } from '../identity/deriveIdentity';
import { type NormalizedChainWriteRequest } from '../chain/writePin';
import type { SecretStore } from '../secrets/secretStore';
import type { Signer } from './signer';
interface MvcTransportUtxo {
    txid: string;
    outIndex: number;
    value: number;
    height: number;
}
export interface LocalMnemonicSignerMvcTransport {
    fetchUtxos(address: string): Promise<MvcTransportUtxo[]>;
    broadcastTx(rawTx: string): Promise<string>;
}
export interface BtcTransportUtxo {
    txId: string;
    outputIndex: number;
    satoshis: number;
    address: string;
    rawTx?: string;
    confirmed?: boolean;
}
export interface LocalMnemonicSignerBtcTransport {
    fetchUtxos(address: string, needRawTx: boolean): Promise<BtcTransportUtxo[]>;
    broadcastTx(rawTx: string): Promise<string>;
}
export interface LocalMnemonicSignerBtcCreatePinInput {
    request: NormalizedChainWriteRequest;
    identity: DerivedIdentity;
}
export interface LocalMnemonicSignerBtcCreatePinResult {
    txids: string[];
    pinId: string;
    totalCost: number;
}
export interface WalletTransferExecuteInput {
    mnemonic: string;
    path: string;
    toAddress: string;
    amountSatoshis: number;
    feeRate?: number;
}
export interface WalletTransferExecuteResult {
    txid: string;
}
export declare function executeMvcTransfer(input: WalletTransferExecuteInput): Promise<WalletTransferExecuteResult>;
export declare function executeBtcTransfer(input: WalletTransferExecuteInput): Promise<WalletTransferExecuteResult>;
export declare function createLocalMnemonicSigner(input: {
    secretStore: SecretStore;
    mvcTransport?: LocalMnemonicSignerMvcTransport;
    btcTransport?: LocalMnemonicSignerBtcTransport;
    btcCreatePin?: (input: LocalMnemonicSignerBtcCreatePinInput) => Promise<LocalMnemonicSignerBtcCreatePinResult>;
    btcFeeRate?: number;
}): Signer;
export {};
