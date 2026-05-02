export type OrderProtocolTag = 'ORDER_STATUS' | 'DELIVERY' | 'NeedsRating' | 'ORDER_END';
export interface DeliveryMessagePayload {
    paymentTxid?: string | null;
    servicePinId?: string | null;
    serviceName?: string | null;
    result?: string | null;
    deliveredAt?: number | null;
    orderTxid?: string;
    [key: string]: unknown;
}
export interface ParsedOrderStatusMessage {
    orderTxid?: string;
    content: string;
}
export interface ParsedNeedsRatingMessage {
    orderTxid?: string;
    content: string;
}
export interface ParsedOrderEndMessage {
    orderTxid?: string;
    reason: string;
    content: string;
}
export type ParsedDeliveryMessage = DeliveryMessagePayload;
export type ParsedOrderProtocolMessage = ParsedOrderStatusMessage | ParsedDeliveryMessage | ParsedNeedsRatingMessage | ParsedOrderEndMessage;
export declare function normalizeOrderProtocolTxid(value: unknown): string;
export declare function buildOrderStatusMessage(orderTxid: string, content: string): string;
export declare function parseOrderStatusMessage(content: string): ParsedOrderStatusMessage | null;
export declare function buildNeedsRatingMessage(orderTxid: string, content: string): string;
export declare function parseNeedsRatingMessage(content: string): ParsedNeedsRatingMessage | null;
export declare function buildOrderEndMessage(orderTxid: string, reason?: string, content?: string): string;
export declare function parseOrderEndMessage(content: string): ParsedOrderEndMessage | null;
export declare function buildDeliveryMessage(payload: DeliveryMessagePayload, orderTxid?: string | null): string;
export declare function parseDeliveryMessage(content: string): ParsedDeliveryMessage | null;
export declare function parseOrderScopedProtocolMessage(content: string): ParsedOrderProtocolMessage | null;
