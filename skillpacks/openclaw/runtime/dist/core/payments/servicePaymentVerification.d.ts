import type { ChainAdapterRegistry } from '../chain/adapters/types';
export type VerifiableServicePaymentChain = 'mvc' | 'btc';
export interface VerifyServiceOrderPaymentInput {
    adapters: ChainAdapterRegistry;
    paymentTxid?: string | null;
    paymentChain?: string | null;
    settlementKind?: string | null;
    paymentAddress?: string | null;
    amount: string;
    currency: string;
}
export interface VerifiedServiceOrderPayment {
    verified: boolean;
    paymentTxid: string | null;
    paymentChain: VerifiableServicePaymentChain | null;
    settlementKind: 'native' | 'free';
    paymentAddress: string | null;
    amount: string;
    currency: string;
    amountSatoshis: number;
    matchedOutputIndex: number | null;
}
export declare function decimalPaymentAmountToSatoshis(value: string): number;
export declare function verifyServiceOrderPayment(input: VerifyServiceOrderPaymentInput): Promise<VerifiedServiceOrderPayment>;
