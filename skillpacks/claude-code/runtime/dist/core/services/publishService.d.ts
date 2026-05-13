export interface PublishedServiceDraft {
    serviceName: string;
    displayName: string;
    description: string;
    providerSkill: string;
    price: string;
    currency: string;
    outputType: string;
    serviceIconUri?: string | null;
    serviceIconDataUrl?: string | null;
}
export interface PublishedServiceRecord {
    id: string;
    sourceServicePinId: string;
    currentPinId: string;
    creatorMetabotId: number;
    providerGlobalMetaId: string;
    providerSkill: string;
    serviceName: string;
    displayName: string;
    description: string;
    serviceIcon: string | null;
    price: string;
    currency: string;
    paymentChain: string | null;
    settlementKind: string | null;
    mrc20Ticker: string | null;
    mrc20Id: string | null;
    skillDocument: string;
    inputType: 'text';
    outputType: string;
    endpoint: 'simplemsg';
    paymentAddress: string;
    payloadJson: string;
    available: 0 | 1;
    revokedAt: number | null;
    updatedAt: number;
}
export declare function normalizePublishedServiceCurrency(value: string): string;
export declare function resolvePublishedServiceSettlement(value: string): {
    currency: string;
    paymentChain: string | null;
    settlementKind: string | null;
    mrc20Ticker: string | null;
    mrc20Id: string | null;
};
export declare function buildPublishedService(input: {
    sourceServicePinId: string;
    currentPinId: string;
    creatorMetabotId: number;
    providerGlobalMetaId: string;
    paymentAddress: string;
    draft: PublishedServiceDraft;
    skillDocument: string;
    now: number;
}): {
    payload: Record<string, string | null>;
    record: PublishedServiceRecord;
};
export declare function buildRevokedPublishedService(input: {
    sourceServicePinId: string;
    currentPinId: string;
    creatorMetabotId: number;
    providerGlobalMetaId: string;
    providerSkill: string;
    serviceName: string;
    displayName: string;
    description: string;
    serviceIcon?: string | null;
    price: string;
    currency: string;
    paymentChain?: string | null;
    settlementKind?: string | null;
    mrc20Ticker?: string | null;
    mrc20Id?: string | null;
    skillDocument: string;
    now: number;
}): PublishedServiceRecord;
