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
export type ServiceOrderPaymentVerificationFailureKind = 'input_invalid' | 'adapter_missing' | 'payment_not_found' | 'output_mismatch' | 'chain_unavailable';
/**
 * Tri-state verification outcome:
 * - `verified`: a matching payment output was found on chain.
 * - `mismatch`: at least one chain lookup answered and the payment is absent
 *   or pays the wrong address/amount. Deterministic — callers may fail the
 *   order terminally.
 * - `error`: every available chain lookup failed to answer (transport or
 *   indexer outage). Transient — callers must not treat it as proof of
 *   non-payment; the order should stay reprocessable.
 */
export type ServiceOrderPaymentVerificationOutcome = 'verified' | 'mismatch' | 'error';
export interface VerifiedServiceOrderPayment {
    verified: boolean;
    outcome: ServiceOrderPaymentVerificationOutcome;
    paymentTxid: string | null;
    paymentChain: VerifiableServicePaymentChain | null;
    settlementKind: 'native' | 'free';
    paymentAddress: string | null;
    amount: string;
    currency: string;
    amountSatoshis: number;
    matchedOutputIndex: number | null;
    failureKind?: ServiceOrderPaymentVerificationFailureKind | null;
}
export declare function decimalPaymentAmountToSatoshis(value: string): number;
export declare function verifyServiceOrderPayment(input: VerifyServiceOrderPaymentInput): Promise<VerifiedServiceOrderPayment>;
