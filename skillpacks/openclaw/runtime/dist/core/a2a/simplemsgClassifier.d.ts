export type SimplemsgOrderProtocolTag = 'ORDER' | 'ORDER_STATUS' | 'DELIVERY' | 'NeedsRating' | 'ORDER_END';
export interface SimplemsgProductMetadata {
    productOrderPinId: string;
    listingPinId: string;
    skuId: string;
    paymentTxid: string;
    deliveredAt?: number;
}
export type SimplemsgClassification = {
    kind: 'private_chat';
} | {
    kind: 'order_protocol';
    tag: SimplemsgOrderProtocolTag;
    orderTxid: string | null;
    orderPinId: string | null;
    reason: string | null;
    orderKind?: 'product_order';
    product?: SimplemsgProductMetadata;
};
export declare function classifySimplemsgContent(content: unknown): SimplemsgClassification;
