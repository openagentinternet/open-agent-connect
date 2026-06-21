export interface SpendCap {
    amount: string;
    currency: 'SPACE' | 'BTC' | 'DOGE';
}
export interface SpendDecision {
    allowed: boolean;
    code?: 'invalid_price' | 'invalid_cap' | 'currency_mismatch' | 'spend_cap_exceeded';
    reason?: string;
}
export declare function normalizeSpendCurrency(value: unknown): 'SPACE' | 'BTC' | 'DOGE' | '';
export declare function evaluateSpendCap(input: {
    price: string;
    currency: string;
    spendCap?: SpendCap | null;
}): SpendDecision;
