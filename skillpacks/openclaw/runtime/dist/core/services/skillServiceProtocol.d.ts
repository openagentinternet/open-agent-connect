export type SkillServicePaymentTiming = 'free' | 'prepaid' | 'postpaid';
export type SkillServiceSettlementKind = 'native' | 'fiat';
export interface SkillServicePaymentTerms {
    paymentTiming: SkillServicePaymentTiming;
    effectivePrice: string;
    currency: string;
    settlementKind: SkillServiceSettlementKind;
    isFree: boolean;
    isExecutable: boolean;
}
export interface BuildSkillServiceOrderPayloadInput {
    servicePinId?: unknown;
    paymentTxid?: unknown;
    price?: unknown;
    currency?: unknown;
    paymentTiming?: unknown;
    settlementKind?: unknown;
    protocolSettlementKind?: unknown;
    metadata?: unknown;
}
export interface SkillServiceOrderPayload {
    servicePinId: string;
    paymentTxid: string;
    price: string;
    currency: string;
    settlementKind: SkillServiceSettlementKind;
    metadata: string;
}
export declare function normalizeProviderSkillList(value: unknown): string[];
export declare function getPrimaryProviderSkill(value: unknown): string | null;
export declare function normalizeSkillServicePaymentTiming(value: unknown, price: unknown): SkillServicePaymentTiming;
export declare function normalizeSkillServiceSettlementKind(value: unknown): SkillServiceSettlementKind;
export declare function normalizeSkillServiceCurrency(value: unknown): string;
export declare function isExecutableSkillServicePaymentTerm(value: {
    paymentTiming?: unknown;
    effectivePrice?: unknown;
    price?: unknown;
    settlementKind?: unknown;
}): boolean;
export declare function resolveSkillServicePaymentTerms(input?: {
    price?: unknown;
    currency?: unknown;
    paymentTiming?: unknown;
    settlementKind?: unknown;
    protocolSettlementKind?: unknown;
}): SkillServicePaymentTerms;
export declare function buildSkillServiceOrderPayload(input?: BuildSkillServiceOrderPayloadInput): SkillServiceOrderPayload;
