export interface ManualRefundOrder {
    id: string;
    role: 'buyer' | 'seller';
    status: string;
    refundRequestPinId?: string | null;
    coworkSessionId?: string | null;
    paymentTxid?: string | null;
}
export type ManualRefundDecision = {
    required: true;
    state: 'manual_action_required';
    code: 'manual_refund_required';
    message: string;
    ui: {
        kind: 'refund';
        orderId: string;
        sessionId: string | null;
        refundRequestPinId: string;
    };
} | {
    required: false;
    state: 'not_required';
    code: 'refund_not_required';
    message: string;
};
export declare function resolveManualRefundDecision(order: ManualRefundOrder | null | undefined): ManualRefundDecision;
