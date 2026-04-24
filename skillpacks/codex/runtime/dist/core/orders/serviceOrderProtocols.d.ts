export interface DeliveryMessagePayload {
    paymentTxid?: string | null;
    servicePinId?: string | null;
    serviceName?: string | null;
    result?: string | null;
    deliveredAt?: number | null;
    [key: string]: unknown;
}
export declare function buildDeliveryMessage(payload: DeliveryMessagePayload): string;
export declare function cleanServiceResultText(content: string): string;
export declare function parseDeliveryMessage(content: string): DeliveryMessagePayload | null;
export declare function parseNeedsRatingMessage(content: string): string | null;
