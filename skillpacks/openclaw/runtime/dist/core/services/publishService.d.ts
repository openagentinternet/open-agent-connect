export interface PublishedServiceDraft {
    serviceName: string;
    displayName: string;
    description: string;
    providerSkill: string;
    price: string;
    currency: string;
    outputType: string;
    serviceIconUri?: string | null;
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
    payload: Record<string, string>;
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
    skillDocument: string;
    now: number;
}): PublishedServiceRecord;
