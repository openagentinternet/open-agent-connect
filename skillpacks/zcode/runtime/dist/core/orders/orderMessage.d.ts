export declare const ORDER_PREFIX = "[ORDER]";
export declare const ORDER_RAW_REQUEST_OPEN_TAG = "<raw_request>";
export declare const ORDER_RAW_REQUEST_CLOSE_TAG = "</raw_request>";
export interface OrderMetadataLineRegexOptions {
    /** Also match a markdown bullet (`- `, `* `) and/or bold `**` marker before the label. */
    allowMarkdownPrefix?: boolean;
    /** Also match `=` in addition to `:` and `：` as the label separator. */
    allowEqualsSeparator?: boolean;
    /** Make the label separator optional so a bare label prefix also matches. */
    optionalSeparator?: boolean;
    /** Extra label alternatives (regex fragments) for non-canonical chatty variants. */
    extraLabels?: string[];
}
/**
 * Single grammar for the protocol metadata lines buildOrderPayload emits,
 * shared by the result-text cleaner, the order-text sanitizer, and the
 * generated-text rejector. Consumer-specific matching modes are expressed
 * through options instead of diverging regex copies.
 */
export declare function createOrderMetadataLineRegex(options?: OrderMetadataLineRegexOptions): RegExp;
export declare function normalizeOrderRawRequest(value: unknown): string;
export declare function extractOrderRawRequest(plaintext: string): string;
export declare function buildOrderRawRequestBlock(rawRequest: string): string;
export declare function buildOrderPayload(input: {
    displayText?: unknown;
    rawRequest?: unknown;
    price?: unknown;
    currency?: unknown;
    paymentTxid?: unknown;
    paymentCommitTxid?: unknown;
    paymentChain?: unknown;
    settlementKind?: unknown;
    mrc20Ticker?: unknown;
    mrc20Id?: unknown;
    orderReference?: unknown;
    serviceId?: unknown;
    skillName?: unknown;
    serviceName?: unknown;
    outputType?: unknown;
}): string;
export declare function extractOrderDisplaySummary(plaintext: string): string;
