export type SimplemsgOrderProtocolTag = 'ORDER' | 'ORDER_STATUS' | 'DELIVERY' | 'NeedsRating' | 'ORDER_END';
export type SimplemsgClassification = {
    kind: 'private_chat';
} | {
    kind: 'order_protocol';
    tag: SimplemsgOrderProtocolTag;
    orderTxid: string | null;
    reason: string | null;
};
export declare function classifySimplemsgContent(content: unknown): SimplemsgClassification;
