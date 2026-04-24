export declare const ORDER_PREFIX = "[ORDER]";
export declare const ORDER_RAW_REQUEST_OPEN_TAG = "<raw_request>";
export declare const ORDER_RAW_REQUEST_CLOSE_TAG = "</raw_request>";
export declare function normalizeOrderRawRequest(value: unknown): string;
export declare function extractOrderRawRequest(plaintext: string): string;
export declare function buildOrderRawRequestBlock(rawRequest: string): string;
export declare function buildOrderPayload(input: {
    displayText?: unknown;
    rawRequest?: unknown;
    price?: unknown;
    currency?: unknown;
    paymentTxid?: unknown;
    orderReference?: unknown;
    serviceId?: unknown;
    skillName?: unknown;
    serviceName?: unknown;
}): string;
export declare function extractOrderDisplaySummary(plaintext: string): string;
