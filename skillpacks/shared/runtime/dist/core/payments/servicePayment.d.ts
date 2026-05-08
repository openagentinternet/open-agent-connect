import type { SecretStore } from '../secrets/secretStore';
import type { ChainAdapterRegistry } from '../chain/adapters/types';
export interface A2AOrderPaymentResult {
    paymentTxid: string | null;
    paymentCommitTxid?: string | null;
    paymentChain?: 'mvc' | 'btc' | null;
    paymentAmount: string;
    paymentCurrency: string;
    settlementKind: 'native' | 'free';
    orderReference?: string | null;
    totalCost?: number | null;
    network?: string | null;
}
export interface ServicePaymentExecutionInput {
    servicePinId: string;
    providerGlobalMetaId: string;
    paymentAddress: string;
    amount: string;
    currency: 'SPACE' | 'MVC' | 'BTC';
    paymentChain: 'mvc' | 'btc';
    settlementKind: 'native';
}
export interface ServicePaymentExecutor {
    execute(input: ServicePaymentExecutionInput): Promise<A2AOrderPaymentResult>;
}
export interface ExecuteServiceOrderPaymentInput {
    servicePinId: string;
    providerGlobalMetaId: string;
    paymentAddress?: string | null;
    amount: string;
    currency: string;
    traceId?: string | null;
    executor: ServicePaymentExecutor;
}
export declare function createTestServicePaymentExecutor(): ServicePaymentExecutor;
export declare function createWalletServicePaymentExecutor(input: {
    secretStore: SecretStore;
    adapters: ChainAdapterRegistry;
    feeRate?: number;
}): ServicePaymentExecutor;
export declare function executeServiceOrderPayment(input: ExecuteServiceOrderPaymentInput): Promise<A2AOrderPaymentResult>;
