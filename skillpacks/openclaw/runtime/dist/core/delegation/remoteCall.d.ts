import { type SpendCap } from './spendPolicy';
import type { DelegationPolicyDecision } from '../a2a/sessionTypes';
export interface DelegationRequest {
    servicePinId: string;
    serviceName: string;
    providerGlobalMetaid: string;
    price: string;
    currency: string;
    userTask: string;
    taskContext: string;
    rawRequest: string;
    policyMode?: string;
}
export interface RemoteServiceDescriptor {
    servicePinId?: string | null;
    pinId?: string | null;
    providerGlobalMetaId?: string | null;
    serviceName?: string | null;
    displayName?: string | null;
    description?: string | null;
    price?: string | null;
    currency?: string | null;
    ratingAvg?: number | null;
    ratingCount?: number | null;
    providerName?: string | null;
    providerDaemonBaseUrl?: string | null;
    providerChatPublicKey?: string | null;
    updatedAt?: number | null;
    lastSeenAgoSeconds?: number | null;
}
export interface RemoteCallRequest {
    servicePinId: string;
    providerGlobalMetaId: string;
    userTask: string;
    taskContext: string;
    rawRequest?: string;
    spendCap?: SpendCap | null;
    policyMode?: unknown;
}
export type RemoteCallPlanResult = {
    ok: true;
    state: 'ready';
    code: 'remote_call_ready';
    service: {
        servicePinId: string;
        providerGlobalMetaId: string;
        serviceName: string;
        price: string;
        currency: 'SPACE' | 'BTC' | 'DOGE' | '';
    };
    payment: {
        amount: string;
        currency: 'SPACE' | 'BTC' | 'DOGE' | '';
    };
    traceId: string;
    confirmation: DelegationPolicyDecision;
} | {
    ok: false;
    state: 'blocked' | 'offline' | 'manual_action_required';
    code: string;
    message: string;
    traceId?: string;
    confirmation?: DelegationPolicyDecision;
};
export declare function containsDelegationControlPrefix(content: string): boolean;
export declare function getDelegationDisplayText(content: string): string;
export declare function isExplicitMetaAppUserRequest(userText: string, appId?: string): boolean;
export declare function normalizeDelegationPaymentTerms(rawPrice: unknown, rawCurrency: unknown): {
    price: string;
    currency: string;
};
export declare function isDelegationPriceNumeric(value: string): boolean;
export declare function parseDelegationMessage(content: string): DelegationRequest | null;
export declare function buildRemoteServicesPrompt(availableServices: RemoteServiceDescriptor[]): string | null;
export declare function planRemoteCall(input: {
    request: RemoteCallRequest;
    availableServices: RemoteServiceDescriptor[];
    traceId?: string | null;
    manualRefundRequired?: boolean;
}): RemoteCallPlanResult;
