export interface BuildDelegationOrderPayloadInput {
    rawRequest?: string | null;
    taskContext?: string | null;
    userTask?: string | null;
    serviceName?: string | null;
    providerSkill?: string | null;
    servicePinId?: string | null;
    paymentTxid: string;
    paymentCommitTxid?: string | null;
    paymentChain?: string | null;
    settlementKind?: string | null;
    mrc20Ticker?: string | null;
    mrc20Id?: string | null;
    orderReference?: string | null;
    price: string;
    currency: string;
    outputType?: string | null;
}
export declare function resolveDelegationOrderSkillName(input: {
    providerSkill?: string | null;
    serviceName?: string | null;
}): string;
export declare function buildDelegationOrderPayload(input: BuildDelegationOrderPayloadInput): string;
