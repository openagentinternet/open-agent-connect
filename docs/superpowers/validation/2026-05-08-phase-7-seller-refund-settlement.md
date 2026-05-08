# Phase 7 Seller Refund Settlement Validation

Date: 2026-05-08

Spec: `docs/superpowers/specs/2026-05-07-skill-service-provider-runtime-design.md`

## Real-Chain Settlement Blocker

Phase 7 requires either a real refund settlement proof or a concrete chain/environment blocker when no funded refundable seller order is available.

The local v2 profile runtime state was checked for seller orders that are safe to settle:

```bash
jq '{sellerOrderCount: (.sellerOrders // [] | length), refundableSellerOrders: [(.sellerOrders // [])[] | select((.state=="refund_pending" or .state=="failed") and (.paymentTxid // "") != "" and (.paymentAmount // "0") != "0") | {id, state, servicePinId, currentServicePinId, paymentTxid, paymentAmount, paymentCurrency, paymentChain, settlementKind, refundRequestPinId, refundTxid, refundFinalizePinId, refundBlockingReason}]}' /Users/tusm/.metabot/profiles/eric/.runtime/runtime-state.json
jq '{sellerOrderCount: (.sellerOrders // [] | length), refundableSellerOrders: [(.sellerOrders // [])[] | select((.state=="refund_pending" or .state=="failed") and (.paymentTxid // "") != "" and (.paymentAmount // "0") != "0") | {id, state, servicePinId, currentServicePinId, paymentTxid, paymentAmount, paymentCurrency, paymentChain, settlementKind, refundRequestPinId, refundTxid, refundFinalizePinId, refundBlockingReason}]}' /Users/tusm/.metabot/profiles/test1/.runtime/runtime-state.json
jq '{sellerOrderCount: (.sellerOrders // [] | length), refundableSellerOrders: [(.sellerOrders // [])[] | select((.state=="refund_pending" or .state=="failed") and (.paymentTxid // "") != "" and (.paymentAmount // "0") != "0") | {id, state, servicePinId, currentServicePinId, paymentTxid, paymentAmount, paymentCurrency, paymentChain, settlementKind, refundRequestPinId, refundTxid, refundFinalizePinId, refundBlockingReason}]}' /Users/tusm/.metabot/profiles/alice/.runtime/runtime-state.json
```

Observed result for each checked profile:

```json
{
  "sellerOrderCount": 0,
  "refundableSellerOrders": []
}
```

Blocker: no local profile currently has a funded seller order in `refund_pending` or `failed` state with a payment txid, positive payment amount, and refund request proof. A real refund transfer would require fabricating or force-mutating production-like order state, so no real transfer was attempted.

This records the concrete environment blocker for Phase 7 real-chain settlement validation: `no_funded_refundable_seller_order_available`.

