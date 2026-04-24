export interface BuildDelegationOrderPayloadInput {
    rawRequest?: string | null;
    taskContext?: string | null;
    userTask?: string | null;
    serviceName?: string | null;
    providerSkill?: string | null;
    servicePinId?: string | null;
    paymentTxid: string;
    orderReference?: string | null;
    price: string;
    currency: string;
}
export declare function resolveDelegationOrderSkillName(input: {
    providerSkill?: string | null;
    serviceName?: string | null;
}): string;
export declare function buildDelegationOrderPayload(input: BuildDelegationOrderPayloadInput): string;
