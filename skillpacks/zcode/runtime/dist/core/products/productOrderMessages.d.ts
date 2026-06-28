export interface BuildProductOrderNotificationInput {
    productOrderPinId: string;
    listingPinId: string;
    skuId: string;
    paymentTxid: string;
    comment?: string | null;
}
export interface ProductDeliveryMessage {
    productOrderPinId: string;
    listingPinId: string;
    skuId: string;
    paymentTxid: string;
    result: string;
    deliveredAt: number;
}
export interface ProductOrderNotificationMessage {
    productOrderPinId: string;
    listingPinId: string;
    skuId: string;
    paymentTxid: string;
}
export declare function buildProductOrderNotification(input: BuildProductOrderNotificationInput): string;
export declare function parseProductOrderNotification(value: unknown): ProductOrderNotificationMessage | null;
export declare function parseProductDeliveryMessage(value: unknown): ProductDeliveryMessage | null;
